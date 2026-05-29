import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import {
  httpError,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TaskStatus,
  TaskPriority,
  MANAGER_TIER,
} from '../types';
import {
  managerGroupUserIds,
  isAdminTier,
  isGroupLead,
  leadCanAccessConsultant,
  leadCanAccessUser,
} from '../services/groupScope';
import type { Role } from '../types';
import { assertCanAccessTask as assertCanAccessTaskShared } from '../services/taskAccess';

const SELECT_WITH_JOINS = `
  *,
  assignee:users!assignee_id ( id, email, full_name, role, group_id ),
  creator:users!created_by ( id, email, full_name, role, group_id ),
  consultant:consultants!related_consultant_id ( id, user:users!user_id ( full_name, email, group_id ) ),
  recruiter:recruiters!related_recruiter_id ( id, user:users!user_id ( full_name, email, group_id ) )
`;

function isManagerLike(role?: string): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

/** A group lead may only act on a task whose assignee is in their group.
 *  Returns true if the caller (a group lead) is in-scope for `assigneeId`. */
async function leadInScopeForAssignee(
  caller: { role: Role; group_id?: string | null },
  assigneeId: string | null,
): Promise<boolean> {
  const ids = await managerGroupUserIds(caller);
  return !!(ids && assigneeId && ids.includes(assigneeId));
}

/** For a group-lead caller, every target a task points at (assignee + related
 *  consultant/recruiter) must be inside their group. Admin tier is unscoped;
 *  non-leads are gated by the route. Throws 403 on an out-of-group target. */
async function assertTaskTargetsInScope(
  caller: { id: string; role: Role; group_id?: string | null },
  t: {
    assignee_id?: string | null;
    related_consultant_id?: string | null;
    related_recruiter_id?: string | null;
  },
): Promise<void> {
  if (!isGroupLead(caller.role)) return; // admin unscoped; others gated elsewhere
  if (t.assignee_id && !(await leadInScopeForAssignee(caller, t.assignee_id))) {
    throw httpError(403, 'You can only assign tasks to users in your group.');
  }
  if (
    t.related_consultant_id &&
    !(await leadCanAccessConsultant(caller, t.related_consultant_id))
  ) {
    throw httpError(403, 'The related consultant must be in your group.');
  }
  if (t.related_recruiter_id) {
    const { data } = await db
      .from('recruiters')
      .select('user_id')
      .eq('id', t.related_recruiter_id)
      .maybeSingle();
    const uid = (data as { user_id?: string | null } | null)?.user_id ?? null;
    if (!uid || !(await leadCanAccessUser(caller, uid))) {
      throw httpError(403, 'The related recruiter must be in your group.');
    }
  }
}

// The db shim only resolves embedded FK selects (assignee:users!…) on a plain
// SELECT — not inside a write's RETURNING (it would inline the embed syntax and
// Postgres errors with "syntax error at or near :"). So writes return `*` and
// we re-fetch the row with joins here for the response.
async function taskWithJoins(id: string) {
  const { data, error } = await db.from('tasks').select(SELECT_WITH_JOINS).eq('id', id).single();
  if (error) throw httpError(500, 'Database error');
  return data;
}

function applyFilters(qb: any, q: Record<string, any>) {
  if (q.status) qb = qb.eq('status', q.status);
  if (q.priority) qb = qb.eq('priority', q.priority);
  if (q.assignee_id) qb = qb.eq('assignee_id', q.assignee_id);
  if (q.consultant_id) qb = qb.eq('related_consultant_id', q.consultant_id);
  if (q.recruiter_id) qb = qb.eq('related_recruiter_id', q.recruiter_id);
  if (q.due_before) qb = qb.lte('due_at', q.due_before);
  if (q.due_after) qb = qb.gte('due_at', q.due_after);
  if (q.overdue === 'true') {
    qb = qb.lt('due_at', new Date().toISOString()).not('status', 'in', '("COMPLETED","CANCELLED")');
  }
  if (q.q) qb = qb.ilike('title', `%${q.q}%`);
  return qb;
}

