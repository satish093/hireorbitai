/**
 * Centralized permission engine for hierarchy-aware messaging.
 *
 * Single source of truth for "can user A reach user B?" — every controller
 * that needs the answer calls into this module. Keeping the rules here means
 * directory, send, thread, and read endpoints stay in lockstep automatically.
 *
 * Permission model (strict role + assignment only):
 *
 *   ADMIN_TIER (SUPER_ADMIN, CEO, CTO, DIRECTOR)
 *     → every active user in the workspace
 *
 *   SUB_MANAGER (MANAGER, HR_MANAGER) — the group leads
 *     → admin-tier users (upward escalation)
 *     → recruiters they directly manage (recruiter_managers + legacy manager_id)
 *     → consultants of those recruiters
 *
 *   DEVELOPER holds NO default messaging visibility — it is a scoped super-admin
 *   whose access comes only from explicit capability grants, none of which is a
 *   messaging/visibility grant. So a DEVELOPER sees nobody here by default.
 *
 *   RECRUITER (org-wide staff chat — product decision)
 *     → every active STAFF user (OPERATOR_TIER: recruiters, group leads, admins)
 *     → their own assigned consultants (consultants.recruiter_id)
 *     Consultants who are not theirs are NOT reachable — consultants stay
 *     assignment-bound. The recipient side is handled by the reverse check in
 *     canMessageUser so staff can read/reply to a recruiter-initiated thread.
 *
 *   CONSULTANT
 *     → their assigned recruiter
 *     → that recruiter's managers
 *
 * No reports_to chain — that is an HR org-chart field, not an assignment.
 * No prior-thread legitimacy — permissions are always current-assignment only.
 * If a consultant is reassigned to a different recruiter, their old recruiter
 * immediately loses access and the new one gains it.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { ADMIN_TIER, OPERATOR_TIER, type Role } from '../types';

const ADMIN_ROLES = ADMIN_TIER as readonly Role[];
// Staff roles (operators) — every business role EXCEPT CONSULTANT and DEVELOPER.
// A recruiter may chat with all active staff org-wide; consultants are NOT in
// this set, so they stay assignment-bound on both sides.
const STAFF_ROLES = OPERATOR_TIER as readonly Role[];
// Group leads only. DEVELOPER is intentionally excluded — it has no default
// business visibility (capability-gated elsewhere), so it falls through to the
// empty peer set below.
const SUB_MGR_ROLES: Role[] = ['MANAGER', 'HR_MANAGER'];

export interface PermissionCaller {
  id: string;
  role: Role;
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
  return `${caller.role}:${caller.id}`;
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

/**
 * Drop the cached accessible-user set for a single user. Call from any code
 * path that mutates the user's hierarchy: recruiter assignment, manager
 * assignment, role change, deactivation, etc.
 */
export function invalidatePermissionCache(userId: string): void {
  for (const key of cache.keys()) {
    if (key.endsWith(`:${userId}`)) cache.delete(key);
  }
}

/** Wipe everything — used by tests + emergency cache stampede recovery. */
export function clearPermissionCache(): void {
  cache.clear();
}

