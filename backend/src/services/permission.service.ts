/**
 * Centralized permission engine for hierarchy-aware messaging.
 *
 * Single source of truth for "can user A reach user B?" — every controller that
 * needs the answer calls into this module. Directory, send, thread fetch, and
 * read-receipt endpoints all go through the same engine so they cannot drift.
 *
 * Final policy (mirrors the product spec verbatim):
 *
 *   SUPER_ADMIN / CEO / CTO / DIRECTOR (ADMIN_TIER)
 *     → every active user in the workspace.
 *
 *   HR_MANAGER / MANAGER (functionally one "group lead" tier)
 *     → every other MANAGER and HR_MANAGER (org-wide peer chat).
 *     → admin tier (upward leadership).
 *     → recruiters in their OWN GROUP (users.group_id).
 *     → consultants in their OWN GROUP (consultant.user.group_id, which by
 *       the Phase 14 consultant↔recruiter invariant matches the recruiter's
 *       group).
 *     → recruiters they manage via recruiter_managers + the legacy single-
 *       manager_id column, plus those recruiters' consultants — preserves
 *       cross-group supervisor relationships.
 *     A group lead with NO group_id sees no recruiters/consultants from the
 *     group branch (fail-closed); the org-wide peer + admin branches still
 *     apply.
 *
 *   RECRUITER
 *     → every other RECRUITER (org-wide peer chat).
 *     → admin tier (upward).
 *     → own manager / HR-manager / reporting chain: their assigned managers
 *       (recruiter_managers + legacy) AND manager-tier users in their OWN
 *       GROUP (the in-group reporting chain).
 *     → their own assigned consultants.
 *     NEVER consultants assigned to other recruiters.
 *
 *   CONSULTANT
 *     → their assigned recruiter.
 *     → that recruiter's manager / HR chain (assigned managers via junction +
 *       manager-tier users in the consultant's own group).
 *     NEVER other consultants, NEVER unrelated recruiters.
 *
 *   DEVELOPER (support-chat exception)
 *     → every active user (so devs can reply to bug reports / support pings).
 *     This is the only DEVELOPER access outside the explicit admin-page
 *     capability grants; the role is still excluded from BUSINESS_ROLES, so
 *     /jobs, /tasks, /training etc. remain blocked.
 *
 *   ALL ROLES → active DEVELOPERs are ALWAYS reachable (bug/error reporting).
 *     Inactive DEVELOPERs are excluded, same as any other inactive target.
 *
 * Strict assignment + group only — no reports_to chain, no prior-thread
 * carry-over. If a reassignment removes a relationship, the in-flight thread
 * immediately becomes unreachable (fail-closed).
 *
 * The per-role rules above are designed to be EXPLICITLY BIDIRECTIONAL — a
 * manager sees their in-group recruiter and that recruiter sees the manager
 * via their in-group chain. canMessageUser therefore does a forward check
 * only; a reverse fallback would over-broaden (e.g. let any consultant
 * message any admin because the admin's set is everyone).
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { ADMIN_TIER, type Role } from '../types';

const ADMIN_ROLES = ADMIN_TIER as readonly Role[];
// Group-lead tier — HR_MANAGER and MANAGER are functionally one role for
// messaging purposes (both lead groups; both reach each other org-wide).
const MANAGER_LIKE: Role[] = ['MANAGER', 'HR_MANAGER'];

export interface PermissionCaller {
  id: string;
  role: Role;
  /** Required for group-scoped branches (HR_MANAGER/MANAGER, RECRUITER, CONSULTANT).
   *  Admin-tier ignores this field — they reach every active user regardless. */
  group_id?: string | null;
}

// ---------------------------------------------------------------------------
// In-memory permission cache
// ---------------------------------------------------------------------------
interface CacheEntry {
  ids: Set<string>;
  expiresAt: number;
}
const TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(caller: PermissionCaller): string {
  // group_id is part of the key so a re-grouped user gets a fresh resolution
  // on the next call without waiting for the TTL.
  return `${caller.role}:${caller.id}:${caller.group_id ?? ''}`;
}

