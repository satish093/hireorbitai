import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, MANAGER_TIER, type Role } from '../types';
import { invalidatePermissionCache } from '../services/permission.service';
import {
  managerGroupUserIds,
  isAdminTier,
  isGroupLead,
  leadCanAccessUser,
} from '../services/groupScope';

const RECRUITER_MANAGER_ROLES = ['MANAGER', 'HR_MANAGER'] as const;

interface Caller {
  id: string;
  role: Role;
  group_id?: string | null;
}

/**
 * Detail/mutation scope for a recruiter record. Admin-tier is unscoped; a group
 * lead (HR_MANAGER/MANAGER) may only touch a recruiter whose owning user is in
 * their group; a plain RECRUITER caller is left to the route's role gate.
 * Throws 404 on a cross-group reach so it can't be used as an existence oracle.
 */
async function assertRecruiterInScope(
  caller: Caller,
  recruiterUserId: string | null,
): Promise<void> {
  if (isAdminTier(caller.role)) return;
  if (isGroupLead(caller.role)) {
    if (recruiterUserId && (await leadCanAccessUser(caller, recruiterUserId))) return;
    throw httpError(404, 'Recruiter not found');
  }
}

/**
 * Attach `consultant_count` (consultants assigned to each recruiter) to recruiter
 * rows. Counts are inherently group-scoped: a group lead only ever passes the
 * recruiters already filtered to their group, so the counts cover their group
 * only. Admin-tier passes every recruiter and sees every count.
 */
async function attachConsultantCounts<T extends { id?: string }>(rows: T[]): Promise<T[]> {
  if (!rows || rows.length === 0) return rows ?? [];
  const ids = rows.map((r) => r.id).filter((x): x is string => !!x);
  if (ids.length === 0) return rows.map((r) => ({ ...r, consultant_count: 0 }));
  const { data: cons } = await db
    .from('consultants')
    .select('recruiter_id')
    .in('recruiter_id', ids);
  const counts = new Map<string, number>();
  for (const c of (cons ?? []) as Array<{ recruiter_id: string | null }>) {
    if (c.recruiter_id) counts.set(c.recruiter_id, (counts.get(c.recruiter_id) ?? 0) + 1);
  }
  return rows.map((r) => ({ ...r, consultant_count: r.id ? (counts.get(r.id) ?? 0) : 0 }));
}

const SELECT_WITH_JOINS =
  '*, user:users!user_id(id, email, full_name, group_id), ' +
  'manager:users!manager_id(id, email, full_name, group_id), ' +
  'managers:recruiter_managers(is_primary, assigned_at, manager:users!manager_id(id, email, full_name, role, group_id))';

// .strict() rejects unknown keys at parse time — mass-assignment guard, per
// .claude/rules/security.md. `manager_id` is INTENTIONALLY OMITTED here:
// recruiter→manager edges are an authority relation (they feed
// v_user_relationships, the source of truth for canMessageUser /
// canViewConversation / canViewProfile) and must only be mutated via the
// gated addManager / setPrimaryManager / removeManager / moveGroup paths
// — those validate role + group + outranking and invalidate the perm
// cache under guard. A self-onboard form letting RECRUITER pick their own
// manager would forge the permission graph in one request.
const onboardingSchema = z
  .object({
    // Personal details — write through to public.users on the same row.
    full_name: z.string().min(1).optional(),
    phone: z.string().optional(),
    // Recruiter-row fields.
    team: z.string().optional(),
    target_submissions_per_week: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // A MANAGER only sees recruiters in their own group; HR_MANAGER + admin-tier
  // see all groups.
  const groupUserIds = await managerGroupUserIds(req.user);
  if (groupUserIds !== null && groupUserIds.length === 0) {
    res.json([]);
    return;
  }

  let q = db.from('recruiters').select(SELECT_WITH_JOINS).order('created_at', { ascending: false });
  if (groupUserIds !== null) q = q.in('user_id', groupUserIds);
  const { data, error } = await q;

  // The new `recruiter_managers` table may not exist yet — degrade gracefully
  // by retrying with the simpler embed.
  if (error && /recruiter_managers/i.test(error.message)) {
    let fq = db
      .from('recruiters')
      .select(
        '*, user:users!user_id(id, email, full_name, group_id), manager:users!manager_id(id, email, full_name, group_id)',
      )
      .order('created_at', { ascending: false });
    if (groupUserIds !== null) fq = fq.in('user_id', groupUserIds);
    const fallback = await fq;
    if (fallback.error) throw httpError(500, fallback.error.message);
    res.json(await attachConsultantCounts((fallback.data ?? []) as Array<{ id?: string }>));
    return;
  }
  if (error) throw httpError(500, 'Database error');
  res.json(await attachConsultantCounts((data ?? []) as Array<{ id?: string }>));
};

export const get: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  let row: any = null;
  const { data, error } = await db
    .from('recruiters')
    .select(SELECT_WITH_JOINS + ', phone, avatar_url')
    .eq('id', req.params.id)
    .single();
  if (error && /recruiter_managers/i.test(error.message)) {
    const fb = await db
      .from('recruiters')
      .select(
        '*, user:users!user_id(id, email, full_name, phone, avatar_url, group_id), manager:users!manager_id(id, email, full_name, group_id)',
      )
      .eq('id', req.params.id)
      .single();
    if (fb.error) throw httpError(404, fb.error.message);
    row = fb.data;
  } else if (error) {
    throw httpError(404, error.message);
  } else {
    row = data;
  }
  // Group leads only see recruiters in their own group; admin tier unscoped.
  await assertRecruiterInScope(req.user, row?.user_id ?? row?.user?.id ?? null);
  const [withCount] = await attachConsultantCounts([row as { id?: string }]);
  res.json(withCount);
};