/** List tasks. SUPER_ADMIN/MANAGER see everything; others see only their own assignments. */
export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  let qb = db.from('tasks').select(SELECT_WITH_JOINS);
  if (!isManagerLike(req.user.role)) {
    qb = qb.eq('assignee_id', req.user.id);
  } else {
    // Group leads (HR_MANAGER + MANAGER) only see tasks assigned to people in
    // their own group; admin-tier sees all (managerGroupUserIds returns null).
    const groupUserIds = await managerGroupUserIds(req.user);
    if (groupUserIds !== null) {
      if (groupUserIds.length === 0) {
        res.json([]);
        return;
      }
      qb = qb.in('assignee_id', groupUserIds);
    }
  }
  qb = applyFilters(qb, req.query as Record<string, any>);
  const { data, error } = await qb
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

/** Single task detail. */
export const get: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('tasks')
    .select(SELECT_WITH_JOINS)
    .eq('id', req.params.id)
    .single();
  if (error || !data) throw httpError(404, 'Task not found');
  // Admin tier: any task. Group leads: only tasks for their group. Everyone
  // else: only their own assignments.
  if (isAdminTier(req.user.role)) {
    // unscoped
  } else if (isGroupLead(req.user.role)) {
    if (
      !(await leadInScopeForAssignee(req.user, data.assignee_id)) &&
      data.assignee_id !== req.user.id
    )
      // 404 (not 403) on out-of-scope so the endpoint isn't an existence
      // oracle — drifted from tasks.remove which already uses 404.
      throw httpError(404, 'Task not found');
  } else if (data.assignee_id !== req.user.id) {
    throw httpError(404, 'Task not found');
  }
  res.json(data);
};

/** Create a task. Manager / Super admin only. */
export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const b = req.body ?? {};
  if (!b.title) throw httpError(400, 'title is required');
  if (b.status && !TASK_STATUSES.includes(b.status as TaskStatus))
    throw httpError(400, 'Invalid status');
  if (b.priority && !TASK_PRIORITIES.includes(b.priority as TaskPriority))
    throw httpError(400, 'Invalid priority');

  const payload: Record<string, unknown> = {
    title: b.title,
    description: b.description ?? null,
    status: b.status ?? 'BACKLOG',
    priority: b.priority ?? 'MEDIUM',
    assignee_id: b.assignee_id ?? null,
    related_consultant_id: b.related_consultant_id ?? null,
    related_recruiter_id: b.related_recruiter_id ?? null,
    due_at: b.due_at ?? null,
    created_by: req.user.id,
  };
  // Group leads can only point a task at users/consultants/recruiters inside
  // their own group; admin tier is unscoped.
  await assertTaskTargetsInScope(req.user, {
    assignee_id: payload.assignee_id as string | null,
    related_consultant_id: payload.related_consultant_id as string | null,
    related_recruiter_id: payload.related_recruiter_id as string | null,
  });

  // Only include `tags` when actually provided and the column exists. Tries
  // first with tags; on the schema-cache error, retries without — keeps task
  // creation working even before database/tasks-tags.sql has been applied.
  if (Array.isArray(b.tags) && b.tags.length > 0) payload.tags = b.tags;

  let { data, error } = await db.from('tasks').insert(payload).select('*').single();
  if (error && /tags/i.test(error.message) && /schema cache|column/i.test(error.message)) {
    delete payload.tags;
    ({ data, error } = await db.from('tasks').insert(payload).select('*').single());
  }
  if (error) throw httpError(500, 'Database error');
  res.status(201).json(await taskWithJoins((data as { id: string }).id));
};

