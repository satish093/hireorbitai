import { beforeEach, describe, expect, it, vi } from 'vitest';

// Running ledger backing the mocked pool. The `paid` accumulator mirrors what
// `select sum(amount)` would return as payments are inserted / deleted.
const mock = vi.hoisted(() => ({
  invoice: null as any,
  paid: 0,
  payments: [] as Array<{ id: string; amount: number }>,
  history: [] as unknown[][],
}));

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

vi.mock('../config/db', () => {
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (/select \* from public\.invoices where id/.test(text)) {
      return { rows: mock.invoice ? [mock.invoice] : [] };
    }
    if (/from public\.invoice_line_items/.test(text)) return { rows: [] };
    if (/from public\.invoice_status_history/.test(text)) return { rows: [] };
    if (/select id, amount from public\.invoice_payments/.test(text)) {
      const found = mock.payments.find((p) => p.id === values[0]);
      return { rows: found ? [found] : [] };
    }
    if (/from public\.invoice_payments/.test(text)) return { rows: mock.payments };
    return { rows: [] };
  });
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      if (/^\s*(begin|commit|rollback)\s*$/i.test(text)) return { rows: [] };
      if (/insert into public\.invoice_payments/.test(text)) {
        const amount = Number(values[1]);
        mock.paid = round2(mock.paid + amount);
        mock.payments.unshift({ id: `pay-${mock.payments.length + 1}`, amount });
        return { rows: [] };
      }
      if (/delete from public\.invoice_payments/.test(text)) {
        const idx = mock.payments.findIndex((p) => p.id === values[0]);
        if (idx >= 0) {
          mock.paid = round2(mock.paid - mock.payments[idx]!.amount);
          mock.payments.splice(idx, 1);
        }
        return { rows: [] };
      }
      if (/select coalesce\(sum\(amount\),0\) as paid/.test(text)) {
        return { rows: [{ paid: mock.paid }] };
      }
      if (/update public\.invoices set/.test(text) && /amount_paid=\$1/.test(text)) {
        mock.invoice = { ...mock.invoice, amount_paid: values[0], status: values[1] };
        return { rows: [mock.invoice] };
      }
      if (/invoice_status_history/.test(text)) {
        mock.history.push(values);
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const db = {
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    },
  };
  return { db, pool: { query, connect: () => Promise.resolve(client) } };
});
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/brevo.service', () => ({
  sendInvoiceEmail: vi.fn(),
  sendInvoiceOverdueNotice: vi.fn(),
}));
vi.mock('../services/invoiceReminder.service', () => ({
  dispatchInvoiceReminder: vi.fn(async () => ({
    client_emailed: 'client@test',
    managers_emailed: 2,
  })),
  invoiceAmountDue: (inv: any) =>
    Math.max(0, round2(Number(inv.total_amount ?? 0) - Number(inv.amount_paid ?? 0))),
  daysOverdue: () => 0,
}));

import { recordPayment, voidPayment, remind } from './invoices.controller';

const USER = { id: 'admin', role: 'CTO', email: 'admin@test', group_id: null };

function response() {
  return {
    body: null as any,
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: any) {
      this.body = value;
      return this;
    },
  };
}

async function run(handler: any, req: any = {}) {
  const res = response();
  try {
    await handler({ user: USER, params: { id: 'inv-1' }, body: {}, ...req }, res as any, vi.fn());
    return { res, error: null as any };
  } catch (error) {
    return { res, error: error as { status?: number } };
  }
}

beforeEach(() => {
  mock.invoice = {
    id: 'inv-1',
    company_group_id: null,
    invoice_number: 'INV-1',
    status: 'Approved',
    currency: 'USD',
    due_date: '2026-07-01',
    total_amount: 100,
    amount_paid: 0,
  };
  mock.paid = 0;
  mock.payments = [];
  mock.history = [];
});

describe('invoice partial payments', () => {
  it('records a partial payment → Partially Paid, then the remainder → Paid', async () => {
    const first = await run(recordPayment, { body: { amount: 40 } });
    expect(first.error).toBeNull();
    expect(first.res.statusCode).toBe(201);
    expect(first.res.body.status).toBe('Partially Paid');
    expect(Number(first.res.body.amount_paid)).toBe(40);
    expect(Number(first.res.body.amount_due)).toBe(60);

    const second = await run(recordPayment, { body: { amount: 60 } });
    expect(second.error).toBeNull();
    expect(second.res.body.status).toBe('Paid');
    expect(Number(second.res.body.amount_due)).toBe(0);
  });

  it('rejects a payment that exceeds the balance due', async () => {
    expect((await run(recordPayment, { body: { amount: 150 } })).error?.status).toBe(400);
  });

  it('refuses payments on invoices that are not yet approved', async () => {
    mock.invoice.status = 'Submitted';
    expect((await run(recordPayment, { body: { amount: 10 } })).error?.status).toBe(409);
  });

  it('voiding the only payment reverts the invoice to Approved', async () => {
    await run(recordPayment, { body: { amount: 40 } });
    expect(mock.invoice.status).toBe('Partially Paid');
    const voided = await run(voidPayment, { params: { id: 'inv-1', paymentId: 'pay-1' } });
    expect(voided.error).toBeNull();
    expect(voided.res.body.status).toBe('Approved');
    expect(Number(voided.res.body.amount_paid)).toBe(0);
  });
});

describe('invoice reminder', () => {
  it('dispatches to client + managers for an unpaid invoice', async () => {
    const { res, error } = await run(remind);
    expect(error).toBeNull();
    expect(res.body.ok).toBe(true);
    expect(res.body.managers_emailed).toBe(2);
  });

  it('refuses to remind a paid invoice', async () => {
    mock.invoice.status = 'Paid';
    expect((await run(remind)).error?.status).toBe(409);
  });
});
