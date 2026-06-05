import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';

// Allowed status values — kept in sync with the CHECK constraint in
// migrations/1760000000000_invoices.sql and the frontend SelectInput options.
export const INVOICE_STATUSES = ['Submitted', 'Approved', 'Paid', 'Overdue', 'Cancelled'] as const;

// Mass-assignment guard. Only these columns are client-writable; server-owned
// fields (id, created_by, created_at, updated_at) are set server-side and must
// never come off the request body. `.strict()` rejects any unknown key so a
// caller can't smuggle in created_by or a future privileged column. Mirrors the
// canonical allowlist pattern in vendors.controller.ts / applications.controller.ts.
const writable = {
  consultant_name: z.string().min(1),
  vendor_name: z.string().min(1),
  invoice_number: z.string().optional().nullable(),
  // HTML <input type="date"> → 'YYYY-MM-DD'. Empty string is normalized to null
  // before the DB call so the Postgres `date` column doesn't choke on ''.
  invoice_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  net_terms_days: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  // Finance fields (migration 1764000000000). Money is numeric; the frontend
  // sends null (not '') for an empty amount so z.coerce never turns '' into 0.
  // billing_month is free text — 'YYYY-MM' from an <input type="month">.
  pay_rate: z.coerce.number().min(0).max(1_000_000_000).optional().nullable(),
  invoice_amount: z.coerce.number().min(0).max(1_000_000_000).optional().nullable(),
  billing_month: z.string().optional().nullable(),
  status: z.enum(INVOICE_STATUSES).optional(),
  notes: z.string().optional().nullable(),
};
export const createSchema = z.object(writable).strict();
export const updateSchema = z.object(writable).partial().strict();

// Columns from migration 1764000000000 that may not be applied in every
// environment yet. We try the full write first, then strip these and retry on a
// schema-cache / missing-column error so the backend can deploy ahead of the
// migration. (Same retry-and-strip pattern used across the codebase.)
const LATE_COLUMNS = ['pay_rate', 'invoice_amount', 'billing_month'] as const;
function stripLateColumns(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const k of LATE_COLUMNS) delete out[k];
  return out;
}
function isMissingColumn(message?: string): boolean {
  return !!message && /schema cache|column .* does not exist/i.test(message);
}

// Empty-string → null for the text/date columns (a blank date '' is not a valid
// Postgres `date`; a blank invoice_number/notes/billing_month should store as
// NULL not '').
function normalize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const k of ['invoice_date', 'due_date', 'invoice_number', 'notes', 'billing_month']) {
    if (out[k] === '') out[k] = null;
  }
  return out;
}

// Existence check for mutation/read-by-id paths. Authorization is the route-level
// MANAGER_TIER gate (this is a shared back-office tracker — every manager-tier
// user manages every row), so there is no per-row ownership check; we only 404
// on a missing id.
async function loadOr404(id: string): Promise<void> {
  const { data } = await db.from('invoices').select('id').eq('id', id).maybeSingle();
  if (!data) throw httpError(404, 'Invoice not found');
}

export const list: RequestHandler = async (req, res) => {
  const status = (req.query.status as string) ?? '';
  let qb = db.from('invoices').select('*');
  if (status) qb = qb.eq('status', status);
  const { data, error } = await qb.order('due_date', { ascending: true });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const get: RequestHandler = async (req, res) => {
  const { data, error } = await db.from('invoices').select('*').eq('id', req.params.id).single();
  if (error) throw httpError(404, 'Invoice not found');
  res.json(data);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const row = { ...normalize(parsed.data), created_by: req.user.id };
  let { data, error } = await db.from('invoices').insert(row).select().single();
  if (error && isMissingColumn(error.message)) {
    ({ data, error } = await db.from('invoices').insert(stripLateColumns(row)).select().single());
  }
  if (error) throw httpError(500, 'Database error');
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  await loadOr404(req.params.id);
  const row = { ...normalize(parsed.data), updated_at: new Date().toISOString() };
  let { data, error } = await db
    .from('invoices')
    .update(row)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error && isMissingColumn(error.message)) {
    ({ data, error } = await db
      .from('invoices')
      .update(stripLateColumns(row))
      .eq('id', req.params.id)
      .select()
      .single());
  }
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadOr404(req.params.id);
  const { error } = await db.from('invoices').delete().eq('id', req.params.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};
