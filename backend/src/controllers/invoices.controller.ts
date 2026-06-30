import { Request, RequestHandler } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db, pool } from '../config/db';
import { httpError, type Role } from '../types';
import { promises as fs } from 'node:fs';
import {
  renderInvoicePdf,
  invoiceFileBase,
  type InvoiceRow,
  type InvoiceBrand,
  type InvoiceLineItem,
  type InvoicePartySnapshot,
  type InvoicePayment,
} from '../services/invoicePdf.service';
import { resolveOnDisk } from '../config/storage.local';
import { sendInvoiceEmail } from '../services/brevo.service';
import { callerScopeGroupIds } from '../services/groupScope';
import {
  dispatchInvoiceReminder,
  invoiceAmountDue,
  daysOverdue,
} from '../services/invoiceReminder.service';
import { audit } from '../services/audit.service';
import { logger } from '../config/logger';
import { logoLooksLight } from '../utils/pngLuminance';

export const INVOICE_STATUSES = [
  'Draft',
  'Submitted',
  'Approved',
  'Partially Paid',
  'Paid',
  'Cancelled',
] as const;
type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const PAYMENT_METHODS = ['bank_transfer', 'check', 'card', 'cash', 'ach', 'wire', 'other'] as const;

// Per-invoice cooldown shared by the manual "Send reminder" button and the
// daily job's throttle stamp (last_overdue_alert_at). Keeps a manager from
// re-emailing the external client many times the same day.
const REMINDER_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/** Decimal-safe money rounding to 2 places (avoids float drift on balances). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, monthValue, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year!, monthValue! - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === monthValue! - 1 &&
      parsed.getUTCDate() === day
    );
  }, 'Invalid date');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const nullableText = (max: number) => z.string().trim().max(max).optional().nullable();
const partySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: nullableText(1000),
    email: z.string().email().optional().nullable(),
    phone: nullableText(60),
    website: nullableText(300),
    country: nullableText(100),
    tax_id: nullableText(100),
  })
  .strict();
const lineItemSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    service_period: month.optional().nullable(),
    quantity: z.coerce.number().positive().max(1_000_000),
    unit: z.string().trim().min(1).max(40),
    unit_rate: z.coerce.number().min(0).max(1_000_000_000),
  })
  .strict();

const writable = {
  company_group_id: z.string().uuid(),
  invoice_number: z.string().trim().min(1).max(100),
  invoice_date: isoDate.optional().nullable(),
  due_date: isoDate.optional().nullable(),
  net_terms_days: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .refine(
      (currency) => Intl.supportedValuesOf('currency').includes(currency),
      'Unsupported ISO currency code',
    )
    .default('USD'),
  discount_amount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  tax_percent: z.coerce.number().min(0).max(100).default(0),
  notes: nullableText(5000),
  issuer_snapshot: partySchema.optional(),
  bill_to_snapshot: partySchema,
  line_items: z.array(lineItemSchema).min(1).max(250),
};

const invoiceInputObject = z.object(writable).strict();
const validateDates = (
  v: { invoice_date?: string | null; due_date?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (v.invoice_date && v.due_date && v.due_date < v.invoice_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['due_date'],
      message: 'Due date cannot be before invoice date',
    });
  }
};

export const createSchema = invoiceInputObject.superRefine(validateDates);
export const updateSchema = invoiceInputObject.partial().superRefine(validateDates);
type InvoiceInput = z.infer<typeof invoiceInputObject>;

const listSchema = z.object({
  q: z.string().trim().max(200).default(''),
  company_group_id: z.string().uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  display_status: z.enum([...INVOICE_STATUSES, 'Overdue']).optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  archived: z.enum(['false', 'true', 'all']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

type ScopeCaller = { id: string; role: Role; group_id?: string | null };

function toMinor(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

export function calculateInvoiceTotals(
  items: Array<z.infer<typeof lineItemSchema>>,
  discount: number,
  taxPercent: number,
) {
  const lineItems: InvoiceLineItem[] = items.map((item, position) => {
    const amountMinor = Math.round(item.quantity * toMinor(item.unit_rate));
    return {
      ...item,
      position,
      amount: amountMinor / 100,
    };
  });
  const subtotalMinor = lineItems.reduce((sum, item) => sum + toMinor(Number(item.amount)), 0);
  const discountMinor = toMinor(discount);
  if (discountMinor > subtotalMinor) throw httpError(400, 'Discount cannot exceed subtotal');
  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = Math.round((taxableMinor * taxPercent) / 100);
  return {
    lineItems,
    subtotal: subtotalMinor / 100,
    discount_amount: discountMinor / 100,
    tax_percent: Math.round(taxPercent * 10_000) / 10_000,
    tax_amount: taxMinor / 100,
    total_amount: (taxableMinor + taxMinor) / 100,
  };
}

/** An invoice carries a live balance only while it is sent-but-unpaid. */
const UNPAID_STATUSES = ['Submitted', 'Approved', 'Partially Paid'] as const;
function isUnpaid(status: InvoiceRow['status']): boolean {
  return (UNPAID_STATUSES as readonly string[]).includes(status ?? '');
}

