import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, TASK_STATUSES, TASK_PRIORITIES, TaskStatus, TaskPriority } from '../types';

// ---------------------------------------------------------------------------
// Saved task filters (per-user named presets for the Tasks page).
//
// Routes mount at /tasks/filters and are scoped by req.user.id — a user can
// only see/edit their own filters. The criteria column is JSONB; the schema
// below pins the shape so we don't let a client store arbitrary blobs that
// the frontend can't render.
// ---------------------------------------------------------------------------

// Zod's z.enum() needs a non-empty tuple literal; the shared enum constants
// are readonly arrays. Same cast pattern used by users.controller and
// adminUsers.controller for ALL_ROLES.
const criteriaSchema = z
  .object({
    status: z.enum(TASK_STATUSES as unknown as [TaskStatus, ...TaskStatus[]]).optional(),
    priority: z.enum(TASK_PRIORITIES as unknown as [TaskPriority, ...TaskPriority[]]).optional(),
    assignee_id: z.string().uuid().optional(),
    consultant_id: z.string().uuid().optional(),
    recruiter_id: z.string().uuid().optional(),
    q: z.string().max(120).optional(),
    overdue: z.boolean().optional(),
  })
  .strict();

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  criteria: criteriaSchema,
  is_default: z.boolean().optional().default(false),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    criteria: criteriaSchema.optional(),
    is_default: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

async function assertOwner(filterId: string, userId: string): Promise<void> {
  const { data, error } = await db
    .from('task_filters')
    .select('id, user_id')
    .eq('id', filterId)
    .maybeSingle();
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, 'Filter not found');
  if (data.user_id !== userId) throw httpError(403, 'Forbidden');
}

// If the caller is setting is_default=true, clear every other default for
// this user first. Cheaper than a CHECK constraint; idempotent.
async function clearOtherDefaults(userId: string, exceptId?: string): Promise<void> {
  let qb = db.from('task_filters').update({ is_default: false }).eq('user_id', userId);
  if (exceptId) qb = qb.neq('id', exceptId);
  const { error } = await qb.eq('is_default', true);
  if (error) throw httpError(500, error.message);
}

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('task_filters')
    .select('id, name, criteria, is_default, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  if (parsed.data.is_default) await clearOtherDefaults(req.user.id);

  const { data, error } = await db
    .from('task_filters')
    .insert({
      user_id: req.user.id,
      name: parsed.data.name,
      criteria: parsed.data.criteria,
      is_default: parsed.data.is_default ?? false,
    })
    .select('id, name, criteria, is_default, created_at, updated_at')
    .single();
  if (error) {
    // Map the unique-violation to a 409 so the frontend can show "A filter
    // with that name already exists."
    if (/task_filters_user_name_unique|duplicate key/i.test(error.message)) {
      throw httpError(409, 'A filter with that name already exists.');
    }
    throw httpError(500, error.message);
  }
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertOwner(req.params.id, req.user.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  if (parsed.data.is_default === true) await clearOtherDefaults(req.user.id, req.params.id);

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.criteria !== undefined) patch.criteria = parsed.data.criteria;
  if (parsed.data.is_default !== undefined) patch.is_default = parsed.data.is_default;

  const { data, error } = await db
    .from('task_filters')
    .update(patch)
    .eq('id', req.params.id)
    .select('id, name, criteria, is_default, created_at, updated_at')
    .single();
  if (error) {
    if (/task_filters_user_name_unique|duplicate key/i.test(error.message)) {
      throw httpError(409, 'A filter with that name already exists.');
    }
    throw httpError(500, error.message);
  }
  res.json(data);
};

export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertOwner(req.params.id, req.user.id);
  const { error } = await db.from('task_filters').delete().eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
