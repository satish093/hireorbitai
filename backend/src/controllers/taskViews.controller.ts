import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';

// ---------------------------------------------------------------------------
// Per-user saved task views for the Tasks workspace.
//
// Routes mount at /task-views and are scoped by req.user.id — a user can only
// see/edit/delete their own views. The filters_json column is JSONB; the
// frontend maps filters_json -> filters when it loads a view.
// ---------------------------------------------------------------------------

const VIEW_MODES = ['kanban', 'table', 'timeline'] as const;

const SELECT_COLS = 'id, name, filters_json, sort_by, view_mode';

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    filters_json: z.record(z.any()),
    sort_by: z.string().nullable().optional(),
    view_mode: z.enum(VIEW_MODES).default('kanban'),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    filters_json: z.record(z.any()).optional(),
    sort_by: z.string().nullable().optional(),
    view_mode: z.enum(VIEW_MODES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

// Load the view and confirm ownership. 404 (not 403) on a foreign row so the
// endpoint can't be used as an existence oracle.
async function loadOwnView(viewId: string, userId: string) {
  const { data, error } = await db
    .from('task_views')
    .select('id, user_id')
    .eq('id', viewId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!data || data.user_id !== userId) throw httpError(404, 'View not found');
  return data;
}

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('task_views')
    .select(SELECT_COLS)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: true });
  if (error) throw httpError(500, 'Database error');
  res.json(data ?? []);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  const { data, error } = await db
    .from('task_views')
    .insert({
      user_id: req.user.id,
      name: parsed.data.name,
      filters_json: parsed.data.filters_json,
      sort_by: parsed.data.sort_by ?? null,
      view_mode: parsed.data.view_mode,
    })
    .select(SELECT_COLS)
    .single();
  if (error) throw httpError(500, 'Database error');
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadOwnView(req.params.id, req.user.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.filters_json !== undefined) patch.filters_json = parsed.data.filters_json;
  if (parsed.data.sort_by !== undefined) patch.sort_by = parsed.data.sort_by;
  if (parsed.data.view_mode !== undefined) patch.view_mode = parsed.data.view_mode;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from('task_views')
    .update(patch)
    .eq('id', req.params.id)
    .select(SELECT_COLS)
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadOwnView(req.params.id, req.user.id);
  const { error } = await db.from('task_views').delete().eq('id', req.params.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};
