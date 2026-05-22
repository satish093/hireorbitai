import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';

// Mass-assignment guard. Only these columns are client-writable; server-owned
// fields (id, created_by, created_at, updated_at) are set server-side and must
// never come off the request body. `.strict()` rejects any unknown key.
// Mirrors the canonical allowlist pattern in applications.controller.ts.
const clientWritable = {
  company_name: z.string().min(1),
  industry: z.string().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  contact_email: z.string().optional().nullable(),
  contact_phone: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
};
const createSchema = z.object(clientWritable).strict();
const updateSchema = z.object(clientWritable).partial().strict();

export const list: RequestHandler = async (req, res) => {
  const q = (req.query.q as string) ?? '';
  let qb = db.from('clients').select('*');
  if (q) qb = qb.ilike('company_name', `%${q}%`);
  const { data, error } = await qb.order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const get: RequestHandler = async (req, res) => {
  const { data, error } = await db.from('clients').select('*').eq('id', req.params.id).single();
  if (error) throw httpError(404, error.message);
  res.json(data);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await db
    .from('clients')
    .insert({ ...parsed.data, created_by: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await db
    .from('clients')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const remove: RequestHandler = async (req, res) => {
  const { error } = await db.from('clients').delete().eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
