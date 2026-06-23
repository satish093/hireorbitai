import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, outranks, MANAGER_TIER, type Role } from '../types';
import { invalidatePermissionCache } from '../services/permission.service';
import { isAdminTier, managerGroupUserIds } from '../services/groupScope';
import { audit } from '../services/audit.service';

const LEAD_ROLES = ['MANAGER', 'HR_MANAGER'] as const;

/** True for the "schema cache" / "relation does not exist" error fired before
 *  the manager_group_grants migration has been applied. */
function grantsTableMissing(message: string | undefined): boolean {
  if (!message) return false;
  return /schema cache|relation .* does not exist|column/i.test(message);
}

/** A director may only grant co-management to someone they outrank. SUPER_ADMIN
 *  bypasses; targets are route-restricted to MANAGER/HR_MANAGER so this is
 *  defense-in-depth against a future widening of the route gate. */
function assertOutranksTarget(actorRole: Role, targetRole: Role): void {
  if (actorRole === 'SUPER_ADMIN') return;
  if (!outranks(actorRole, targetRole)) {
    throw httpError(403, `You cannot grant co-management to a ${targetRole}.`);
  }
}

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

    // Drop stale recruiters from the counts: a recruiter demoted out of the
    // RECRUITER / manager-tier roles leaves a recruiters row behind that must
    // not keep inflating their old manager's recruiter_count.
    const allRecruiterIds = Array.from(
      new Set(Array.from(byManager.values()).flatMap((s) => Array.from(s))),
    );
    if (allRecruiterIds.length > 0) {
      const { data: rRoles } = await db
        .from('recruiters')
        .select('id, user:users!user_id(role, is_active)')
        .in('id', allRecruiterIds);
      const valid = new Set(
        (
          (rRoles ?? []) as Array<{
            id: string;
            user?: { role?: string | null; is_active?: boolean | null } | null;
          }>
        )
          .filter((r) => {
            if (r.user?.is_active === false) return false;
            const role = r.user?.role;
            return (
              !role || role === 'RECRUITER' || (MANAGER_TIER as readonly string[]).includes(role)
            );
          })
          .map((r) => r.id),
      );
      for (const set of byManager.values()) {
        for (const rid of Array.from(set)) if (!valid.has(rid)) set.delete(rid);
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

// ---------------------------------------------------------------------------
// Cross-group co-management grants (manager_group_grants)
//
// An admin-tier user grants a MANAGER / HR_MANAGER the same group-lead scope
// over ANOTHER group — its recruiters, consultants, pipeline and messaging —
// alongside that group's own lead. The scope itself is enforced centrally in
// groupScope.managerGroupUserIds (which unions granted groups) and
// permission.service (messaging); these endpoints only manage the grant rows.
// ---------------------------------------------------------------------------

/** Load a target user and confirm they are a MANAGER / HR_MANAGER. Missing user
 *  → 404; an existing non-lead → 400 with a clear reason. These endpoints are
 *  admin-tier only, so distinguishing the two leaks nothing an admin can't
 *  already see via /admin/users. */
async function loadLead(
  managerId: string,
): Promise<{ id: string; role: Role; group_id: string | null; is_active: boolean | null }> {
  const { data } = await db
    .from('users')
    .select('id, role, group_id, is_active')
    .eq('id', managerId)
    .maybeSingle();
  const m = data as {
    id: string;
    role: Role;
    group_id: string | null;
    is_active: boolean | null;
  } | null;
  if (!m) throw httpError(404, 'Manager not found');
  if (!(LEAD_ROLES as readonly string[]).includes(m.role)) {
    throw httpError(400, 'Co-management can only be granted to a Manager or HR Manager.');
  }
  return m;
}

/** GET /managers/:id/grants — list the groups a lead co-manages. */
export const listGrants: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadLead(req.params.id);

  const { data, error } = await db
    .from('manager_group_grants')
    .select('id, group_id, created_at')
    .eq('manager_id', req.params.id);
  if (error) {
    // Table not migrated yet → behave as "no grants" rather than 500.
    if (grantsTableMissing(error.message)) {
      res.json([]);
      return;
    }
    throw httpError(500, 'Database error');
  }
  res.json(data ?? []);
};

const addGrantSchema = z.object({ group_id: z.string().uuid() }).strict();

/** POST /managers/:id/grants — grant a lead co-management of another group. */
export const addGrant: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isAdminTier(req.user.role)) throw httpError(403, 'Forbidden');
  const parsed = addGrantSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const managerId = req.params.id;
  const { group_id } = parsed.data;

  const manager = await loadLead(managerId);
  if (manager.is_active === false) throw httpError(400, 'Cannot grant to an inactive user.');
  assertOutranksTarget(req.user.role, manager.role);

  if (manager.group_id && manager.group_id === group_id) {
    throw httpError(400, 'This is the manager’s own group.');
  }

  const { data: grp } = await db.from('user_groups').select('id').eq('id', group_id).maybeSingle();
  if (!grp) throw httpError(404, 'Group not found');

  const { data, error } = await db
    .from('manager_group_grants')
    .upsert(
      { manager_id: managerId, group_id, granted_by: req.user.id },
      { onConflict: 'manager_id,group_id' },
    )
    .select('id, group_id, created_at')
    .single();
  if (error) {
    if (grantsTableMissing(error.message)) {
      throw httpError(
        503,
        'Co-management grants are unavailable until the database migration is applied.',
      );
    }
    throw httpError(500, 'Database error');
  }

  invalidatePermissionCache(managerId);
  audit({
    action: 'manager_group_grant_added',
    user_id: req.user.id,
    email: req.user.email,
    req,
    metadata: { manager_id: managerId, group_id, granted_by: req.user.id },
  });
  res.status(201).json(data);
};

/** DELETE /managers/:id/grants/:groupId — revoke a co-management grant.
 *  Idempotent: a missing row is a no-op (no 404). */
export const removeGrant: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isAdminTier(req.user.role)) throw httpError(403, 'Forbidden');
  const managerId = req.params.id;
  const groupId = req.params.groupId;

  const { error } = await db
    .from('manager_group_grants')
    .delete()
    .eq('manager_id', managerId)
    .eq('group_id', groupId);
  if (error && !grantsTableMissing(error.message)) throw httpError(500, 'Database error');

  invalidatePermissionCache(managerId);
  audit({
    action: 'manager_group_grant_removed',
    user_id: req.user.id,
    email: req.user.email,
    req,
    metadata: { manager_id: managerId, group_id: groupId },
  });
  res.json({ ok: true });
};
