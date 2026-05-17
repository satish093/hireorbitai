import { RequestHandler } from 'express';
import { db } from '../config/db';
import {
  httpError,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TaskStatus,
  TaskPriority,
  MANAGER_TIER,
} from '../types';

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
  if (!isManagerLike(req.user.role)) qb = qb.eq('assignee_id', req.user.id);
  qb = applyFilters(qb, req.query as Record<string, any>);
  const { data, error } = await qb
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);
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
  if (!isManagerLike(req.user.role) && data.assignee_id !== req.user.id) {
    throw httpError(403, 'Forbidden');
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
  // Only include `tags` when actually provided and the column exists. Tries
  // first with tags; on the schema-cache error, retries without — keeps task
  // creation working even before database/tasks-tags.sql has been applied.
  if (Array.isArray(b.tags) && b.tags.length > 0) payload.tags = b.tags;

  let { data, error } = await db.from('tasks').insert(payload).select(SELECT_WITH_JOINS).single();
  if (error && /tags/i.test(error.message) && /schema cache|column/i.test(error.message)) {
    delete payload.tags;
    ({ data, error } = await db.from('tasks').insert(payload).select(SELECT_WITH_JOINS).single());
  }
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
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
  if (!isMgr && !isAssignee) throw httpError(403, 'Forbidden');

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

  let { data, error } = await db
    .from('tasks')
    .update(allowed)
    .eq('id', id)
    .select(SELECT_WITH_JOINS)
    .single();
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
    ({ data, error } = await db
      .from('tasks')
      .update(allowed)
      .eq('id', id)
      .select(SELECT_WITH_JOINS)
      .single());
  }
  if (error) throw httpError(500, error.message);
  res.json(data);
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
  if (!isManagerLike(req.user.role) && existing.assignee_id !== req.user.id) {
    throw httpError(403, 'Forbidden');
  }

  const patch: Record<string, unknown> = { status };
  patch.completed_at = status === 'COMPLETED' ? new Date().toISOString() : null;
  const { data, error } = await db
    .from('tasks')
    .update(patch)
    .eq('id', req.params.id)
    .select(SELECT_WITH_JOINS)
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

/** Delete. Manager / Super admin only. */
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerLike(req.user.role)) throw httpError(403, 'Forbidden');
  const { error } = await db.from('tasks').delete().eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

/** Tasks assigned to the calling user. */
export const assignedToMe: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  let qb = db.from('tasks').select(SELECT_WITH_JOINS).eq('assignee_id', req.user.id);
  qb = applyFilters(qb, req.query as Record<string, any>);
  const { data, error } = await qb.order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw httpError(500, error.message);
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
  if (req.user.role === 'MANAGER') {
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
  if (error) throw httpError(500, error.message);
  res.json(data);
};

/** Manager dashboard metrics: counts by status, by priority, overdue, completed-this-week. */
export const metrics: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerLike(req.user.role)) throw httpError(403, 'Forbidden');

  const { data, error } = await db.from('tasks').select('status, priority, due_at, completed_at');
  if (error) throw httpError(500, error.message);

  const by_status: Record<string, number> = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0]));
  const by_priority: Record<string, number> = Object.fromEntries(
    TASK_PRIORITIES.map((p) => [p, 0]),
  );
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

  for (const t of data ?? []) {
    by_status[t.status] = (by_status[t.status] ?? 0) + 1;
    by_priority[t.priority] = (by_priority[t.priority] ?? 0) + 1;
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
    total: (data ?? []).length,
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
