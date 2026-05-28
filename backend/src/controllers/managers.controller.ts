import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';
import { invalidatePermissionCache } from '../services/permission.service';
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

  // Attach recruiter count for each manager. Count both legacy recruiters.manager_id
  // and the recruiter_managers junction table, de-duped per manager.
  const managerIds = (data ?? []).map((u: any) => u.id);
  let recruiterCountById: Record<string, number> = {};
  if (managerIds.length > 0) {
    const byManager = new Map<string, Set<string>>();
    const add = (managerId: string | null, recruiterId: string | null) => {
      if (!managerId || !recruiterId) return;
      if (!byManager.has(managerId)) byManager.set(managerId, new Set());
      byManager.get(managerId)!.add(recruiterId);
    };

    const { data: recs } = await db
      .from('recruiters')
      .select('id, manager_id')
      .in('manager_id', managerIds);
    for (const r of (recs ?? []) as Array<{ id: string; manager_id: string | null }>) {
      add(r.manager_id, r.id);
    }

    const { data: links, error: linkErr } = await db
      .from('recruiter_managers')
      .select('recruiter_id, manager_id')
      .in('manager_id', managerIds);
    if (!linkErr) {
      for (const l of (links ?? []) as Array<{ recruiter_id: string; manager_id: string }>) {
        add(l.manager_id, l.recruiter_id);
      }
    }

    recruiterCountById = Object.fromEntries(
      Array.from(byManager.entries()).map(([managerId, ids]) => [managerId, ids.size]),
    );
  }

  res.json(
    (data ?? []).map((u: any) => ({
      ...u,
      recruiter_count: recruiterCountById[u.id] ?? 0,
    })),
  );
};

const moveGroupSchema = z
  .object({
    group_id: z.string().uuid().nullable(),
    confirm_unassign_recruiters: z.boolean().optional(),
  })
  .strict();

/**
 * POST /managers/:id/move-group
 * Move a MANAGER / HR_MANAGER user. If any recruiters report to that manager,
 * the caller must confirm; confirmed moves detach those recruiters first.
 */
export const moveGroup: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isAdminTier(req.user.role)) throw httpError(403, 'Forbidden');

  const parsed = moveGroupSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const managerId = req.params.id;
  const { data: manager } = await db
    .from('users')
    .select('id, email, role, group_id')
    .eq('id', managerId)
    .maybeSingle();
  const row = manager as {
    id: string;
    email: string;
    role: string;
    group_id: string | null;
  } | null;
  if (!row || !['MANAGER', 'HR_MANAGER'].includes(row.role)) {
    throw httpError(404, 'Manager not found');
  }

  const changingGroup = parsed.data.group_id !== row.group_id;

  const recruiterIds = new Set<string>();
  const recruiterUserIds = new Set<string>();
  const { data: legacyRecs } = await db
    .from('recruiters')
    .select('id, user_id')
    .eq('manager_id', managerId);
  for (const r of (legacyRecs ?? []) as Array<{ id: string; user_id: string | null }>) {
    recruiterIds.add(r.id);
    if (r.user_id) recruiterUserIds.add(r.user_id);
  }

  const { data: links, error: linkErr } = await db
    .from('recruiter_managers')
    .select('recruiter_id')
    .eq('manager_id', managerId);
  if (!linkErr) {
    const linkIds = ((links ?? []) as Array<{ recruiter_id: string }>).map((l) => l.recruiter_id);
    for (const id of linkIds) recruiterIds.add(id);
    if (linkIds.length > 0) {
      const { data: linkedRecs } = await db
        .from('recruiters')
        .select('id, user_id')
        .in('id', linkIds);
      for (const r of (linkedRecs ?? []) as Array<{ id: string; user_id: string | null }>) {
        if (r.user_id) recruiterUserIds.add(r.user_id);
      }
    }
  }

  if (changingGroup && recruiterIds.size > 0 && !parsed.data.confirm_unassign_recruiters) {
    throw httpError(
      409,
      `${recruiterIds.size} recruiter${recruiterIds.size === 1 ? ' is' : 's are'} assigned to this manager. Confirm to unassign them before moving.`,
    );
  }

  if (changingGroup && recruiterIds.size > 0) {
    const ids = Array.from(recruiterIds);
    const { error: legacyErr } = await db
      .from('recruiters')
      .update({ manager_id: null })
      .in('id', ids);
    if (legacyErr) throw httpError(500, 'Database error');

    if (!linkErr) {
      const { error: deleteErr } = await db
        .from('recruiter_managers')
        .delete()
        .eq('manager_id', managerId);
      if (deleteErr) throw httpError(500, 'Database error');
    }
    for (const userId of recruiterUserIds) invalidatePermissionCache(userId);
  }

  const { data, error } = await db
    .from('users')
    .update({ group_id: parsed.data.group_id })
    .eq('id', managerId)
    .select('id, email, full_name, role, status, group_id, created_at, last_login_at')
    .single();
  if (error) throw httpError(500, 'Database error');

  invalidatePermissionCache(managerId);

  res.json({
    ...data,
    recruiter_count: 0,
    unassigned_recruiters: changingGroup ? recruiterIds.size : 0,
  });
};
