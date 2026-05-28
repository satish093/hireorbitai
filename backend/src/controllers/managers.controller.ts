import { RequestHandler } from 'express';
import { db } from '../config/db';
import { httpError } from '../types';
import { isAdminTier, managerGroupUserIds } from '../services/groupScope';

/**
 * GET /managers
 * List users with role MANAGER or HR_MANAGER.
 *
 * Scoping:
 *   Admin tier (SUPER_ADMIN through DIRECTOR): all groups.
 *   Group lead (HR_MANAGER / MANAGER): only their own group.
 */
export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');

  let q = db
    .from('users')
    .select('id, email, full_name, role, status, group_id, created_at, last_login_at')
    .in('role', ['MANAGER', 'HR_MANAGER'])
    .order('full_name');

  if (!isAdminTier(req.user.role)) {
    // Group lead: only see peer managers in their own group.
    const groupUserIds = await managerGroupUserIds(req.user);
    if (groupUserIds !== null) {
      if (groupUserIds.length === 0) {
        res.json([]);
        return;
      }
      q = q.in('id', groupUserIds);
    }
  }

  const { data, error } = await q;
  if (error) throw httpError(500, 'Database error');

  // Attach recruiter count for each manager (recruiters whose primary manager_id
  // matches this user, via recruiter_managers is_primary OR legacy column).
  const managerIds = (data ?? []).map((u: any) => u.id);
  let recruiterCountById: Record<string, number> = {};
  if (managerIds.length > 0) {
    const { data: recs } = await db
      .from('recruiters')
      .select('manager_id')
      .in('manager_id', managerIds);
    for (const r of (recs ?? []) as Array<{ manager_id: string | null }>) {
      if (r.manager_id) {
        recruiterCountById[r.manager_id] = (recruiterCountById[r.manager_id] ?? 0) + 1;
      }
    }
  }

  res.json(
    (data ?? []).map((u: any) => ({
      ...u,
      recruiter_count: recruiterCountById[u.id] ?? 0,
    })),
  );
};