export const onboard: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { full_name, phone, ...recruiterRow } = parsed.data;

  const userPatch: Record<string, unknown> = {};
  if (full_name !== undefined) userPatch.full_name = full_name;
  if (phone !== undefined) userPatch.phone = phone;
  if (Object.keys(userPatch).length > 0) {
    const { error: uErr } = await db.from('users').update(userPatch).eq('id', req.user.id);
    if (uErr) throw httpError(500, uErr.message);
  }

  const { data, error } = await db
    .from('recruiters')
    .upsert({ user_id: req.user.id, ...recruiterRow }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

// ---------------------------------------------------------------------------
// Manager assignments — many-to-many via recruiter_managers (with fallback)
// ---------------------------------------------------------------------------

/**
 * Detect the "schema cache" / "relation does not exist" error from PostgREST
 * that fires when the recruiter_managers migration hasn't been applied yet.
 */
function junctionMissing(message: string | undefined): boolean {
  if (!message) return false;
  return (
    /recruiter_managers/i.test(message) &&
    /schema cache|relation .* does not exist|column/i.test(message)
  );
}

export const addManager: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    manager_id: z.string().uuid(),
    is_primary: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const recruiterId = req.params.id;

  const { data: rec } = await db
    .from('recruiters')
    .select('id, user_id')
    .eq('id', recruiterId)
    .maybeSingle();
  if (!rec) throw httpError(404, 'Recruiter not found');
  const recruiterUserId = (rec as { user_id: string | null }).user_id;
  // A group lead may only re-org recruiters in their own group.
  await assertRecruiterInScope(req.user, recruiterUserId);

  let recruiterGroup: string | null = null;
  if (recruiterUserId) {
    const { data: recruiterUser } = await db
      .from('users')
      .select('group_id')
      .eq('id', recruiterUserId)
      .maybeSingle();
    recruiterGroup = (recruiterUser as { group_id?: string | null } | null)?.group_id ?? null;
  }

  const { data: target } = await db
    .from('users')
    .select('id, role, group_id')
    .eq('id', parsed.data.manager_id)
    .maybeSingle();
  if (!target) throw httpError(404, 'Manager user not found');
  const t = target as { id: string; role: string; group_id: string | null };
  if (!(MANAGER_TIER as readonly string[]).includes(t.role))
    throw httpError(400, 'Assigned user must be manager-tier');
  // Supervisors are group-local, with one deliberate leadership exception:
  // admin-tier callers may assign themselves as the supervisor.
  if (isAdminTier(req.user.role) && t.id !== req.user.id && t.group_id !== recruiterGroup) {
    throw httpError(403, 'The selected supervisor must be in the recruiter group.');
  }
  if (isGroupLead(req.user.role) && !(await leadCanAccessUser(req.user, t.id))) {
    throw httpError(403, 'The selected manager must be in your group.');
  }

  // Probe whether the junction table exists.
  const { data: existing, error: existErr } = await db
    .from('recruiter_managers')
    .select('manager_id, is_primary')
    .eq('recruiter_id', recruiterId);

  if (junctionMissing(existErr?.message)) {
    // Pre-migration fallback: single-manager only — overwrite recruiters.manager_id.
    const { data, error } = await db
      .from('recruiters')
      .update({ manager_id: parsed.data.manager_id })
      .eq('id', recruiterId)
      .select()
      .single();
    if (error) throw httpError(500, 'Database error');
    res.status(201).json({
      ...data,
      _degraded:
        'recruiter_managers table not migrated — one supervisor at a time. Run database/recruiter-managers.sql for multi-manager support.',
    });
    return;
  }
  if (existErr) throw httpError(500, existErr.message);

  const wantPrimary = parsed.data.is_primary === true || (existing ?? []).length === 0;
  if (wantPrimary) {
    await db
      .from('recruiter_managers')
      .update({ is_primary: false })
      .eq('recruiter_id', recruiterId);
  }

  const { data, error } = await db
    .from('recruiter_managers')
    .upsert(
      {
        recruiter_id: recruiterId,
        manager_id: parsed.data.manager_id,
        is_primary: wantPrimary,
        assigned_by: req.user.id,
      },
      { onConflict: 'recruiter_id,manager_id' },
    )
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');

  if (wantPrimary) {
    await db
      .from('recruiters')
      .update({ manager_id: parsed.data.manager_id })
      .eq('id', recruiterId);
  }
  res.status(201).json(data);
};

