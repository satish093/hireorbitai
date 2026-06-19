import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  invoice: null as any,
  deleted: false,
  archived: false,
  restored: false,
  history: [] as any[],
}));

vi.mock('../config/db', () => {
  const query = vi.fn(async (text: string) => {
    if (/select \* from public\.invoices where id/.test(text)) {
      return { rows: mock.invoice ? [mock.invoice] : [] };
    }
    if (/invoice_line_items/.test(text)) return { rows: [] };
    if (/delete from public\.invoices/.test(text)) {
      mock.deleted = true;
      return { rows: [] };
    }
    if (/set archived_at=now/.test(text)) {
      mock.archived = true;
      return { rows: [{ ...mock.invoice, archived_at: '2026-06-18T00:00:00Z' }] };
    }
    if (/set archived_at=null/.test(text)) {
      mock.restored = true;
      return { rows: [{ ...mock.invoice, archived_at: null }] };
    }
    return { rows: [] };
  });
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      if (/update public\.invoices/.test(text) && /set status/.test(text)) {
        const updated = { ...mock.invoice, status: values[0] };
        mock.invoice = updated;
        return { rows: [updated] };
      }
      if (/invoice_status_history/.test(text)) {
        mock.history.push(values);
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    pool: { query, connect: () => Promise.resolve(client) },
    db: {
      from: () => {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
    },
  };
});
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/brevo.service', () => ({ sendInvoiceEmail: vi.fn() }));

import {
  archive,
  calculateInvoiceTotals,
  remove,
  restore,
  transition,
} from './invoices.controller';

const USER = { id: 'admin', role: 'CTO', email: 'admin@test', group_id: null };

function response() {
  return {
    body: null as any,
    json(value: any) {
      this.body = value;
      return this;
    },
  };
}

async function run(handler: any, body: any = {}) {
  const res = response();
  try {
    await handler({ user: USER, params: { id: 'inv-1' }, body } as any, res as any, vi.fn());
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
    status: 'Draft',
    due_date: '2026-07-01',
    total_amount: 100,
  };
  mock.deleted = false;
  mock.archived = false;
  mock.restored = false;
  mock.history = [];
});

describe('invoice totals', () => {
  it('uses decimal-safe line totals, discount, and tax', () => {
    const totals = calculateInvoiceTotals(
      [
        { description: 'Hours', quantity: 3, unit: 'hours', unit_rate: 19.99 },
        { description: 'Fee', quantity: 1, unit: 'service', unit_rate: 10 },
      ],
      5,
      8.25,
    );
    expect(totals.subtotal).toBe(69.97);
    expect(totals.discount_amount).toBe(5);
    expect(totals.tax_amount).toBe(5.36);
    expect(totals.total_amount).toBe(70.33);
  });

  it('rejects a discount above the subtotal', () => {
    expect(() =>
      calculateInvoiceTotals(
        [{ description: 'Fee', quantity: 1, unit: 'service', unit_rate: 10 }],
        11,
        0,
      ),
    ).toThrow(/Discount cannot exceed subtotal/);
  });
});

describe('controlled invoice workflow', () => {
  it('allows Draft → Submitted → Approved → Paid and records history', async () => {
    expect((await run(transition, { to_status: 'Submitted' })).error).toBeNull();
    expect((await run(transition, { to_status: 'Approved' })).error).toBeNull();
    expect((await run(transition, { to_status: 'Paid' })).error).toBeNull();
    expect(mock.invoice.status).toBe('Paid');
    expect(mock.history).toHaveLength(3);
  });

  it('rejects skipped and terminal transitions', async () => {
    expect((await run(transition, { to_status: 'Paid' })).error?.status).toBe(409);
    mock.invoice.status = 'Paid';
    expect((await run(transition, { to_status: 'Cancelled' })).error?.status).toBe(409);
  });

  it('allows cancellation only from Submitted or Approved', async () => {
    expect((await run(transition, { to_status: 'Cancelled' })).error?.status).toBe(409);
    mock.invoice.status = 'Submitted';
    expect((await run(transition, { to_status: 'Cancelled' })).error).toBeNull();
  });
});

describe('archive and deletion policy', () => {
  it('hard-deletes drafts only', async () => {
    expect((await run(remove)).error).toBeNull();
    expect(mock.deleted).toBe(true);
    mock.deleted = false;
    mock.invoice.status = 'Paid';
    expect((await run(remove)).error?.status).toBe(409);
    expect(mock.deleted).toBe(false);
  });

  it('archives non-drafts and restores archived invoices', async () => {
    mock.invoice.status = 'Submitted';
    expect((await run(archive)).error).toBeNull();
    expect(mock.archived).toBe(true);
    mock.invoice.archived_at = '2026-06-18T00:00:00Z';
    expect((await run(restore)).error).toBeNull();
    expect(mock.restored).toBe(true);
  });
});
