import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';
import { promises as fs } from 'node:fs';
import {
  renderInvoicePdf,
  invoiceFileBase,
  type InvoiceRow,
  type InvoiceBrand,
} from '../services/invoicePdf.service';
import { resolveOnDisk } from '../config/storage.local';
import { sendInvoiceEmail } from '../services/brevo.service';
import { audit } from '../services/audit.service';
import { logger } from '../config/logger';

// Allowed status values — kept in sync with the CHECK constraint in
// migrations/1760000000000_invoices.sql and the frontend SelectInput options.
export const INVOICE_STATUSES = [
  'Draft',
  'Submitted',
  'Approved',
  'Paid',
  'Overdue',
  'Cancelled',
] as const;

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
  // Where the generated invoice PDF is emailed when the user toggles "Email this
  // invoice" on. Optional contact field — accepts a valid email or '' (the blank
  // is normalized to NULL below so the column stores NULL, not ''). Mirrors the
  // `httpUrl.or(z.literal(''))` pattern used elsewhere. `last_emailed_at` is NOT
  // here: it is server-set only (see /invoices/:id/send).
  bill_to_email: z.string().email().or(z.literal('')).optional().nullable(),
  // The issuing company (a user group). Its name + logo brand the generated PDF.
  // Accepts a uuid or '' (normalized to NULL below).
  company_group_id: z.string().uuid().or(z.literal('')).optional().nullable(),
};
export const createSchema = z.object(writable).strict();
export const updateSchema = z.object(writable).partial().strict();

// Columns from migration 1764000000000 that may not be applied in every
// environment yet. We try the full write first, then strip these and retry on a
// schema-cache / missing-column error so the backend can deploy ahead of the
// migration. (Same retry-and-strip pattern used across the codebase.)
const LATE_COLUMNS = [
  'pay_rate',
  'invoice_amount',
  'billing_month',
  'bill_to_email',
  'last_emailed_at',
  'company_group_id',
] as const;
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
  for (const k of [
    'invoice_date',
    'due_date',
    'invoice_number',
    'notes',
    'billing_month',
    'bill_to_email',
    'company_group_id',
  ]) {
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

/** Load the full invoice row or 404. Authorization is the route-level
 *  MANAGER_TIER gate (shared back-office tracker — no per-row ownership). */
async function loadInvoiceOr404(id: string): Promise<InvoiceRow> {
  const { data, error } = await db.from('invoices').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw httpError(404, 'Invoice not found');
  return data as InvoiceRow;
}

const GROUP_LOGO_BUCKET = 'group-logos';

/** Resolve the issuing-company branding for an invoice from its company_group_id:
 *  the group's name + the bytes of its uploaded logo (read off the filesystem
 *  bucket). All best-effort — a missing group/logo just falls back to the default
 *  brand in the PDF, never an error. */
async function resolveInvoiceBrand(invoice: InvoiceRow): Promise<InvoiceBrand | undefined> {
  const gid = invoice.company_group_id;
  if (!gid) return undefined;
  // Select the brand columns; on a schema-cache error (email/color not migrated)
  // fall back to the minimal name+logo set so branding still works.
  let { data: grp } = await db
    .from('user_groups')
    .select('name, email, color, logo_path')
    .eq('id', gid)
    .maybeSingle();
  if (!grp) {
    ({ data: grp } = await db
      .from('user_groups')
      .select('name, logo_path')
      .eq('id', gid)
      .maybeSingle());
  }
  if (!grp) return undefined;
  const row = grp as {
    name?: string | null;
    email?: string | null;
    color?: string | null;
    logo_path?: string | null;
  };
  let logo: Buffer | null = null;
  let logoUrl: string | null = null;
  if (row.logo_path) {
    try {
      logo = await fs.readFile(resolveOnDisk(GROUP_LOGO_BUCKET, row.logo_path));
    } catch {
      logo = null; // logo file gone / unreadable → placeholder mark
    }
    // Signed URL for the email header (read days later → long TTL). Best-effort.
    const { data: signed } = await db.storage
      .from(GROUP_LOGO_BUCKET)
      .createSignedUrl(row.logo_path, 30 * 24 * 60 * 60);
    logoUrl = signed?.signedUrl ?? null;
  }
  return {
    name: row.name ?? null,
    email: row.email ?? null,
    color: row.color ?? null,
    logo,
    logoUrl,
  };
}

/** GET /invoices/:id/document — stream a freshly-rendered invoice PDF for
 *  download. Generated on demand (never persisted) so it always reflects the
 *  current row. */
export const document: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const invoice = await loadInvoiceOr404(req.params.id);
  const pdf = await renderInvoicePdf(invoice, await resolveInvoiceBrand(invoice));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoiceFileBase(invoice)}.pdf"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
};

// Body is `.strict()` — only an optional recipient override is accepted; the
// invoice's stored bill_to_email is the default.
const sendSchema = z.object({ recipient_email: z.string().email().optional() }).strict();

/** POST /invoices/:id/send — email the invoice PDF to the bill-to address (or an
 *  explicit recipient_email override). This is the "Email this invoice" toggle. */
export const send: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = sendSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const invoice = await loadInvoiceOr404(req.params.id);
  const recipient = (parsed.data.recipient_email ?? invoice.bill_to_email ?? '').trim();
  if (!recipient) {
    throw httpError(400, 'No recipient email — add a Bill-to email or pass recipient_email.');
  }

  const brand = await resolveInvoiceBrand(invoice);
  const pdf = await renderInvoicePdf(invoice, brand);
  await sendInvoiceEmail({
    to: { email: recipient },
    invoice,
    pdf,
    fileName: `${invoiceFileBase(invoice)}.pdf`,
    company: brand ? { name: brand.name, logoUrl: brand.logoUrl } : undefined,
  });

  // Stamp last_emailed_at — best-effort. The email already went out, so a missing
  // column (pre-migration) or a write error must not fail the request.
  const stamp = new Date().toISOString();
  const { error: updErr } = await db
    .from('invoices')
    .update({ last_emailed_at: stamp })
    .eq('id', invoice.id);
  if (updErr && !isMissingColumn(updErr.message)) {
    logger.warn(
      { err: updErr, invoiceId: invoice.id },
      'invoice send: failed to stamp last_emailed_at',
    );
  }

  audit({
    action: 'invoice_emailed',
    user_id: req.user.id,
    email: req.user.email ?? null,
    req,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number ?? null,
      to: recipient,
    },
  });

  res.json({ ok: true, emailed_to: recipient, last_emailed_at: stamp });
};