export const removeManager: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const recruiterId = req.params.id;
  const managerId = req.params.managerId;

  const { data: recRow } = await db
    .from('recruiters')
    .select('id, user_id')
    .eq('id', recruiterId)
    .maybeSingle();
  if (!recRow) throw httpError(404, 'Recruiter not found');
  await assertRecruiterInScope(req.user, (recRow as { user_id: string | null }).user_id);
  // A group lead may only detach a manager who is in their own group.
  if (isGroupLead(req.user.role) && !(await leadCanAccessUser(req.user, managerId))) {
    throw httpError(403, 'The selected manager must be in your group.');
  }

  const { data: removed, error: lookupErr } = await db
    .from('recruiter_managers')
    .select('is_primary')
    .eq('recruiter_id', recruiterId)
    .eq('manager_id', managerId)
    .maybeSingle();

  if (junctionMissing(lookupErr?.message)) {
    // Pre-migration fallback — clear recruiters.manager_id only if it matches.
    await db
      .from('recruiters')
      .update({ manager_id: null })
      .eq('id', recruiterId)
      .eq('manager_id', managerId);
    res.json({ ok: true, _degraded: true });
    return;
  }

  const { error } = await db
    .from('recruiter_managers')
    .delete()
    .eq('recruiter_id', recruiterId)
    .eq('manager_id', managerId);
  if (error) throw httpError(500, 'Database error');

  if (removed?.is_primary) {
    const { data: next } = await db
      .from('recruiter_managers')
      .select('manager_id')
      .eq('recruiter_id', recruiterId)
      .order('assigned_at')
      .limit(1)
      .maybeSingle();
    if (next?.manager_id) {
      await db
        .from('recruiter_managers')
        .update({ is_primary: true })
        .eq('recruiter_id', recruiterId)
        .eq('manager_id', next.manager_id);
      await db.from('recruiters').update({ manager_id: next.manager_id }).eq('id', recruiterId);
    } else {
      await db.from('recruiters').update({ manager_id: null }).eq('id', recruiterId);
    }
  }
  res.json({ ok: true });
};

export const setPrimaryManager: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const recruiterId = req.params.id;
  const managerId = req.params.managerId;

  const { data: recRow } = await db
    .from('recruiters')
    .select('id, user_id')
    .eq('id', recruiterId)
    .maybeSingle();
  if (!recRow) throw httpError(404, 'Recruiter not found');
  await assertRecruiterInScope(req.user, (recRow as { user_id: string | null }).user_id);
  // A group lead may only mark a manager primary if that manager is in-group.
  if (isGroupLead(req.user.role) && !(await leadCanAccessUser(req.user, managerId))) {
    throw httpError(403, 'The selected manager must be in your group.');
  }

  const { data: existing, error: lookupErr } = await db
    .from('recruiter_managers')
    .select('manager_id')
    .eq('recruiter_id', recruiterId)
    .eq('manager_id', managerId)
    .maybeSingle();

  if (junctionMissing(lookupErr?.message)) {
    // Pre-migration fallback — set the single column directly.
    const { error } = await db
      .from('recruiters')
      .update({ manager_id: managerId })
      .eq('id', recruiterId);
    if (error) throw httpError(500, 'Database error');
    res.json({ ok: true, _degraded: true });
    return;
  }
  if (!existing) throw httpError(404, 'Assignment not found');

  await db.from('recruiter_managers').update({ is_primary: false }).eq('recruiter_id', recruiterId);
  await db
    .from('recruiter_managers')
    .update({ is_primary: true })
    .eq('recruiter_id', recruiterId)
    .eq('manager_id', managerId);
  await db.from('recruiters').update({ manager_id: managerId }).eq('id', recruiterId);
  res.json({ ok: true });
};

/**
 * POST /recruiters/:id/move-group
 * Move a recruiter's user.group_id.
 *
 * Auth rules:
 *  - Admin tier: move to any group.
 *  - Group lead: only recruiters currently in their group, only to their own group.
 *
 * Safety: if the recruiter has assigned consultants and the group changes, the
 * caller must pass confirm_unassign_consultants=true. The move then clears
 * those consultant assignments before moving the recruiter.
 */