/**
 * Returns the set of user IDs the caller is permitted to message.
 * Permissions are based solely on role and current assignment — no org-chart
 * (reports_to) chain and no prior-thread carry-over.
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

  // ── SUB_MANAGER (MANAGER, HR_MANAGER, DEVELOPER) ─────────────────────────
  // Sees: admins above them + their assigned recruiters + those recruiters'
  // consultants. Two managers' subtrees are fully isolated from each other.
  if (SUB_MGR_ROLES.includes(caller.role)) {
    // Admin-tier users are always reachable (upward escalation path).
    const { data: admins } = await db
      .from('users')
      .select('id')
      .in('role', ADMIN_ROLES as unknown as string[])
      .neq('is_active', false);
    for (const a of (admins ?? []) as Array<{ id: string }>) peerIds.add(a.id);

    // Recruiters this manager directly manages — legacy single manager_id column.
    const { data: legacyRecs } = await db
      .from('recruiters')
      .select('id, user_id')
      .eq('manager_id', caller.id);
    const recruiterRowIds = new Set<string>();
    for (const r of (legacyRecs ?? []) as Array<{ id: string; user_id: string | null }>) {
      recruiterRowIds.add(r.id);
      if (r.user_id) peerIds.add(r.user_id);
    }

    // Many-to-many junction (canonical for newer rows).
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

    // Consultants of all those recruiters.
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
  // Org-wide STAFF chat (product decision): a recruiter may message every active
  // staff user (OPERATOR_TIER — recruiters, group leads, admins), PLUS their own
  // assigned consultants. Consultants who are NOT theirs are intentionally
  // excluded so consultants stay assignment-bound on both sides.
  if (caller.role === 'RECRUITER') {
    const { data: staff } = await db
      .from('users')
      .select('id')
      .in('role', STAFF_ROLES as unknown as string[])
      .neq('is_active', false);
    for (const u of (staff ?? []) as Array<{ id: string }>) peerIds.add(u.id);

    // Plus this recruiter's own assigned consultants.
    const { data: myRec } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', caller.id)
      .maybeSingle();
    const recRow = myRec as { id?: string } | null;
    if (recRow?.id) {
      const { data: cons } = await db
        .from('consultants')
        .select('user_id')
        .eq('recruiter_id', recRow.id);
      for (const c of (cons ?? []) as Array<{ user_id: string | null }>) {
        if (c.user_id) peerIds.add(c.user_id);
      }
    }
  }

  // ── CONSULTANT ────────────────────────────────────────────────────────────
  // Sees: their assigned recruiter + that recruiter's managers only.
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
      const recRow = rec as {
        id?: string;
        user_id?: string | null;
        manager_id?: string | null;
      } | null;
      if (recRow?.user_id) peerIds.add(recRow.user_id);
      if (recRow?.manager_id) peerIds.add(recRow.manager_id);
      if (recRow?.id) {
        const { data: mgrs } = await db
          .from('recruiter_managers')
          .select('manager_id')
          .eq('recruiter_id', recRow.id);
        for (const m of (mgrs ?? []) as Array<{ manager_id: string }>) {
          if (m.manager_id) peerIds.add(m.manager_id);
        }
      }
    }
  }

  peerIds.delete(caller.id);
  cacheSet(caller, peerIds);
  return peerIds;
}

/**
 * Cheaper variant when the caller only needs to check ONE target id.
 * Falls back to `getAccessibleUserIds` — no prior-thread fast-path.
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
  if (allowed.has(targetId)) return true;

  // Reverse direction. A conversation needs BOTH participants to be able to view
  // it, so if the target is permitted to open a thread with the caller, the
  // caller may view/reply too (e.g. a recruiter with org-wide staff reach
  // messaged this user — the recipient must be able to read and reply).
  //
  // We deliberately do NOT grant reverse access when the target is admin-tier:
  // an admin's accessible set is "everyone", so a symmetric admin rule would let
  // any user message any admin. Admins still initiate to anyone (above); they
  // are reached only by users who already have them in their forward set.
  const { data } = await db
    .from('users')
    .select('role, is_active')
    .eq('id', targetId)
    .maybeSingle();
  const t = data as { role?: Role; is_active?: boolean | null } | null;
  if (!t?.role || t.is_active === false) return false;
  if (ADMIN_ROLES.includes(t.role)) return false;
  const reverse = await getAccessibleUserIds({ id: targetId, role: t.role });
  return reverse.has(caller.id);
}

/**
 * Alias — viewing a user requires the same permission as messaging them.
 */
export async function canViewUser(caller: PermissionCaller, targetId: string): Promise<boolean> {
  return canMessageUser(caller, targetId);
}

/**
 * Alias — starting a conversation IS messaging them; same check.
 */
export async function canStartConversation(
  caller: PermissionCaller,
  targetId: string,
): Promise<boolean> {
  return canMessageUser(caller, targetId);
}

/**
 * Alias for thread-fetch callsites — same permission as messaging.
 */
export async function canViewConversation(
  caller: PermissionCaller,
  peerId: string,
): Promise<boolean> {
  return canMessageUser(caller, peerId);
}