/** Update task. Managers can update any field; assignee can only update status. */
export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  const { data: existing, error: e0 } = await db
    .from('tasks')
    .select('assignee_id')
    .eq('id', id)
    .single();
  if (e0 || !existing) throw httpError(404, 'Task not found');

  const isMgr = isManagerLike(req.user.role);
  const isAssignee = existing.assignee_id === req.user.id;
  // Out-of-scope ownership returns 404 (not 403) so the endpoint can't be
  // used as an existence oracle by walking UUIDs.
  if (!isMgr && !isAssignee) throw httpError(404, 'Task not found');
  // Group leads may only edit tasks within their group (unless it's their own).
  if (isGroupLead(req.user.role) && !isAssignee) {
    if (!(await leadInScopeForAssignee(req.user, existing.assignee_id)))
      throw httpError(404, 'Task not found');
  }

  const allowed: Record<string, unknown> = {};
  const b = req.body ?? {};
  if (isMgr) {
    // Managers can edit any of the editable fields.
    for (const k of [
      'title',
      'description',
      'status',
      'priority',
      'assignee_id',
      'related_consultant_id',
      'related_recruiter_id',
      'due_at',
      'order_index',
      'tags',
    ]) {
      if (k in b) allowed[k] = b[k];
    }
  } else {
    // Assignees may only change status (and we'll set completed_at when moving to COMPLETED).
    if ('status' in b) allowed.status = b.status;
  }
  if (allowed.status === 'COMPLETED') allowed.completed_at = new Date().toISOString();
  if (allowed.status && allowed.status !== 'COMPLETED') allowed.completed_at = null;

  if (allowed.status && !TASK_STATUSES.includes(allowed.status as TaskStatus)) {
    throw httpError(400, 'Invalid status');
  }

  // A group lead reassigning the task (or its related entities) may only point
  // it at members of their own group.
  await assertTaskTargetsInScope(req.user, {
    assignee_id: (allowed.assignee_id as string | null | undefined) ?? undefined,
    related_consultant_id:
      (allowed.related_consultant_id as string | null | undefined) ?? undefined,
    related_recruiter_id: (allowed.related_recruiter_id as string | null | undefined) ?? undefined,
  });

  let { error } = await db.from('tasks').update(allowed).eq('id', id).select('*').single();
  // Retry without `tags` if the column hasn't been migrated in yet, so other
  // edits still apply. Surface a 422 explaining how to enable tags.
  if (
    error &&
    /tags/i.test(error.message) &&
    /schema cache|column/i.test(error.message) &&
    'tags' in allowed
  ) {
    delete allowed.tags;
    if (Object.keys(allowed).length === 0) {
      throw httpError(
        422,
        'Tags column missing — run database/tasks-tags.sql against the database to enable task tags.',
      );
    }
    ({ error } = await db.from('tasks').update(allowed).eq('id', id).select('*').single());
  }
  if (error) throw httpError(500, 'Database error');
  res.json(await taskWithJoins(id));
};

/** Status-only update (board drag-and-drop). Assignee or manager can call. */
export const updateStatus: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const status = req.body?.status as TaskStatus | undefined;
  if (!status || !TASK_STATUSES.includes(status)) throw httpError(400, 'Invalid status');

  const { data: existing, error: e0 } = await db
    .from('tasks')
    .select('assignee_id')
    .eq('id', req.params.id)
    .single();
  if (e0 || !existing) throw httpError(404, 'Task not found');
  if (isAdminTier(req.user.role)) {
    // unscoped
  } else if (isGroupLead(req.user.role)) {
    if (
      !(await leadInScopeForAssignee(req.user, existing.assignee_id)) &&
      existing.assignee_id !== req.user.id
    )
      // 404 (not 403) — same oracle-hygiene fix as get / update above.
      throw httpError(404, 'Task not found');
  } else if (existing.assignee_id !== req.user.id) {
    throw httpError(404, 'Task not found');
  }

  const patch: Record<string, unknown> = { status };
  patch.completed_at = status === 'COMPLETED' ? new Date().toISOString() : null;
  const { error } = await db
    .from('tasks')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(await taskWithJoins(req.params.id));
};

/** Delete. Manager / Super admin only — AND for group leads, only tasks
 *  within their own group's scope (assertCanAccessTask). Previously this only
 *  checked isManagerLike, so a lead could delete out-of-group tasks. */
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerLike(req.user.role)) throw httpError(403, 'Forbidden');
  // Throws 404 (not 403) on missing or out-of-scope — existence oracle safe.
  await assertCanAccessTask(req.user, req.params.id);
  const { error } = await db.from('tasks').delete().eq('id', req.params.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};

/** Tasks assigned to the calling user. */
export const assignedToMe: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  let qb = db.from('tasks').select(SELECT_WITH_JOINS).eq('assignee_id', req.user.id);
  qb = applyFilters(qb, req.query as Record<string, any>);
  const { data, error } = await qb.order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