function cacheGet(caller: PermissionCaller): Set<string> | null {
  const key = cacheKey(caller);
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.ids;
}

function cacheSet(caller: PermissionCaller, ids: Set<string>): void {
  cache.set(cacheKey(caller), { ids, expiresAt: Date.now() + TTL_MS });
  if (cache.size > 5_000) {
    const drop = [...cache.entries()].slice(0, 1_000);
    for (const [k] of drop) cache.delete(k);
    logger.debug({ cacheSize: cache.size }, 'permission-cache: evicted oldest 1000');
  }
}

/** Drop the cached accessible-user set for a single user. Call from any mutation
 *  that changes the user's hierarchy: recruiter assignment, manager assignment,
 *  role change, group change, deactivation. */
export function invalidatePermissionCache(userId: string): void {
  for (const key of cache.keys()) {
    if (key.split(':')[1] === userId) cache.delete(key);
  }
}

/** Wipe everything — used by tests + emergency cache stampede recovery. */
export function clearPermissionCache(): void {
  cache.clear();
}

/**
 * Returns the set of user ids the caller is permitted to message. Pure forward
 * lookup; canMessageUser does NOT do a reverse check.
 */
export async function getAccessibleUserIds(caller: PermissionCaller): Promise<Set<string>> {
  const cached = cacheGet(caller);
  if (cached) return cached;

  // ── ADMIN_TIER: full workspace visibility ─────────────────────────────────
  if (ADMIN_ROLES.includes(caller.role)) {
    const { data } = await db
      .from('users')
      .select('id')
      .neq('id', caller.id)
      .neq('is_active', false);
    const ids: Set<string> = new Set((data ?? []).map((u: { id: string }) => u.id));
    cacheSet(caller, ids);
    return ids;
  }

  const peerIds = new Set<string>();

  // ── MANAGER / HR_MANAGER (group leads) ────────────────────────────────────
  if (MANAGER_LIKE.includes(caller.role)) {
    // 1. Admin tier (upward leadership).
    const { data: admins } = await db
      .from('users')
      .select('id')
      .in('role', ADMIN_ROLES as unknown as string[])
      .neq('is_active', false);
    for (const a of (admins ?? []) as Array<{ id: string }>) peerIds.add(a.id);

    // 2. Org-wide peer chat — every other MANAGER and HR_MANAGER.
    const { data: peers } = await db
      .from('users')
      .select('id')
      .in('role', MANAGER_LIKE as unknown as string[])
      .neq('is_active', false);
    for (const p of (peers ?? []) as Array<{ id: string }>) peerIds.add(p.id);

    // 3. Group-scoped: recruiters + consultants in OWN GROUP.
    //    A lead with no group_id is fail-closed here (peers + admins still
    //    reachable above, but no group surface — matches groupScope semantics).
    if (caller.group_id) {
      const { data: groupMembers } = await db
        .from('users')
        .select('id')
        .eq('group_id', caller.group_id)
        .in('role', ['RECRUITER', 'CONSULTANT'])
        .neq('is_active', false);
      for (const u of (groupMembers ?? []) as Array<{ id: string }>) peerIds.add(u.id);
    }

    // 4. Cross-group exception: recruiters this manager supervises via the
    //    recruiter_managers junction or the legacy recruiters.manager_id
    //    column, PLUS those recruiters' consultants. Lets a manager who is
    //    assigned as a supervisor across groups still reach those people.
    const { data: legacyRecs } = await db
      .from('recruiters')
      .select('id, user_id')
      .eq('manager_id', caller.id);
    const recruiterRowIds = new Set<string>();
    for (const r of (legacyRecs ?? []) as Array<{ id: string; user_id: string | null }>) {
      recruiterRowIds.add(r.id);
      if (r.user_id) peerIds.add(r.user_id);
    }
    const { data: junctionRecs } = await db
      .from('recruiter_managers')
      .select('recruiter_id')
      .eq('manager_id', caller.id);
    const junctionRecruiterIds = (junctionRecs ?? []) as Array<{ recruiter_id: string }>;
    if (junctionRecruiterIds.length > 0) {
      const extraIds = junctionRecruiterIds
        .map((r) => r.recruiter_id)
        .filter((id) => !recruiterRowIds.has(id));
      if (extraIds.length > 0) {
        const { data: extraRecs } = await db
          .from('recruiters')
          .select('id, user_id')
          .in('id', extraIds);
        for (const r of (extraRecs ?? []) as Array<{ id: string; user_id: string | null }>) {
          recruiterRowIds.add(r.id);
          if (r.user_id) peerIds.add(r.user_id);
        }
      }
    }
    if (recruiterRowIds.size > 0) {
      const { data: cons } = await db
        .from('consultants')
        .select('user_id')
        .in('recruiter_id', [...recruiterRowIds]);
      for (const c of (cons ?? []) as Array<{ user_id: string | null }>) {
        if (c.user_id) peerIds.add(c.user_id);
      }
    }
  }

  // ── RECRUITER ─────────────────────────────────────────────────────────────
  if (caller.role === 'RECRUITER') {
    // 1. Admin tier (upward).
    const { data: admins } = await db
      .from('users')
      .select('id')
      .in('role', ADMIN_ROLES as unknown as string[])
      .neq('is_active', false);
    for (const a of (admins ?? []) as Array<{ id: string }>) peerIds.add(a.id);

    // 2. Org-wide peer chat — every other RECRUITER.
    const { data: recs } = await db
      .from('users')
      .select('id')
      .eq('role', 'RECRUITER')
      .neq('is_active', false);
    for (const r of (recs ?? []) as Array<{ id: string }>) peerIds.add(r.id);

    // 3. Own reporting chain: assigned manager(s) via recruiter_managers
    //    junction + the legacy single-manager column.
    const { data: myRec } = await db
      .from('recruiters')
      .select('id, manager_id')
      .eq('user_id', caller.id)
      .maybeSingle();
    const recRow = myRec as { id?: string; manager_id?: string | null } | null;
    if (recRow?.id) {
      if (recRow.manager_id) peerIds.add(recRow.manager_id);
      const { data: mgrs } = await db
        .from('recruiter_managers')
        .select('manager_id')
        .eq('recruiter_id', recRow.id);
      for (const m of (mgrs ?? []) as Array<{ manager_id: string }>) {
        if (m.manager_id) peerIds.add(m.manager_id);
      }
      // Own consultants.
      const { data: cons } = await db
        .from('consultants')
        .select('user_id')
        .eq('recruiter_id', recRow.id);
      for (const c of (cons ?? []) as Array<{ user_id: string | null }>) {
        if (c.user_id) peerIds.add(c.user_id);
      }
    }

    // 4. In-group manager-tier — covers managers/HR who lead the recruiter's
    //    group but aren't named via recruiter_managers (the bidirectional
    //    counterpart to "manager sees in-group recruiters").
    if (caller.group_id) {
      const { data: groupMgrs } = await db
        .from('users')
        .select('id')
        .eq('group_id', caller.group_id)
        .in('role', MANAGER_LIKE as unknown as string[])
        .neq('is_active', false);
      for (const m of (groupMgrs ?? []) as Array<{ id: string }>) peerIds.add(m.id);
    }
  }

  // ── CONSULTANT ────────────────────────────────────────────────────────────
  if (caller.role === 'CONSULTANT') {
    const { data: me } = await db
      .from('consultants')
      .select('recruiter_id')
      .eq('user_id', caller.id)
      .maybeSingle();
    const cRow = me as { recruiter_id?: string | null } | null;
    if (cRow?.recruiter_id) {
      const { data: rec } = await db
        .from('recruiters')
        .select('id, user_id, manager_id')
        .eq('id', cRow.recruiter_id)
        .maybeSingle();
      const recRow2 = rec as {
        id?: string;
        user_id?: string | null;
        manager_id?: string | null;
      } | null;
      if (recRow2?.user_id) peerIds.add(recRow2.user_id);
      if (recRow2?.manager_id) peerIds.add(recRow2.manager_id);
      if (recRow2?.id) {
        const { data: mgrs } = await db
          .from('recruiter_managers')
          .select('manager_id')
          .eq('recruiter_id', recRow2.id);
        for (const m of (mgrs ?? []) as Array<{ manager_id: string }>) {
          if (m.manager_id) peerIds.add(m.manager_id);
        }
      }
    }
    // Plus manager-tier users in the consultant's own group — covers the HR/
    // manager who leads the group even when not named via recruiter_managers.
    // By the Phase 14 invariant the consultant's group equals their recruiter's.
    if (caller.group_id) {
      const { data: groupMgrs } = await db
        .from('users')
        .select('id')
        .eq('group_id', caller.group_id)
        .in('role', MANAGER_LIKE as unknown as string[])
        .neq('is_active', false);
      for (const m of (groupMgrs ?? []) as Array<{ id: string }>) peerIds.add(m.id);
    }
  }

  // ── DEVELOPER (support-chat exception) ───────────────────────────────────
  // A developer is excluded from BUSINESS_ROLES everywhere else, but for chat
  // they need to be able to reply to bug-report pings from any user. So they
  // reach every active user — mirroring the admin support reach. Capability
  // grants are unrelated to this; this rule applies to every DEVELOPER.
  if (caller.role === 'DEVELOPER') {
    const { data } = await db
      .from('users')
      .select('id')
      .neq('id', caller.id)
      .neq('is_active', false);
    for (const u of (data ?? []) as Array<{ id: string }>) peerIds.add(u.id);
  }

  // ── Universal: any active user can reach an active DEVELOPER ─────────────
  // Bug/error reporting. Non-admin callers had no developer in their forward
  // set above; admin-tier short-circuited earlier with the full user list (no
  // role filter), so this only matters for non-admin callers. Inactive devs
  // are filtered out, same as any other target.
  if (!ADMIN_ROLES.includes(caller.role) && caller.role !== 'DEVELOPER') {
    const { data: devs } = await db
      .from('users')
      .select('id')
      .eq('role', 'DEVELOPER')
      .neq('is_active', false);
    for (const d of (devs ?? []) as Array<{ id: string }>) peerIds.add(d.id);
  }

  peerIds.delete(caller.id);
  cacheSet(caller, peerIds);
  return peerIds;
}

