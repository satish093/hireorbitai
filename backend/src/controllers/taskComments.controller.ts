import { RequestHandler } from 'express';
import { db } from '../config/db';
import { httpError, ADMIN_TIER, type Role } from '../types';
import { assertCanAccessTask } from '../services/taskAccess';

const SELECT_WITH_AUTHOR = `*, author:users!author_id ( id, email, full_name )`;

function isAdmin(role: Role): boolean {
  return (ADMIN_TIER as Role[]).includes(role);
}

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // Centralised guard: admin-tier unscoped; group leads only their group's
  // tasks; everyone else only their own assigned/created. Previously this let
  // ANY MANAGER_TIER list comments on any task.
  await assertCanAccessTask(req.user, req.params.taskId);
  const { data, error } = await db
    .from('task_comments')
    .select(SELECT_WITH_AUTHOR)
    .eq('task_id', req.params.taskId)
    .order('created_at', { ascending: true });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertCanAccessTask(req.user, req.params.taskId);
  const body = String(req.body?.body ?? '').trim();
  if (!body) throw httpError(400, 'body is required');

  const { data, error } = await db
    .from('task_comments')
    .insert({ task_id: req.params.taskId, author_id: req.user.id, body })
    .select(SELECT_WITH_AUTHOR)
    .single();
  if (error) throw httpError(500, 'Database error');
  res.status(201).json(data);
};

export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: c } = await db
    .from('task_comments')
    .select('author_id, task_id')
    .eq('id', req.params.id)
    .single();
  if (!c) throw httpError(404, 'Comment not found');

  // Author can always delete their own comment; otherwise require task-scoped
  // access (admin unscoped, group lead in-group, plain user must be the
  // task assignee/creator). Previously any MANAGER_TIER could delete any
  // comment.
  if (c.author_id !== req.user.id) {
    if (!isAdmin(req.user.role as Role)) {
      await assertCanAccessTask(req.user, c.task_id);
    }
  }
  const { error } = await db.from('task_comments').delete().eq('id', req.params.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};