function displayStatus(invoice: InvoiceRow): InvoiceStatus | 'Overdue' {
  if (
    isUnpaid(invoice.status) &&
    invoice.due_date &&
    String(invoice.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10)
  ) {
    return 'Overdue';
  }
  return (invoice.status as InvoiceStatus) ?? 'Draft';
}

function permittedActions(invoice: InvoiceRow) {
  const archived = !!invoice.archived_at;
  const due = invoiceAmountDue(invoice);
  const collectible =
    !archived && (invoice.status === 'Approved' || invoice.status === 'Partially Paid') && due > 0;
  return {
    edit: !archived && (invoice.status === 'Draft' || invoice.status === 'Submitted'),
    submit: !archived && invoice.status === 'Draft',
    approve: !archived && invoice.status === 'Submitted',
    record_payment: collectible,
    mark_paid: collectible,
    cancel: !archived && (invoice.status === 'Submitted' || invoice.status === 'Approved'),
    remind: !archived && isUnpaid(invoice.status),
    email: !archived && isUnpaid(invoice.status),
    download: !archived,
    delete: !archived && invoice.status === 'Draft',
    archive: !archived && invoice.status !== 'Draft',
    restore: archived,
  };
}

async function lineItems(invoiceId: string): Promise<InvoiceLineItem[]> {
  const { rows } = await pool.query(
    `select id, invoice_id, description, service_period, quantity, unit, unit_rate, amount, position
       from public.invoice_line_items
      where invoice_id = $1
      order by position, id`,
    [invoiceId],
  );
  return rows;
}

async function statusHistory(invoiceId: string) {
  const { rows } = await pool.query(
    `select id, from_status, to_status, changed_by, changed_at, note
       from public.invoice_status_history
      where invoice_id = $1
      order by changed_at desc, id desc`,
    [invoiceId],
  );
  return rows;
}

async function payments(invoiceId: string): Promise<InvoicePayment[]> {
  const { rows } = await pool.query(
    `select id, invoice_id, amount, paid_on, method, reference, note, recorded_by, created_at
       from public.invoice_payments
      where invoice_id = $1
      order by paid_on desc, created_at desc, id desc`,
    [invoiceId],
  );
  return rows as InvoicePayment[];
}

async function enrich(invoice: InvoiceRow): Promise<InvoiceRow> {
  const result = { ...invoice };
  [result.line_items, result.status_history, result.payments] = await Promise.all([
    lineItems(invoice.id),
    statusHistory(invoice.id),
    payments(invoice.id),
  ]);
  result.amount_due = invoiceAmountDue(result);
  result.display_status = displayStatus(result);
  result.permitted_actions = permittedActions(result);
  return result;
}

async function loadInvoiceScopedOr404(id: string, caller: ScopeCaller): Promise<InvoiceRow> {
  const { rows } = await pool.query('select * from public.invoices where id = $1 limit 1', [id]);
  const invoice = rows[0] as InvoiceRow | undefined;
  if (!invoice) throw httpError(404, 'Invoice not found');
  const scope = await callerScopeGroupIds(caller);
  if (scope !== null && (!invoice.company_group_id || !scope.includes(invoice.company_group_id))) {
    throw httpError(404, 'Invoice not found');
  }
  return invoice;
}

async function assertCompany(caller: ScopeCaller, requested: string | undefined): Promise<string> {
  const scope = await callerScopeGroupIds(caller);
  if (scope !== null) {
    if (scope.length === 0) throw httpError(403, 'Assign a company before creating invoices.');
    const selected = requested ?? caller.group_id ?? scope[0];
    if (!selected || !scope.includes(selected))
      throw httpError(403, 'Company is outside your scope');
    return selected;
  }
  if (!requested) throw httpError(400, 'Company is required');
  return requested;
}