/**
 * Team tasks for a manager: tasks where the assignee is one of their recruiters,
 * or any consultant assigned to one of those recruiters. SUPER_ADMIN sees all.
 */
export const teamTasks: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerLike(req.user.role)) throw httpError(403, 'Forbidden');

  let assigneeIds: string[] | null = null;
  if (isGroupLead(req.user.role)) {
    // Direct reports: recruiters managed by this user.
    const { data: recs, error: re } = await db
      .from('recruiters')
      .select('user_id, id')
      .eq('manager_id', req.user.id);
    if (re) throw httpError(500, re.message);
    const recruiterUserIds = (recs ?? []).map((r: any) => r.user_id);
    const recruiterIds = (recs ?? []).map((r: any) => r.id);

    // Consultants assigned to those recruiters.
    let consultantUserIds: string[] = [];
    if (recruiterIds.length > 0) {
      const { data: cons, error: ce } = await db
        .from('consultants')
        .select('user_id')
        .in('recruiter_id', recruiterIds);
      if (ce) throw httpError(500, ce.message);
      consultantUserIds = (cons ?? []).map((c: any) => c.user_id);
    }
    assigneeIds = [...new Set([req.user.id, ...recruiterUserIds, ...consultantUserIds])];
  }

  let qb = db.from('tasks').select(SELECT_WITH_JOINS);
  if (assigneeIds) qb = qb.in('assignee_id', assigneeIds);
  qb = applyFilters(qb, req.query as Record<string, any>);
  const { data, error } = await qb.order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

/**
 * Users the caller may assign tasks to. Manager-tier only (matches the create/
 * assign surface). Admin-tier sees every active user; a group lead sees the
 * active users in their own group. Always includes the caller themselves so a
 * lead with an empty group can still self-assign. Returns a lean shape for the
 * assignee picker.
 */
export const assignees: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerLike(req.user.role)) throw httpError(403, 'Forbidden');

  const COLS = 'id, full_name, email, role';
  let rows: Array<{ id: string; full_name: string | null; email: string; role: string }> = [];

  if (isAdminTier(req.user.role)) {
    const { data, error } = await db.from('users').select(COLS).neq('is_active', false);
    if (error) throw httpError(500, 'Database error');
    rows = (data ?? []) as typeof rows;
  } else {
    // Group lead → their group's active users (managerGroupUserIds is fail-closed).
    const ids = await managerGroupUserIds(req.user);
    if (ids && ids.length > 0) {
      const { data, error } = await db
        .from('users')
        .select(COLS)
        .in('id', ids)
        .neq('is_active', false);
      if (error) throw httpError(500, 'Database error');
      rows = (data ?? []) as typeof rows;
    }
  }

  // Guarantee the caller is always assignable to themselves.
  if (!rows.some((u) => u.id === req.user!.id)) {
    rows.push({
      id: req.user.id,
      full_name: null,
      email: req.user.email,
      role: req.user.role,
    });
  }
  res.json(rows);
};

