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
import { ADMIN_TIER, GROUP_LEAD_ROLES, type Role } from '../types';

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
