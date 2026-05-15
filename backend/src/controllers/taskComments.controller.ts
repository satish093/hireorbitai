import { RequestHandler } from 'express';
import { db } from '../config/db';
import { httpError, MANAGER_TIER } from '../types';

function isManagerLike(role: string): boolean {
  return (MANAGER_TIER as string[]).includes(role);
}

const SELECT_WITH_AUTHOR = `*, author:users!author_id ( id, email, full_name )`;

async function canAccessTask(taskId: string, userId: string, role: string): Promise<boolean> {
  if (isManagerLike(role)) return true;
  const { data } = await db.from('tasks').select('assignee_id').eq('id', taskId).single();
  return data?.assignee_id === userId;
}

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const taskId = req.params.taskId;
  if (!(await canAccessTask(taskId, req.user.id, req.user.role))) {
    throw httpError(403, 'Forbidden');
  }
  const { data, error } = await db
    .from('task_comments')
    .select(SELECT_WITH_AUTHOR)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const taskId = req.params.taskId;
  if (!(await canAccessTask(taskId, req.user.id, req.user.role))) {
    throw httpError(403, 'Forbidden');
  }
  const body = String(req.body?.body ?? '').trim();
  if (!body) throw httpError(400, 'body is required');

  const { data, error } = await db
    .from('task_comments')
    .insert({ task_id: taskId, author_id: req.user.id, body })
    .select(SELECT_WITH_AUTHOR)
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: c } = await db
    .from('task_comments')
    .select('author_id')
    .eq('id', req.params.id)
    .single();
  if (!c) throw httpError(404, 'Comment not found');
  const canDelete = isManagerLike(req.user.role) || c.author_id === req.user.id;
  if (!canDelete) throw httpError(403, 'Forbidden');
  const { error } = await db.from('task_comments').delete().eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
