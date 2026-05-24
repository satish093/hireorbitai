/**
 * Centralized permission engine for hierarchy-aware messaging (and any future
 * feature that needs the same access-control semantics).
 *
 * Single source of truth for "can user A reach user B?" — every controller
 * that needs the answer calls into this module instead of re-implementing
 * the rules. Keeps the directory, send, thread, and read endpoints in
 * lockstep when a role-mapping change ships.
 *
 * Backed by the existing schema — no new tables. Reads from:
 *   - public.users.reports_to (org chart)
 *   - public.recruiter_managers (many-to-many recruiter → manager)
 *   - public.recruiters.manager_id (legacy single manager, still consulted
 *     for backwards compat with rows pre-migration)
 *   - public.consultants.recruiter_id (single recruiter per consultant)
 *   - public.users.group_id (per-org/team grouping)
 *
 * Performance: each call issues 3-5 small indexed queries against the above
 * tables. Fine for the current message-route volume; a future phase will
 * add a request-scoped cache + a denormalized user_relationships table to
 * cut this to a single index lookup.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { ADMIN_TIER, type Role } from '../types';

const ADMIN_ROLES = ADMIN_TIER as readonly Role[];
// Sub-managers: see their own recruiter/consultant subtree only (not the whole workspace)
const SUB_MGR_ROLES: Role[] = ['MANAGER', 'HR_MANAGER', 'DEVELOPER'];

export interface PermissionCaller {
  id: string;
  role: Role;
}

// ---------------------------------------------------------------------------
// In-memory permission cache
//
// Hierarchy data (reports_to / recruiter_managers / consultants.recruiter_id)
// changes infrequently — most user actions don't touch it at all. Re-resolving
// the same caller's accessible-user set on every message route lookup is wasted
// work. A 30-second TTL collapses N requests-in-quick-succession into one
// real DB pass.
//
// Single-process cache only — each PM2 worker has its own. That's fine here:
//   - We're not at cluster-wide scale (1-3 workers max on the current VPS).
//   - Worst-case staleness across workers is bounded by TTL.
//   - Cross-worker invalidation would need Redis pub/sub, which is not yet
//     worth the dependency cost.
//
// Call `invalidatePermissionCache(userId)` from any code path that changes a
// user's hierarchy (group reassignment, recruiter reassignment, status
// flip, etc.) so stale caches don't keep a removed peer reachable. Until
// those call sites land, the 30s TTL is the only safety net — acceptable
// since the audit log records every blocked attempt regardless.
// ---------------------------------------------------------------------------
interface CacheEntry {
  ids: Set<string>;
  expiresAt: number;
}
const TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(caller: PermissionCaller): string {
  // Role is part of the key because a role change must immediately re-route
  // through the slow path. A user who gets demoted from MANAGER → RECRUITER
  // shouldn't keep seeing the full workspace from the cache.
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
  // Bound memory: at ~32 bytes per entry × thousands of users this is
  // basically nothing, but if it ever runs away the eviction below kicks in.
  if (cache.size > 5_000) {
    // Drop the oldest 1k to keep p99 lookup cost flat.
    const drop = [...cache.entries()].slice(0, 1_000);
    for (const [k] of drop) cache.delete(k);
    logger.debug({ cacheSize: cache.size }, 'permission-cache: evicted oldest 1000');
  }
}

/**
 * Drop the cached accessible-user set for a single user. Call from any code
 * path that mutates the user's hierarchy: group_id changes, recruiter
 * assignment, reports_to edits, role changes, deactivation. Until every
 * such call site invokes this, the 30s TTL remains the safety net.
 */