async function issuerForCompany(
  companyId: string,
  supplied?: InvoicePartySnapshot,
): Promise<InvoicePartySnapshot> {
  const { data, error } = await db
    .from('user_groups')
    .select('id, name, email')
    .eq('id', companyId)
    .maybeSingle();
  if (error || !data) throw httpError(400, 'Company not found');
  return {
    name: supplied?.name?.trim() || data.name,
    address: supplied?.address ?? null,
    email: supplied?.email ?? data.email ?? null,
    phone: supplied?.phone ?? null,
    website: supplied?.website ?? null,
    country: supplied?.country ?? null,
    tax_id: supplied?.tax_id ?? null,
  };
}

function auditInvoice(
  action:
    | 'invoice_created'
    | 'invoice_updated'
    | 'invoice_status_changed'
    | 'invoice_archived'
    | 'invoice_restored'
    | 'invoice_deleted'
    | 'invoice_downloaded'
    | 'invoice_payment_recorded'
    | 'invoice_payment_voided',
  req: Request,
  invoice: InvoiceRow,
  extra: Record<string, unknown> = {},
) {
  audit({
    action,
    user_id: req.user!.id,
    email: req.user!.email ?? null,
    req,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number ?? null,
      company_group_id: invoice.company_group_id ?? null,
      ...extra,
    },
  });
}

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) throw httpError(400, 'Invalid filters', parsed.error.flatten());
  const f = parsed.data;
  const scope = await callerScopeGroupIds(req.user);
  if (scope !== null && scope.length === 0) {
    res.json({
      items: [],
      total: 0,
      page: f.page,
      page_size: f.page_size,
      summary: {
        overdue_count: 0,
        draft_count: 0,
        total_by_currency: {},
        paid_by_currency: {},
        due_by_currency: {},
        overdue_by_currency: {},
        outstanding_by_currency: {},
      },
    });
    return;
  }

  // Base filters shared by the list AND the money-tile summary: scope, company,
  // date range, search. Status/archived filters apply to the LIST only — the
  // tiles summarize the whole active book so toggling a status filter never
  // moves the headline Total / Paid / Due / Overdue numbers.
  const baseValues: unknown[] = [];
  const baseWhere: string[] = [];
  const baseAdd = (v: unknown) => {
    baseValues.push(v);
    return `$${baseValues.length}`;
  };
  if (scope !== null) baseWhere.push(`company_group_id = any(${baseAdd(scope)})`);
  if (f.company_group_id) {
    if (scope !== null && !scope.includes(f.company_group_id)) {
      throw httpError(403, 'Company is outside your scope');
    }
    baseWhere.push(`company_group_id = ${baseAdd(f.company_group_id)}`);
  }
  if (f.date_from) baseWhere.push(`invoice_date >= ${baseAdd(f.date_from)}`);
  if (f.date_to) baseWhere.push(`invoice_date <= ${baseAdd(f.date_to)}`);
  if (f.q) {
    const q = baseAdd(`%${f.q}%`);
    baseWhere.push(
      `(invoice_number ilike ${q} or consultant_name ilike ${q} or vendor_name ilike ${q}
        or issuer_snapshot::text ilike ${q} or bill_to_snapshot::text ilike ${q})`,
    );
  }

  // List-only filters layered on top of the base (status / display_status / archived).
  const values = [...baseValues];
  const where = [...baseWhere];
  const add = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  if (f.status) where.push(`status = ${add(f.status)}`);
  if (f.display_status) {
    if (f.display_status === 'Overdue') {
      where.push(`status in ('Submitted','Approved','Partially Paid') and due_date < current_date`);
    } else {
      where.push(`status = ${add(f.display_status)}`);
      if (isUnpaid(f.display_status)) {
        where.push(`(due_date is null or due_date >= current_date)`);
      }
    }
  }
  if (f.archived === 'false') where.push('archived_at is null');
  if (f.archived === 'true') where.push('archived_at is not null');

  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const countValues = [...values];
  const offset = (f.page - 1) * f.page_size;
  const limitArg = add(f.page_size);
  const offsetArg = add(offset);

  // Money tiles + counts always scope to the active (non-archived) book.
  const summarySql = `where ${[...baseWhere, 'archived_at is null'].join(' and ')}`;

  const [rowsResult, countResult, countsResult, moneyResult] = await Promise.all([
    pool.query(
      `select *,
        case when status in ('Submitted','Approved','Partially Paid') and due_date < current_date
          then 'Overdue' else status end as display_status
       from public.invoices ${whereSql}
       order by due_date asc nulls last, created_at desc
       limit ${limitArg} offset ${offsetArg}`,
      values,
    ),
    pool.query(`select count(*)::int as total from public.invoices ${whereSql}`, countValues),
    pool.query(
      `select
         count(*) filter (
           where status in ('Submitted','Approved','Partially Paid') and due_date < current_date
         )::int as overdue_count,
         count(*) filter (where status = 'Draft')::int as draft_count
       from public.invoices ${summarySql}`,
      baseValues,
    ),
    pool.query(
      `select currency,
         coalesce(sum(total_amount) filter (where status <> 'Draft' and status <> 'Cancelled'), 0) as total,
         coalesce(sum(amount_paid) filter (where status <> 'Cancelled'), 0) as paid,
         coalesce(sum(greatest(total_amount - amount_paid, 0))
           filter (where status in ('Submitted','Approved','Partially Paid')), 0) as due,
         coalesce(sum(greatest(total_amount - amount_paid, 0))
           filter (where status in ('Submitted','Approved','Partially Paid') and due_date < current_date), 0) as overdue
       from public.invoices ${summarySql}
       group by currency
       order by currency`,
      baseValues,
    ),
  ]);

  const byCurrency = (key: 'total' | 'paid' | 'due' | 'overdue') =>
    Object.fromEntries(moneyResult.rows.map((row) => [row.currency, row[key]]));

  const items = (rowsResult.rows as InvoiceRow[]).map((row) => ({
    ...row,
    amount_due: invoiceAmountDue(row),
    permitted_actions: permittedActions(row),
  }));
  res.json({
    items,
    total: countResult.rows[0]?.total ?? 0,
    page: f.page,
    page_size: f.page_size,
    summary: {
      overdue_count: countsResult.rows[0]?.overdue_count ?? 0,
      draft_count: countsResult.rows[0]?.draft_count ?? 0,
      total_by_currency: byCurrency('total'),
      paid_by_currency: byCurrency('paid'),
      due_by_currency: byCurrency('due'),
      overdue_by_currency: byCurrency('overdue'),
      // Back-compat alias (was the only money tile before this change).
      outstanding_by_currency: byCurrency('due'),
    },
  });
};