export const moveGroup: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z
    .object({
      group_id: z.string().uuid().nullable(),
      manager_id: z.string().uuid().nullable().optional(),
      confirm_unassign_consultants: z.boolean().optional(),
    })
    .strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const recruiterId = req.params.id;
  const { data: rec } = await db
    .from('recruiters')
    .select('id, user_id')
    .eq('id', recruiterId)
    .maybeSingle();
  if (!rec) throw httpError(404, 'Recruiter not found');
  const row = rec as { id: string; user_id: string | null };
  if (!row.user_id) throw httpError(400, 'Recruiter has no linked user account.');

  const { data: currentUser } = await db
    .from('users')
    .select('group_id')
    .eq('id', row.user_id)
    .maybeSingle();
  const currentGroup = (currentUser as { group_id: string | null } | null)?.group_id ?? null;

  if (isAdminTier(req.user.role)) {
    // unscoped
  } else if (isGroupLead(req.user.role)) {
    // Group lead can only move a recruiter currently in their group, and only
    // to their own group.
    if (!row.user_id || !(await leadCanAccessUser(req.user, row.user_id))) {
      throw httpError(403, 'Recruiter is not in your group.');
    }
    const target = parsed.data.group_id;
    if (target && target !== (req.user.group_id ?? null)) {
      throw httpError(403, 'You can only assign recruiters to your own group.');
    }
  } else {
    throw httpError(403, 'Forbidden');
  }

  const { data: assignedCons } = await db
    .from('consultants')
    .select('id, user_id')
    .eq('recruiter_id', recruiterId);
  const assignedRows = (assignedCons ?? []) as Array<{ id: string; user_id: string | null }>;
  const changingGroup = parsed.data.group_id !== currentGroup;
  const targetGroup = parsed.data.group_id;
  const targetManagerId = parsed.data.manager_id ?? null;

  if (changingGroup && targetGroup && !targetManagerId) {
    throw httpError(400, 'Pick a manager in the selected group before moving this recruiter.');
  }

  if (targetManagerId) {
    const { data: manager } = await db
      .from('users')
      .select('id, role, group_id')
      .eq('id', targetManagerId)
      .maybeSingle();
    const managerRow = manager as { id: string; role: string; group_id: string | null } | null;
    if (!managerRow || !RECRUITER_MANAGER_ROLES.includes(managerRow.role as any)) {
      throw httpError(400, 'Selected user is not a manager.');
    }
    if (managerRow.group_id !== targetGroup) {
      throw httpError(400, 'Selected manager is not in the target group.');
    }
    if (isGroupLead(req.user.role) && !(await leadCanAccessUser(req.user, targetManagerId))) {
      throw httpError(403, 'Selected manager is not in your group.');
    }
  }

  if (changingGroup && assignedRows.length > 0 && !parsed.data.confirm_unassign_consultants) {
    throw httpError(
      409,
      `${assignedRows.length} consultant${assignedRows.length === 1 ? ' is' : 's are'} assigned to this recruiter. Confirm to unassign them before moving.`,
    );
  }

  if (changingGroup && assignedRows.length > 0) {
    const { error: unassignErr } = await db
      .from('consultants')
      .update({ recruiter_id: null })
      .eq('recruiter_id', recruiterId);
    if (unassignErr) throw httpError(500, 'Database error');
    for (const c of assignedRows) {
      if (c.user_id) invalidatePermissionCache(c.user_id);
    }
  }

  const { error } = await db.from('users').update({ group_id: targetGroup }).eq('id', row.user_id);
  if (error) throw httpError(500, 'Database error');

  if (targetManagerId) {
    const { error: legacyErr } = await db
      .from('recruiters')
      .update({ manager_id: targetManagerId })
      .eq('id', recruiterId);
    if (legacyErr) throw httpError(500, 'Database error');

    const { error: clearErr } = await db
      .from('recruiter_managers')
      .delete()
      .eq('recruiter_id', recruiterId);
    if (clearErr && !/recruiter_managers/i.test(clearErr.message ?? '')) {
      throw httpError(500, 'Database error');
    }

    if (!clearErr) {
      const { error: linkErr } = await db.from('recruiter_managers').insert({
        recruiter_id: recruiterId,
        manager_id: targetManagerId,
        is_primary: true,
        assigned_by: req.user.id,
      });
      if (linkErr) throw httpError(500, 'Database error');
    }
    invalidatePermissionCache(targetManagerId);
  }

  if (row.user_id) invalidatePermissionCache(row.user_id);

  res.json({
    ok: true,
    group_id: targetGroup,
    manager_id: targetManagerId,
    unassigned_consultants: assignedRows.length,
  });
};