export function invalidatePermissionCache(userId: string): void {
  // We don't know which role key is cached for this user (it could be any
  // tier they had at the time of cache write), so wipe every entry whose
  // userId matches. Cheap — entries-iteration over a bounded map.
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
 *
 * Rules:
 *   - Manager tier (incl. admin tier): every active user in the workspace
 *     minus self. This is the existing "directory shows everyone" behavior
 *     for managers/admins.
 *   - Recruiter: their consultants (via consultants.recruiter_id), their
 *     managers (recruiter_managers + legacy recruiters.manager_id), plus
 *     anyone in their reports-to chain.
 *   - Consultant: their recruiter, that recruiter's managers, plus anyone
 *     in their reports-to chain.
 *   - All non-admin roles also include anyone they have already exchanged
 *     messages with — legitimacy via prior thread, so a recruiter assignment
 *     change doesn't suddenly kill in-flight conversations.
 *
 * Self is never included in the returned set even if any branch above would
 * have added it.
 */
export async function getAccessibleUserIds(caller: PermissionCaller): Promise<Set<string>> {
  // Cache-first. The miss path is the one that does the 3-5 DB queries; the
  // hit returns a same-process Set instantly.
  const cached = cacheGet(caller);
  if (cached) return cached;

  // Admin tier (SUPER_ADMIN, CEO, CTO, DIRECTOR) sees the whole workspace.
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

  // Sub-manager tier (MANAGER, HR_MANAGER, DEVELOPER): scoped to their own
  // recruiter/consultant subtree + admin users + reports-to chain.
  // Two managers' invitees are fully isolated from each other.
  if (SUB_MGR_ROLES.includes(caller.role)) {
    // Admin tier users are always reachable (upward escalation path).
    const { data: admins } = await db
      .from('users')
      .select('id')
      .in('role', ADMIN_ROLES as unknown as string[])
      .neq('is_active', false);
    for (const a of (admins ?? []) as Array<{ id: string }>) peerIds.add(a.id);

    // Recruiters this manager directly manages.
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

  // Recruiter: my consultants + my managers (both legacy + junction table).
  if (caller.role === 'RECRUITER') {
    const { data: myRec } = await db
      .from('recruiters')
      .select('id, manager_id')
      .eq('user_id', caller.id)
      .maybeSingle();
    const recRow = myRec as { id?: string; manager_id?: string | null } | null;
    if (recRow?.id) {
      // Legacy single-manager column (still populated on older rows).
      if (recRow.manager_id) peerIds.add(recRow.manager_id);
      // Many-to-many junction (canonical going forward).
      const { data: mgrs } = await db
        .from('recruiter_managers')
        .select('manager_id')
        .eq('recruiter_id', recRow.id);
      for (const m of (mgrs ?? []) as Array<{ manager_id: string }>) {
        if (m.manager_id) peerIds.add(m.manager_id);
      }
      // My consultants — by consultants.recruiter_id → consultants.user_id.
      const { data: cons } = await db
        .from('consultants')
        .select('user_id')
        .eq('recruiter_id', recRow.id);
      for (const c of (cons ?? []) as Array<{ user_id: string | null }>) {
        if (c.user_id) peerIds.add(c.user_id);
      }
    }
  }

  // Consultant: my recruiter + that recruiter's managers.
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

  // Reports-to chain (both directions) applies to every non-manager role.
  // The chain is an explicit users.reports_to FK; following it up gives the
  // direct manager, following it down gives subordinates.
  const { data: meUser } = await db
    .from('users')
    .select('reports_to')
    .eq('id', caller.id)
    .maybeSingle();
  const u = meUser as { reports_to?: string | null } | null;
  if (u?.reports_to) peerIds.add(u.reports_to);
  const { data: directReports } = await db.from('users').select('id').eq('reports_to', caller.id);
  for (const r of (directReports ?? []) as Array<{ id: string }>) {
    if (r.id) peerIds.add(r.id);
  }

  // Legitimacy carry-over: anyone the caller has previously exchanged a
  // message with stays reachable. Without this, reassigning a recruiter
  // would silently break every in-flight conversation between that
  // recruiter and their old consultants — confusing and inconsistent with
  // every other chat product. This is also what the existing directory()
  // logic does so behavior stays uniform.
  const { data: existing } = await db
    .from('messages')
    .select('sender_id, recipient_id')
    .or(`sender_id.eq.${caller.id},recipient_id.eq.${caller.id}`);
  for (const m of (existing ?? []) as Array<{ sender_id: string; recipient_id: string }>) {
    if (m.sender_id !== caller.id) peerIds.add(m.sender_id);
    if (m.recipient_id !== caller.id) peerIds.add(m.recipient_id);
  }

  peerIds.delete(caller.id);
  cacheSet(caller, peerIds);
  return peerIds;
}

/**
 * Cheaper variant when the caller only needs to check ONE target id — short-
 * circuits on the admin-tier branch (no big users SELECT) and the existing-
 * message branch (one EXISTS query).
 *
 * Falls back to `getAccessibleUserIds` for the general case.
 */
export async function canMessageUser(caller: PermissionCaller, targetId: string): Promise<boolean> {
  if (!targetId || caller.id === targetId) return false;
  if (ADMIN_ROLES.includes(caller.role)) {
    // Admin tier can message any active user. Cheap existence check.
    const { data } = await db
      .from('users')
      .select('id, is_active')
      .eq('id', targetId)
      .maybeSingle();
    const t = data as { id?: string; is_active?: boolean | null } | null;
    return !!t?.id && t.is_active !== false;
  }
  // Fast-path for the recipient already being a known thread participant —
  // saves the full hierarchy resolution on the common "reply to existing
  // conversation" path.
  const { count: priorCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .or(
      `and(sender_id.eq.${caller.id},recipient_id.eq.${targetId}),` +
        `and(sender_id.eq.${targetId},recipient_id.eq.${caller.id})`,
    );
  if ((priorCount ?? 0) > 0) return true;

  // Slow path: full hierarchy lookup.
  const allowed = await getAccessibleUserIds(caller);
  return allowed.has(targetId);
}

/**
 * Alias kept for parity with the spec — viewing a user (e.g. to show their
 * avatar in a UI surface) requires the same permission as messaging them.
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
 * Same as canMessageUser but explicitly named for thread-fetch callsites —
 * makes denied-access audit metadata cleaner ("reason: cannot view
 * conversation" vs "cannot send message").
 */
export async function canViewConversation(
  caller: PermissionCaller,
  peerId: string,
): Promise<boolean> {
  return canMessageUser(caller, peerId);
}