/** Manager dashboard metrics: counts by status, by priority, overdue, completed-this-week. */
export const metrics: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerLike(req.user.role)) throw httpError(403, 'Forbidden');

  interface MetricsRow {
    status: TaskStatus;
    priority: TaskPriority;
    due_at: string | null;
    completed_at: string | null;
  }
  // Group leads see metrics only for their group's tasks; admin tier sees all.
  let rows: MetricsRow[] = [];
  if (isGroupLead(req.user.role)) {
    const groupUserIds = await managerGroupUserIds(req.user);
    if (groupUserIds === null) {
      const { data, error } = await db
        .from('tasks')
        .select('status, priority, due_at, completed_at');
      if (error) throw httpError(500, 'Database error');
      rows = (data ?? []) as MetricsRow[];
    } else if (groupUserIds.length > 0) {
      const { data, error } = await db
        .from('tasks')
        .select('status, priority, due_at, completed_at')
        .in('assignee_id', groupUserIds);
      if (error) throw httpError(500, 'Database error');
      rows = (data ?? []) as MetricsRow[];
    }
    // empty group → rows stays [] (all-zero metrics)
  } else {
    const { data, error } = await db.from('tasks').select('status, priority, due_at, completed_at');
    if (error) throw httpError(500, 'Database error');
    rows = (data ?? []) as MetricsRow[];
  }

  // Seed with every enum value so the UI doesn't have to defend against missing
  // keys; narrowed to the canonical enum so a stray status from the DB doesn't
  // silently create a junk key.
  const by_status = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<
    TaskStatus,
    number
  >;
  const by_priority = Object.fromEntries(TASK_PRIORITIES.map((p) => [p, 0])) as Record<
    TaskPriority,
    number
  >;
  let overdue = 0;
  let due_today = 0;
  let due_this_week = 0;
  let open = 0;
  let critical_open = 0;
  let completed_last_7_days = 0;
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const endOfTodayMs = endOfToday.getTime();
  const inSevenDays = now + 7 * 24 * 3600 * 1000;

  for (const t of rows) {
    // Defensive: only count rows whose status/priority match the canonical
    // enum. A migration that adds new values without a backend bump would
    // otherwise create rogue map keys.
    if (TASK_STATUSES.includes(t.status)) by_status[t.status] += 1;
    if (TASK_PRIORITIES.includes(t.priority)) by_priority[t.priority] += 1;
    const isOpen = t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
    if (isOpen) {
      open++;
      if (t.priority === 'CRITICAL') critical_open++;
      const due = t.due_at ? Date.parse(t.due_at) : null;
      if (due) {
        if (due < now) overdue++;
        else if (due <= endOfTodayMs) due_today++;
        if (due >= now && due <= inSevenDays) due_this_week++;
      }
    }
    if (t.completed_at && Date.parse(t.completed_at) >= sevenDaysAgo) completed_last_7_days++;
  }
  res.json({
    total: rows.length,
    open,
    critical_open,
    by_status,
    by_priority,
    overdue,
    due_today,
    due_this_week,
    completed_last_7_days,
  });
};

// ---------------------------------------------------------------------------
// Subtasks + activity + comments (task-scoped resources).
//
// Every handler below first loads the parent task and verifies the caller may
// see it via assertCanAccessTask(). This mirrors the visibility rule in `get`:
// manager-tier sees everything; a non-manager may access a task only if they
// are the assignee or the creator. Ownership failure throws 404 (not 403) so
// the endpoint can't be used as an existence oracle, per .claude/rules/security.
// ---------------------------------------------------------------------------

interface AccessibleTask {
  id: string;
  assignee_id: string | null;
  created_by: string | null;
}

/**
 * Load the task and assert the caller may access it. Returns the task on
 * success; throws httpError(404, 'Task not found') if the row is missing OR the
 * caller is a non-manager who is neither the assignee nor the creator.
 */
/**
 * Thin wrapper around the centralised guard in services/taskAccess. The local
 * version used to short-circuit on `isManagerLike` and let every MANAGER_TIER
 * caller through, which let a group lead read/update/delete tasks belonging
 * to other groups. The service-level guard scopes group leads to their own
 * group + self-touched tasks.
 */
async function assertCanAccessTask(
  user: { id: string; role: Role; group_id?: string | null },
  taskId: string,
): Promise<AccessibleTask> {
  return assertCanAccessTaskShared(user, taskId);
}

const ACTIVITY_SELECT = `*, actor:users!actor_id ( id, full_name, email )`;

// True when the error indicates the table/column hasn't been migrated in yet.
// New task_activity / task_subtasks GETs return [] in that case, and activity
// writes are swallowed, so the backend can deploy ahead of the migration.
function isMissingRelation(message?: string): boolean {
  return (
    !!message && /schema cache|does not exist|relation .* does not exist|column/i.test(message)
  );
}

// Append a task_activity row. Best-effort: a missing table (or any error) is
// logged and swallowed so it never 500s the parent action.
async function recordActivity(
  req: Parameters<RequestHandler>[0],
  taskId: string,
  kind: string,
  payload: Record<string, unknown> | null,
): Promise<void> {
  try {
    const { error } = await db
      .from('task_activity')
      .insert({ task_id: taskId, actor_id: req.user?.id ?? null, kind, payload_json: payload });
    if (error) req.log.warn({ err: error.message, taskId, kind }, 'task_activity insert failed');
  } catch (err) {
    req.log.warn({ err, taskId, kind }, 'task_activity insert threw');
  }
}

