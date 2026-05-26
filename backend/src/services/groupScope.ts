/**
 * Group-scoped visibility for the group lead (HR_MANAGER).
 *
 * Org model: an HR_MANAGER leads ONE group (bench/pod) and only sees the people
 * in that group. Admin-tier (DIRECTOR/CTO/CEO/SUPER_ADMIN) oversees ALL groups,
 * so they are NOT scoped here — a DIRECTOR sees every HR_MANAGER and their
 * teams. RECRUITER/CONSULTANT already have their own narrower row-scoping in
 * each controller, and MANAGER is currently parked (no tier access), so neither
 * is scoped here.
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
import type { Role } from '../types';

interface Caller {
  role: Role;
  group_id?: string | null;
}

/**
 * User ids visible to the caller under group scoping.
 *   - `null`      → caller is not group-scoped (apply no extra filter).
 *   - `string[]`  → the user ids in the HR_MANAGER's group (filter `user_id` IN …).
 * An HR_MANAGER with no group is scoped to an EMPTY set (sees nobody) —
 * fail-closed, never a silent org-wide leak.
 */
export async function managerGroupUserIds(caller: Caller): Promise<string[] | null> {
  if (caller.role !== 'HR_MANAGER') return null;
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