export const companies: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const scope = await callerScopeGroupIds(req.user);
  if (scope !== null && scope.length === 0) {
    res.json([]);
    return;
  }
  let query = db.from('user_groups').select('id, name, email, color').order('name');
  if (scope !== null) query = query.in('id', scope);
  const { data, error } = await query;
  if (error) throw httpError(500, 'Database error');
  res.json(data ?? []);
};

export const get: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  res.json(await enrich(await loadInvoiceScopedOr404(req.params.id, req.user)));
};

async function persistInvoice(
  mode: 'create' | 'update',
  invoiceId: string | null,
  input: InvoiceInput,
  req: Request,
) {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const companyId = await assertCompany(req.user, input.company_group_id);
  const issuer = await issuerForCompany(companyId, input.issuer_snapshot);
  const totals = calculateInvoiceTotals(input.line_items, input.discount_amount, input.tax_percent);
  const first = totals.lineItems[0]!;
  const client = await pool.connect();
  try {
    await client.query('begin');
    let invoice: InvoiceRow;
    const common = [
      companyId,
      input.invoice_number,
      input.invoice_date ?? null,
      input.due_date ?? null,
      input.net_terms_days ?? null,
      input.currency,
      totals.discount_amount,
      totals.tax_percent,
      totals.subtotal,
      totals.tax_amount,
      totals.total_amount,
      JSON.stringify(issuer),
      JSON.stringify(input.bill_to_snapshot),
      input.notes ?? null,
      first.description,
      input.bill_to_snapshot.name,
      first.unit_rate,
      first.service_period ?? null,
      totals.total_amount,
      input.bill_to_snapshot.email ?? null,
    ];
    if (mode === 'create') {
      const result = await client.query(
        `insert into public.invoices (
          company_group_id, invoice_number, invoice_date, due_date, net_terms_days,
          currency, discount_amount, tax_percent, subtotal, tax_amount, total_amount,
          issuer_snapshot, bill_to_snapshot, notes, consultant_name, vendor_name,
          pay_rate, billing_month, invoice_amount, bill_to_email, status, created_by
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,
          $17,$18,$19,$20,'Draft',$21
        ) returning *`,
        [...common, req.user.id],
      );
      invoice = result.rows[0];
      await client.query(
        `insert into public.invoice_status_history
          (invoice_id, from_status, to_status, changed_by, note)
         values ($1,null,'Draft',$2,'Invoice created')`,
        [invoice.id, req.user.id],
      );
    } else {
      const result = await client.query(
        `update public.invoices set
          company_group_id=$1, invoice_number=$2, invoice_date=$3, due_date=$4,
          net_terms_days=$5, currency=$6, discount_amount=$7, tax_percent=$8,
          subtotal=$9, tax_amount=$10, total_amount=$11, issuer_snapshot=$12::jsonb,
          bill_to_snapshot=$13::jsonb, notes=$14, consultant_name=$15, vendor_name=$16,
          pay_rate=$17, billing_month=$18, invoice_amount=$19, bill_to_email=$20,
          updated_at=now()
         where id=$21 returning *`,
        [...common, invoiceId],
      );
      invoice = result.rows[0];
      await client.query('delete from public.invoice_line_items where invoice_id=$1', [invoiceId]);
    }
    for (const item of totals.lineItems) {
      await client.query(
        `insert into public.invoice_line_items
          (invoice_id, description, service_period, quantity, unit, unit_rate, amount, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          invoice.id,
          item.description,
          item.service_period ?? null,
          item.quantity,
          item.unit,
          item.unit_rate,
          item.amount,
          item.position,
        ],
      );
    }
    await client.query('commit');
    return await enrich(invoice);
  } catch (error: any) {
    await client.query('rollback');
    if (error?.code === '23505')
      throw httpError(409, 'Invoice number already exists for this company');
    if (error?.code === '23514' || error?.code === '22P02') {
      throw httpError(400, 'Invoice data violates a validation rule');
    }
    throw error;
  } finally {
    client.release();
  }
}

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const invoice = await persistInvoice('create', null, parsed.data, req);
  auditInvoice('invoice_created', req, invoice);
  res.status(201).json(invoice);
};

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const current = await loadInvoiceScopedOr404(req.params.id, req.user);
  if (current.archived_at) throw httpError(409, 'Archived invoices cannot be edited');
  if (current.status !== 'Draft' && current.status !== 'Submitted') {
    throw httpError(409, 'Financial fields are locked after approval');
  }
  const invoice = await persistInvoice('update', current.id, parsed.data, req);
  auditInvoice('invoice_updated', req, invoice);
  res.json(invoice);
};

const transitionSchema = z.object({
  to_status: z.enum(INVOICE_STATUSES),
  note: z.string().trim().max(1000).optional(),
});
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  Draft: ['Submitted'],
  Submitted: ['Approved', 'Cancelled'],
  // Approved → Paid is the "mark paid in full" shortcut (reconciled into the
  // payment ledger). Partial collection happens via POST /:id/payments instead.
  Approved: ['Paid', 'Cancelled'],
  'Partially Paid': ['Paid'],
  Paid: [],
  Cancelled: [],
};

export const transition: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid transition', parsed.error.flatten());
  const invoice = await loadInvoiceScopedOr404(req.params.id, req.user);
  if (invoice.archived_at) throw httpError(409, 'Restore the invoice before changing status');
  const from = invoice.status as InvoiceStatus;
  const to = parsed.data.to_status;
  if (!TRANSITIONS[from]?.includes(to)) {
    throw httpError(409, `Cannot transition invoice from ${from} to ${to}`);
  }
  const stampColumn: Record<string, string> = {
    Submitted: 'submitted_at',
    Approved: 'approved_at',
    Paid: 'paid_at',
    Cancelled: 'cancelled_at',
  };
  const column = stampColumn[to];
  // Marking Paid in full also settles the balance: set amount_paid = total and
  // drop a reconciling payment into the ledger so the two never diverge.
  const paidInFull = to === 'Paid';
  const setExtra = paidInFull ? ', amount_paid=total_amount' : '';
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `update public.invoices
          set status=$1, ${column}=now()${setExtra}, updated_at=now()
        where id=$2 and status=$3
        returning *`,
      [to, invoice.id, from],
    );
    if (!result.rows[0]) throw httpError(409, 'Invoice status changed; refresh and try again');
    await client.query(
      `insert into public.invoice_status_history
        (invoice_id, from_status, to_status, changed_by, note)
       values ($1,$2,$3,$4,$5)`,
      [invoice.id, from, to, req.user.id, parsed.data.note ?? null],
    );
    if (paidInFull) {
      const remaining = round2(
        Number(invoice.total_amount ?? 0) - Number(invoice.amount_paid ?? 0),
      );
      if (remaining > 0) {
        await client.query(
          `insert into public.invoice_payments
            (invoice_id, amount, paid_on, method, note, recorded_by)
           values ($1,$2,current_date,'other','Marked paid in full',$3)`,
          [invoice.id, remaining, req.user.id],
        );
      }
    }
    await client.query('commit');
    const updated = await enrich(result.rows[0]);
    auditInvoice('invoice_status_changed', req, updated, { from_status: from, to_status: to });
    res.json(updated);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

export const archive: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const invoice = await loadInvoiceScopedOr404(req.params.id, req.user);
  if (invoice.status === 'Draft') throw httpError(409, 'Delete drafts instead of archiving them');
  if (invoice.archived_at) throw httpError(409, 'Invoice is already archived');
  const { rows } = await pool.query(
    'update public.invoices set archived_at=now(), updated_at=now() where id=$1 returning *',
    [invoice.id],
  );
  const updated = await enrich(rows[0]);
  auditInvoice('invoice_archived', req, updated);
  res.json(updated);
};

export const restore: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const invoice = await loadInvoiceScopedOr404(req.params.id, req.user);
  if (!invoice.archived_at) throw httpError(409, 'Invoice is not archived');
  const { rows } = await pool.query(
    'update public.invoices set archived_at=null, updated_at=now() where id=$1 returning *',
    [invoice.id],
  );
  const updated = await enrich(rows[0]);
  auditInvoice('invoice_restored', req, updated);
  res.json(updated);
};

export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const invoice = await loadInvoiceScopedOr404(req.params.id, req.user);
  if (invoice.status !== 'Draft') throw httpError(409, 'Only Draft invoices can be deleted');
  await pool.query('delete from public.invoices where id=$1', [invoice.id]);
  auditInvoice('invoice_deleted', req, invoice);
  res.json({ ok: true });
};

const GROUP_LOGO_BUCKET = 'group-logos';
async function resolveInvoiceBrand(invoice: InvoiceRow): Promise<InvoiceBrand | undefined> {
  const gid = invoice.company_group_id;
  if (!gid) return undefined;
  const { data: grp } = await db
    .from('user_groups')
    .select('name, email, color, logo_path')
    .eq('id', gid)
    .maybeSingle();
  if (!grp) return undefined;
  let logo: Buffer | null = null;
  let logoUrl: string | null = null;
  if (grp.logo_path) {
    try {
      logo = await fs.readFile(resolveOnDisk(GROUP_LOGO_BUCKET, grp.logo_path));
    } catch {
      logo = null;
    }
    const { data: signed } = await db.storage
      .from(GROUP_LOGO_BUCKET)
      .createSignedUrl(grp.logo_path, 30 * 24 * 60 * 60);
    logoUrl = signed?.signedUrl ?? null;
  }
  return {
    name: invoice.issuer_snapshot?.name ?? grp.name ?? null,
    email: invoice.issuer_snapshot?.email ?? grp.email ?? null,
    color: grp.color ?? null,
    logo,
    logoUrl,
    // A near-white logo (white wordmark on transparency) gets a dark backdrop in
    // the PDF so it doesn't disappear on the white header.
    logoIsLight: logo ? logoLooksLight(logo) : false,
  };
}

export const document: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const invoice = await enrich(await loadInvoiceScopedOr404(req.params.id, req.user));
  if (invoice.archived_at) throw httpError(409, 'Restore the invoice before downloading it');
  const pdf = await renderInvoicePdf(invoice, await resolveInvoiceBrand(invoice));
  auditInvoice('invoice_downloaded', req, invoice);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoiceFileBase(invoice)}.pdf"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
};

const sendSchema = z.object({ recipient_email: z.string().email().optional() }).strict();
export const send: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = sendSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const invoice = await enrich(await loadInvoiceScopedOr404(req.params.id, req.user));
  if (invoice.archived_at) throw httpError(409, 'Restore the invoice before emailing it');
  if (!isUnpaid(invoice.status)) {
    throw httpError(409, 'Only sent (unpaid) invoices can be emailed');
  }
  const recipient = (
    parsed.data.recipient_email ??
    invoice.bill_to_snapshot?.email ??
    invoice.bill_to_email ??
    ''
  ).trim();
  if (!recipient) throw httpError(400, 'No recipient email');
  const brand = await resolveInvoiceBrand(invoice);
  const pdf = await renderInvoicePdf(invoice, brand);
  await sendInvoiceEmail({
    to: { email: recipient },
    invoice,
    pdf,
    fileName: `${invoiceFileBase(invoice)}.pdf`,
    company: brand ? { name: brand.name, logoUrl: brand.logoUrl } : undefined,
  });
  const stamp = new Date().toISOString();
  try {
    await pool.query('update public.invoices set last_emailed_at=$1 where id=$2', [
      stamp,
      invoice.id,
    ]);
  } catch (error) {
    logger.warn({ err: error, invoiceId: invoice.id }, 'invoice send: failed to stamp');
  }
  audit({
    action: 'invoice_emailed',
    user_id: req.user.id,
    email: req.user.email ?? null,
    req,
    metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, to: recipient },
  });
  res.json({ ok: true, emailed_to: recipient, last_emailed_at: stamp });
};

// ---------------------------------------------------------------------------
// Payments ledger — Wave-style partial payments.
// ---------------------------------------------------------------------------
const paymentSchema = z
  .object({
    amount: z.coerce.number().positive().max(1_000_000_000),
    paid_on: isoDate.optional().nullable(),
    method: z.enum(PAYMENT_METHODS).default('other'),
    reference: nullableText(200),
    note: nullableText(1000),
  })
  .strict();

/** Re-derive amount_paid + status from the ledger inside an open transaction. */
async function reconcileFromLedger(
  client: PoolClient,
  invoice: InvoiceRow,
  actorId: string,
  noteForHistory: string,
): Promise<InvoiceRow> {
  const sumRow = await client.query(
    `select coalesce(sum(amount),0) as paid from public.invoice_payments where invoice_id=$1`,
    [invoice.id],
  );
  const total = round2(Number(invoice.total_amount ?? 0));
  const newPaid = round2(Number((sumRow.rows[0] as { paid?: string })?.paid ?? 0));
  // No payments → back to Approved (payments are only ever taken after approval).
  let newStatus: InvoiceStatus;
  if (newPaid <= 0) newStatus = 'Approved';
  else if (newPaid >= total - 0.005) newStatus = 'Paid';
  else newStatus = 'Partially Paid';
  const fullyPaid = newStatus === 'Paid';
  const result = await client.query(
    `update public.invoices set
        amount_paid=$1,
        status=$2,
        paid_at = case when $3 then coalesce(paid_at, now()) else null end,
        updated_at=now()
      where id=$4
      returning *`,
    [newPaid, newStatus, fullyPaid, invoice.id],
  );
  if (newStatus !== invoice.status) {
    await client.query(
      `insert into public.invoice_status_history
        (invoice_id, from_status, to_status, changed_by, note)
       values ($1,$2,$3,$4,$5)`,
      [invoice.id, invoice.status, newStatus, actorId, noteForHistory],
    );
  }
  return result.rows[0] as InvoiceRow;
}

export const recordPayment: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid payment', parsed.error.flatten());
  const invoice = await loadInvoiceScopedOr404(req.params.id, req.user);
  if (invoice.archived_at) throw httpError(409, 'Restore the invoice before recording a payment');
  // Coarse fast-fail on the snapshot; the authoritative checks run under the
  // row lock below (the snapshot can be stale under concurrency).
  if (invoice.status !== 'Approved' && invoice.status !== 'Partially Paid') {
    throw httpError(409, 'Only approved invoices can take payments');
  }
  const amount = round2(parsed.data.amount);

  const client = await pool.connect();
  try {
    await client.query('begin');
    // Lock the invoice row and re-read the authoritative balance UNDER the lock,
    // so two concurrent payments can't both pass the over-balance guard and
    // overpay the invoice (amount_paid > total_amount).
    const locked = await client.query(
      `select status, total_amount, amount_paid
         from public.invoices where id=$1 for update`,
      [invoice.id],
    );
    const row = locked.rows[0] as
      | { status: string; total_amount: string; amount_paid: string }
      | undefined;
    if (!row) throw httpError(404, 'Invoice not found');
    if (row.status !== 'Approved' && row.status !== 'Partially Paid') {
      throw httpError(409, 'Only approved invoices can take payments');
    }
    const due = round2(Number(row.total_amount ?? 0) - Number(row.amount_paid ?? 0));
    if (due <= 0) throw httpError(409, 'Invoice is already paid in full');
    if (amount - due > 0.005) {
      throw httpError(
        400,
        `Payment of ${amount.toFixed(2)} exceeds the ${due.toFixed(2)} balance due`,
      );
    }
    await client.query(
      `insert into public.invoice_payments
        (invoice_id, amount, paid_on, method, reference, note, recorded_by)
       values ($1,$2,coalesce($3::date, current_date),$4,$5,$6,$7)`,
      [
        invoice.id,
        amount,
        parsed.data.paid_on ?? null,
        parsed.data.method,
        parsed.data.reference ?? null,
        parsed.data.note ?? null,
        req.user.id,
      ],
    );
    const updatedRow = await reconcileFromLedger(
      client,
      { ...invoice, status: row.status, total_amount: row.total_amount },
      req.user.id,
      `Payment recorded: ${amount.toFixed(2)}`,
    );
    await client.query('commit');
    const updated = await enrich(updatedRow);
    auditInvoice('invoice_payment_recorded', req, updated, {
      amount,
      method: parsed.data.method,
      amount_paid: updated.amount_paid,
      new_status: updated.status,
    });
    res.status(201).json(updated);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

export const voidPayment: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const invoice = await loadInvoiceScopedOr404(req.params.id, req.user);
  if (invoice.archived_at) throw httpError(409, 'Restore the invoice before editing payments');
  // Don't let a void silently un-pay a settled invoice. A fully Paid invoice
  // (including historical ones the migration backfilled with a reconciling
  // payment, and "Marked paid in full") must not be reverted to Approved by
  // deleting a ledger row — that would clear paid_at and re-open collections.
  if (invoice.status === 'Paid') {
    throw httpError(409, 'Cannot void a payment on a fully paid invoice.');
  }
  const { rows } = await pool.query(
    `select id, amount from public.invoice_payments where id=$1 and invoice_id=$2`,
    [req.params.paymentId, invoice.id],
  );
  const payment = rows[0] as { id: string; amount: string } | undefined;
  if (!payment) throw httpError(404, 'Payment not found');

  const client = await pool.connect();
  try {
    await client.query('begin');
    // Lock + re-check under the lock so a concurrent payment that just settled
    // the invoice can't be silently un-paid by a racing void.
    const locked = await client.query(
      `select status, total_amount from public.invoices where id=$1 for update`,
      [invoice.id],
    );
    const row = locked.rows[0] as { status: string; total_amount: string } | undefined;
    if (!row) throw httpError(404, 'Invoice not found');
    if (row.status === 'Paid') {
      throw httpError(409, 'Cannot void a payment on a fully paid invoice.');
    }
    await client.query(`delete from public.invoice_payments where id=$1`, [payment.id]);
    const updatedRow = await reconcileFromLedger(
      client,
      { ...invoice, status: row.status, total_amount: row.total_amount },
      req.user.id,
      `Payment voided: ${round2(Number(payment.amount)).toFixed(2)}`,
    );
    await client.query('commit');
    const updated = await enrich(updatedRow);
    auditInvoice('invoice_payment_voided', req, updated, {
      payment_id: payment.id,
      amount: Number(payment.amount),
      amount_paid: updated.amount_paid,
      new_status: updated.status,
    });
    res.json(updated);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------------------
// Manual overdue / payment reminder — emails the client + the company managers.
// (The daily invoice-overdue job sends the same notice automatically.)
// ---------------------------------------------------------------------------
export const remind: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const invoice = await enrich(await loadInvoiceScopedOr404(req.params.id, req.user));
  if (invoice.archived_at) throw httpError(409, 'Restore the invoice before sending a reminder');
  if (!isUnpaid(invoice.status)) {
    throw httpError(409, 'Only sent (unpaid) invoices can be reminded');
  }
  // Per-invoice throttle: don't let repeated clicks spam the client. Shared with
  // the daily job's stamp, so a just-sent automatic reminder also blocks here.
  if (invoice.last_overdue_alert_at) {
    const elapsed = Date.now() - new Date(invoice.last_overdue_alert_at as string).getTime();
    if (elapsed >= 0 && elapsed < REMINDER_COOLDOWN_MS) {
      const hours = Math.ceil((REMINDER_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
      throw httpError(429, `A reminder was already sent recently. Try again in ${hours}h.`);
    }
  }
  const result = await dispatchInvoiceReminder(invoice);
  if (!result.client_emailed && result.managers_emailed === 0) {
    throw httpError(422, 'No reminder recipients — add a bill-to email or a company manager.');
  }
  const stamp = new Date().toISOString();
  try {
    await pool.query('update public.invoices set last_overdue_alert_at=$1 where id=$2', [
      stamp,
      invoice.id,
    ]);
  } catch (error) {
    logger.warn({ err: error, invoiceId: invoice.id }, 'invoice remind: failed to stamp');
  }
  audit({
    action: 'invoice_reminded',
    user_id: req.user.id,
    email: req.user.email ?? null,
    req,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      client_emailed: result.client_emailed,
      managers_emailed: result.managers_emailed,
      days_overdue: daysOverdue(invoice.due_date),
    },
  });
  res.json({ ok: true, ...result, last_overdue_alert_at: stamp });
};