// --- Subtasks ---------------------------------------------------------------

const subtaskCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(500),
    order_idx: z.number().int().optional(),
  })
  .strict();

const subtaskUpdateSchema = z
  .object({
    done: z.boolean().optional(),
    label: z.string().trim().min(1).max(500).optional(),
    order_idx: z.number().int().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const listSubtasks: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertCanAccessTask(req.user, req.params.id);
  const { data, error } = await db
    .from('task_subtasks')
    .select('*')
    .eq('task_id', req.params.id)
    .order('order_idx', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingRelation(error.message)) return res.json([]);
    throw httpError(500, 'Database error');
  }
  res.json(data ?? []);
};

export const createSubtask: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertCanAccessTask(req.user, req.params.id);
  const parsed = subtaskCreateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  const { data, error } = await db
    .from('task_subtasks')
    .insert({
      task_id: req.params.id,
      label: parsed.data.label,
      order_idx: parsed.data.order_idx ?? 0,
    })
    .select('*')
    .single();
  if (error) throw httpError(500, 'Database error');
  await recordActivity(req, req.params.id, 'subtask_added', { label: parsed.data.label });
  res.status(201).json(data);
};

export const updateSubtask: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: existing, error: e0 } = await db
    .from('task_subtasks')
    .select('id, task_id, done')
    .eq('id', req.params.id)
    .maybeSingle();
  if (e0) throw httpError(500, e0.message);
  if (!existing) throw httpError(404, 'Subtask not found');
  await assertCanAccessTask(req.user, existing.task_id);

  const parsed = subtaskUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  const patch: Record<string, unknown> = {};
  if (parsed.data.done !== undefined) patch.done = parsed.data.done;
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.order_idx !== undefined) patch.order_idx = parsed.data.order_idx;

  const { data, error } = await db
    .from('task_subtasks')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error) throw httpError(500, 'Database error');

  // Log a completion event only when done flips from falsey to true.
  if (parsed.data.done === true && !existing.done) {
    await recordActivity(req, existing.task_id, 'subtask_completed', {
      label: (data as { label?: string })?.label,
    });
  }
  res.json(data);
};

export const removeSubtask: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: existing, error: e0 } = await db
    .from('task_subtasks')
    .select('id, task_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (e0) throw httpError(500, e0.message);
  if (!existing) throw httpError(404, 'Subtask not found');
  await assertCanAccessTask(req.user, existing.task_id);

  const { error } = await db.from('task_subtasks').delete().eq('id', req.params.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};

// --- Activity feed + comments -----------------------------------------------

export const listActivity: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertCanAccessTask(req.user, req.params.id);

  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;

  const { data, error } = await db
    .from('task_activity')
    .select(ACTIVITY_SELECT)
    .eq('task_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingRelation(error.message)) return res.json([]);
    throw httpError(500, 'Database error');
  }
  res.json(data ?? []);
};

const commentCreateSchema = z.object({ body: z.string().trim().min(1).max(5000) }).strict();

export const createComment: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertCanAccessTask(req.user, req.params.id);
  const parsed = commentCreateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  const { data, error } = await db
    .from('task_activity')
    .insert({
      task_id: req.params.id,
      actor_id: req.user.id,
      kind: 'comment',
      payload_json: { body: parsed.data.body },
    })
    .select('*')
    .single();
  if (error) throw httpError(500, 'Database error');

  // Re-fetch with the actor embedded for the response. Best-effort: if the
  // embed select fails for any reason, fall back to the bare inserted row.
  const created = data as { id: string } | null;
  if (created?.id) {
    const { data: withActor } = await db
      .from('task_activity')
      .select(ACTIVITY_SELECT)
      .eq('id', created.id)
      .maybeSingle();
    if (withActor) return res.status(201).json(withActor);
  }
  res.status(201).json(data);
};
