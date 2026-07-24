import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';

const createSchema = z
  .object({
    title: z.string().min(1),
    due_at: z.string().min(1),
    description: z.string().optional().nullable(),
    related_type: z.string().optional().nullable(),
    related_id: z.string().uuid().optional().nullable(),
    status: z.string().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    title: z.string().min(1).optional(),
    due_at: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    related_type: z.string().optional().nullable(),
    related_id: z.string().uuid().optional().nullable(),
    status: z.string().optional(),
  })
  .strict();

// Every mutation here checks ownership before applying — previously update,
// complete, and remove would happily edit any reminder if the caller knew the
// id (an IDOR). The list/create paths already scope by req.user.id.

async function assertOwner(reminderId: string, userId: string): Promise<void> {
  const { data, error } = await db
    .from('reminders')
    .select('id, owner_id')
    .eq('id', reminderId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  // Ownership-mismatch returns 404 (not 403) so the endpoint isn't an existence
  // oracle — a non-owner probing UUIDs gets the same response whether the row
  // exists or not. Mirrors the canonical applications.loadAndAuthorize pattern.
  if (!data || data.owner_id !== userId) throw httpError(404, 'Reminder not found');
}

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const status = req.query.status as string | undefined;
  let qb = db.from('reminders').select('*').eq('owner_id', req.user.id);
  if (status) qb = qb.eq('status', status);
  const { data, error } = await qb.order('due_at', { ascending: true });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await db
    .from('reminders')
    .insert({ ...parsed.data, owner_id: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertOwner(req.params.id, req.user.id);
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await db
    .from('reminders')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const complete: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertOwner(req.params.id, req.user.id);
  const { data, error } = await db
    .from('reminders')
    .update({ status: 'DONE', completed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertOwner(req.params.id, req.user.id);
  const { error } = await db.from('reminders').delete().eq('id', req.params.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};
