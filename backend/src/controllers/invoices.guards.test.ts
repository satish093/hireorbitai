/**
 * Mass-assignment + validation guards for the invoices controller.
 *
 * The invoice write path spreads `parsed.data` (never `req.body`) into the DB
 * call, so the only thing standing between a caller and a privileged column is
 * the `.strict()` Zod allowlist. These tests pin that contract: unknown and
 * server-owned keys are rejected, the status enum is enforced, and a faithful
 * row from the source spreadsheet validates.
 *
 * db is mocked at module load (the canonical backend test setup) so importing
 * the controller never opens a real pg connection.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/db', () => ({ db: {}, pool: {} }));

import { createSchema, updateSchema, INVOICE_STATUSES } from './invoices.controller';

const valid = {
  consultant_name: 'Sripad Appampally',
  vendor_name: '2 tek LLC',
  invoice_number: '2479',
  invoice_date: '2026-05-27',
  due_date: '2026-06-26',
  net_terms_days: 30,
  status: 'Submitted' as const,
};

describe('invoices createSchema (.strict mass-assignment guard)', () => {
  it('accepts a faithful row from the source sheet', () => {
    expect(createSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects unknown / server-owned keys (created_by, id, updated_at)', () => {
    expect(createSchema.safeParse({ ...valid, created_by: 'attacker-id' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, id: 'forged' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, updated_at: 'now' }).success).toBe(false);
  });

  it('requires consultant_name and vendor_name', () => {
    expect(createSchema.safeParse({ ...valid, consultant_name: '' }).success).toBe(false);
    // Missing vendor_name entirely → required field fails.
    expect(createSchema.safeParse({ consultant_name: 'Only consultant' }).success).toBe(false);
  });

  it('rejects a status outside the allowed set', () => {
    expect(createSchema.safeParse({ ...valid, status: 'Pending' }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, status: 'paid' }).success).toBe(false);
  });

  it('accepts every allowed status', () => {
    for (const status of INVOICE_STATUSES) {
      expect(createSchema.safeParse({ ...valid, status }).success).toBe(true);
    }
  });

  it('allows optional fields to be omitted (only consultant + vendor required)', () => {
    expect(createSchema.safeParse({ consultant_name: 'A', vendor_name: 'B' }).success).toBe(true);
  });

  it('accepts the finance fields (pay_rate, invoice_amount, billing_month)', () => {
    const r = createSchema.safeParse({
      ...valid,
      pay_rate: 65,
      invoice_amount: 10400.5,
      billing_month: '2026-05',
    });
    expect(r.success).toBe(true);
    // numeric strings coerce to numbers (the form sends string inputs).
    const s = createSchema.safeParse({ ...valid, pay_rate: '65', invoice_amount: '10400.50' });
    expect(s.success).toBe(true);
    if (s.success) {
      expect(s.data.pay_rate).toBe(65);
      expect(s.data.invoice_amount).toBe(10400.5);
    }
  });

  it('rejects negative money and accepts null for empty money fields', () => {
    expect(createSchema.safeParse({ ...valid, pay_rate: -1 }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, invoice_amount: -0.01 }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, pay_rate: null, invoice_amount: null }).success).toBe(
      true,
    );
  });
});

describe('invoices updateSchema (partial + .strict)', () => {
  it('accepts a partial update', () => {
    expect(updateSchema.safeParse({ status: 'Paid' }).success).toBe(true);
    expect(updateSchema.safeParse({}).success).toBe(true);
  });

  it('still rejects unknown / server-owned keys on update', () => {
    expect(updateSchema.safeParse({ created_by: 'x' }).success).toBe(false);
    expect(updateSchema.safeParse({ updated_at: 'x' }).success).toBe(false);
    expect(updateSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});