/**
 * One-target convenience check. Pure forward lookup — the per-role rules in
 * getAccessibleUserIds are explicitly bidirectional, so a reverse fallback
 * would only over-broaden (e.g. let any consultant message any admin because
 * the admin's accessible set is "everyone").
 */
export async function canMessageUser(caller: PermissionCaller, targetId: string): Promise<boolean> {
  if (!targetId || caller.id === targetId) return false;
  if (ADMIN_ROLES.includes(caller.role)) {
    const { data } = await db
      .from('users')
      .select('id, is_active')
      .eq('id', targetId)
      .maybeSingle();
    const t = data as { id?: string; is_active?: boolean | null } | null;
    return !!t?.id && t.is_active !== false;
  }
  const allowed = await getAccessibleUserIds(caller);
  return allowed.has(targetId);
}

/** Alias — viewing a user requires the same permission as messaging them. */
export async function canViewUser(caller: PermissionCaller, targetId: string): Promise<boolean> {
  return canMessageUser(caller, targetId);
}

/** Alias — starting a conversation IS messaging them; same check. */
export async function canStartConversation(
  caller: PermissionCaller,
  targetId: string,
): Promise<boolean> {
  return canMessageUser(caller, targetId);
}

/** Alias for thread-fetch callsites — same permission as messaging. */
export async function canViewConversation(
  caller: PermissionCaller,
  peerId: string,
): Promise<boolean> {
  return canMessageUser(caller, peerId);
}
