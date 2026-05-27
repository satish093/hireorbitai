/**
 * Group-scoped visibility for the group leads (HR_MANAGER + MANAGER).
 *
 * Org model: a group lead (HR_MANAGER or MANAGER) leads ONE group (bench/pod)
 * and only sees the people in that group. Admin-tier (DIRECTOR/CTO/CEO/
 * SUPER_ADMIN) oversees ALL groups, so they are NOT scoped here — a DIRECTOR
 * sees every group lead and their teams. RECRUITER/CONSULTANT already have their
 * own narrower row-scoping in each controller, so they are not scoped here.
 *
 * Usage in a list endpoint's manager-tier branch:
 *
 *   const groupUserIds = await managerGroupUserIds(req.user);
 *   if (groupUserIds !== null) {
 *     if (groupUserIds.length === 0) { res.json([]); return; }   // fail-closed
 *     q = q.in('user_id', groupUserIds);
 *   }
 */

import { db } from '../config/db';
import { httpError, ADMIN_TIER, GROUP_LEAD_ROLES, type Role } from '../types';

interface Caller {
  role: Role;
  group_id?: string | null;
}

/** True for the group-scoped lead roles (HR_MANAGER + MANAGER). */
export function isGroupLead(role: Role): boolean {
  return GROUP_LEAD_ROLES.includes(role);
}

/** True for admin-tier callers, who are never group-scoped (see all groups). */
export function isAdminTier(role: Role): boolean {
  return (ADMIN_TIER as Role[]).includes(role);
}

/**
 * Detail/update authorization for group leads, keyed by the record's owning
 * USER id. Returns true only when the caller is a group lead AND the owner is in
 * their group. (Admin-tier callers should be allowed BEFORE calling this — they
 * are not group-scoped.) A lead with no group returns false (fail-closed).
 */
export async function leadCanAccessUser(caller: Caller, ownerUserId: string): Promise<boolean> {
  const ids = await managerGroupUserIds(caller);
  return ids !== null && ids.includes(ownerUserId);
}

/** Same as leadCanAccessUser but keyed by a consultant row id. */
export async function leadCanAccessConsultant(
  caller: Caller,
  consultantId: string,
): Promise<boolean> {
  const ids = await managerGroupConsultantIds(caller);
  return ids !== null && ids.includes(consultantId);
}

/**
 * User ids visible to the caller under group scoping.
 *   - `null`      → caller is not group-scoped (apply no extra filter).
 *   - `string[]`  → the user ids in the group lead's group (filter `user_id` IN …).
 * A group lead with no group is scoped to an EMPTY set (sees nobody) —
 * fail-closed, never a silent org-wide leak.
 */
export async function managerGroupUserIds(caller: Caller): Promise<string[] | null> {
  if (!GROUP_LEAD_ROLES.includes(caller.role)) return null;
  if (!caller.group_id) return [];
  const { data } = await db.from('users').select('id').eq('group_id', caller.group_id);
  return (data ?? []).map((u: { id: string }) => u.id);
}

/**
 * Consultant ids whose owning user is in the HR_MANAGER's group — for scoping
 * pipeline lists (applications, interviews) that reference `consultant_id`.
 *   - `null`     → not group-scoped.
 *   - `string[]` → consultant ids in the group (filter `consultant_id` IN …).
 */
export async function managerGroupConsultantIds(caller: Caller): Promise<string[] | null> {
  const userIds = await managerGroupUserIds(caller);
  if (userIds === null) return null;
  if (userIds.length === 0) return [];
  const { data } = await db.from('consultants').select('id').in('user_id', userIds);
  return (data ?? []).map((c: { id: string }) => c.id);
}

// ---------------------------------------------------------------------------
// Canonical throwing scope guards. Every mutation that accepts a user_id /
// consultant_id / recruiter_id / group_id should funnel its actor-scope check
// through one of these instead of re-implementing the tiered logic:
//   - ADMIN_TIER            → unscoped (always allowed)
//   - GROUP LEAD (HR/MGR)   → only within their own group; FAIL-CLOSED with no group
//   - RECRUITER             → only their own assigned rows / themselves
//   - CONSULTANT            → only themselves
// Each throws httpError(403) when out of scope.
// ---------------------------------------------------------------------------

interface ScopeCaller {
  id: string;
  role: Role;
  group_id?: string | null;
}

/** Caller may act on the user row `userId`. */
export async function assertCanAccessUser(caller: ScopeCaller, userId: string): Promise<void> {
  if (isAdminTier(caller.role)) return;
  if (caller.id === userId) return; // self
  if (isGroupLead(caller.role) && (await leadCanAccessUser(caller, userId))) return;
  throw httpError(403, 'Forbidden');
}

/** Caller may act on the consultant row `consultantId`. */
export async function assertCanAccessConsultant(
  caller: ScopeCaller,
  consultantId: string,
): Promise<void> {
  if (isAdminTier(caller.role)) return;
  const { data } = await db
    .from('consultants')
    .select('id, user_id, recruiter_id')
    .eq('id', consultantId)
    .maybeSingle();
  const cons = data as { id: string; user_id: string | null; recruiter_id: string | null } | null;
  if (!cons) throw httpError(403, 'Forbidden');
  if (isGroupLead(caller.role)) {
    if (cons.user_id && (await leadCanAccessUser(caller, cons.user_id))) return;
    throw httpError(403, 'Forbidden');
  }
  if (caller.role === 'RECRUITER') {
    const { data: rec } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', caller.id)
      .maybeSingle();
    const recId = (rec as { id?: string } | null)?.id ?? null;
    if (recId && cons.recruiter_id === recId) return;
    throw httpError(403, 'Forbidden');
  }
  if (caller.role === 'CONSULTANT' && cons.user_id === caller.id) return;
  throw httpError(403, 'Forbidden');
}

/** Caller may act on the recruiter row `recruiterId`. */
export async function assertCanAccessRecruiter(
  caller: ScopeCaller,
  recruiterId: string,
): Promise<void> {
  if (isAdminTier(caller.role)) return;
  const { data } = await db
    .from('recruiters')
    .select('id, user_id')
    .eq('id', recruiterId)
    .maybeSingle();
  const rec = data as { id: string; user_id: string | null } | null;
  if (!rec) throw httpError(403, 'Forbidden');
  if (caller.role === 'RECRUITER' && rec.user_id === caller.id) return; // own row
  if (isGroupLead(caller.role) && rec.user_id && (await leadCanAccessUser(caller, rec.user_id)))
    return;
  throw httpError(403, 'Forbidden');
}

/** Caller may pre-assign / move into `groupId` (null = "no group", always OK).
 *  Admin tier may assign any group; everyone else only their own group. */
export function assertCanAssignGroup(caller: ScopeCaller, groupId: string | null): void {
  if (!groupId) return;
  if (isAdminTier(caller.role)) return;
  if (groupId === (caller.group_id ?? null)) return;
  throw httpError(403, 'You can only assign your own group.');
}
