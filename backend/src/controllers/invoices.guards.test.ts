import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/db', () => ({ db: {}, pool: {} }));

import { createSchema, updateSchema, INVOICE_STATUSES } from './invoices.controller';

const valid = {
  company_group_id: '11111111-1111-4111-8111-111111111111',
  invoice_number: 'INV-1997',
  invoice_date: '2026-05-27',
  due_date: '2026-06-26',
  net_terms_days: 30,
  currency: 'USD',
  discount_amount: 100,
  tax_percent: 8.25,
  bill_to_snapshot: { name: 'Q1 Technologies', email: 'accounts@q1.test' },
  line_items: [
    {
      description: 'Consulting services',
      service_period: '2026-05',
      quantity: 180,
      unit: 'hours',
      unit_rate: 82,
    },
  ],
};

describe('invoice accounting input validation', () => {
  it('accepts structured party snapshots and line items', () => {
    expect(createSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects client-owned status and calculated totals', () => {
    expect(createSchema.safeParse({ ...valid, status: 'Paid' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, total_amount: 1 }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, subtotal: 1 }).success).toBe(false);
  });

  it('rejects invalid dates, currencies, quantities, rates, tax, and discounts', () => {
    expect(createSchema.safeParse({ ...valid, due_date: '2026-01-01' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, invoice_date: '2026-02-31' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, currency: 'US' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, currency: 'ZZZ' }).success).toBe(false);
    expect(
      createSchema.safeParse({
        ...valid,
        line_items: [{ ...valid.line_items[0], quantity: 0 }],
      }).success,
    ).toBe(false);
    expect(
      createSchema.safeParse({
        ...valid,
        line_items: [{ ...valid.line_items[0], unit_rate: -1 }],
      }).success,
    ).toBe(false);
    expect(createSchema.safeParse({ ...valid, tax_percent: 101 }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, discount_amount: -1 }).success).toBe(false);
  });

  it('requires a company, invoice number, bill-to party, and at least one item', () => {
    expect(createSchema.safeParse({ ...valid, company_group_id: '' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, invoice_number: '' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, bill_to_snapshot: { name: '' } }).success).toBe(
      false,
    );
    expect(createSchema.safeParse({ ...valid, line_items: [] }).success).toBe(false);
  });

  it('allows omitting invoice_number (auto-generated server-side)', () => {
    const noNumber = { ...valid } as Record<string, unknown>;
    delete noNumber.invoice_number;
    expect(createSchema.safeParse(noNumber).success).toBe(true);
  });

  it('accepts optional name + description fields', () => {
    expect(
      createSchema.safeParse({ ...valid, name: 'March retainer', description: 'Monthly work' })
        .success,
    ).toBe(true);
  });

  it('keeps lifecycle statuses server-owned', () => {
    expect(INVOICE_STATUSES).toEqual([
      'Draft',
      'Submitted',
      'Approved',
      'Partially Paid',
      'Paid',
      'Cancelled',
    ]);
  });

  it('allows partial updates but still rejects unknown fields', () => {
    expect(updateSchema.safeParse({ notes: 'Updated' }).success).toBe(true);
    expect(updateSchema.safeParse({ id: 'forged' }).success).toBe(false);
  });
});
