import { beforeEach, describe, expect, it, vi } from 'vitest';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const mock = vi.hoisted(() => ({
  grants: [] as Array<{ group_id: string }>,
  invoice: null as any,
  sql: [] as Array<{ text: string; values: unknown[] }>,
  insertedCompany: null as string | null,
}));

vi.mock('../config/db', () => {
  const db = {
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'user_groups' ? { id: G1, name: 'CloudFen', email: null } : null,
            error: null,
          }),
        then: (resolve: any) =>
          Promise.resolve({
            data: table === 'manager_group_grants' ? mock.grants : [],
            error: null,
          }).then(resolve),
      };
      return builder;
    },
  };
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    mock.sql.push({ text, values });
    if (/select \* from public\.invoices where id/.test(text)) {
      return { rows: mock.invoice ? [mock.invoice] : [] };
    }
    if (/invoice_line_items/.test(text)) return { rows: [] };
    if (/select \*,/.test(text)) return { rows: [] };
    if (/count\(\*\)::int as total/.test(text)) return { rows: [{ total: 0 }] };
    if (/overdue_count/.test(text)) return { rows: [{ overdue_count: 0, draft_count: 0 }] };
    if (/group by currency/.test(text)) return { rows: [] };
    if (/delete from public\.invoices/.test(text)) return { rows: [] };
    return { rows: [] };
  });
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      if (/insert into public\.invoices/.test(text)) {
        mock.insertedCompany = values[0] as string;
        return {
          rows: [
            {
              id: 'inv-new',
              company_group_id: values[0],
              invoice_number: values[1],
              status: 'Draft',
            },
          ],
        };
      }
      if (/invoice_line_items/.test(text)) return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { db, pool: { query, connect: () => Promise.resolve(client) } };
});
vi.mock('../services/brevo.service', () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { create, get, list } from './invoices.controller';

const ADMIN = { id: 'admin', role: 'CTO', email: 'a@test', group_id: null };
const MANAGER = { id: 'manager', role: 'MANAGER', email: 'm@test', group_id: G1 };
const NO_GROUP = { id: 'manager-2', role: 'MANAGER', email: 'n@test', group_id: null };
const payload = {
  company_group_id: G1,
  invoice_number: 'INV-1',
  currency: 'USD',
  discount_amount: 0,
  tax_percent: 0,
  bill_to_snapshot: { name: 'Q1' },
  line_items: [{ description: 'Services', quantity: 1, unit: 'service', unit_rate: 100 }],
};

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

async function run(handler: any, req: any) {
  const res = response();
  try {
    await handler({ query: {}, params: {}, body: {}, ...req }, res, vi.fn());
    return { res, error: null as any };
  } catch (error) {
    return { res, error: error as { status?: number } };
  }
}

beforeEach(() => {
  mock.grants = [];
  mock.invoice = null;
  mock.sql = [];
  mock.insertedCompany = null;
});

describe('invoice company scope', () => {
  it('filters manager lists to home and co-managed companies', async () => {
    mock.grants = [{ group_id: G2 }];
    await run(list, { user: MANAGER });
    const listQuery = mock.sql.find((entry) => /select \*,/.test(entry.text));
    expect(listQuery?.text).toContain('company_group_id = any');
    expect(listQuery?.values[0]).toEqual([G1, G2]);
  });

  it('leaves admin-tier lists unscoped', async () => {
    await run(list, { user: ADMIN });
    const listQuery = mock.sql.find((entry) => /select \*,/.test(entry.text));
    expect(listQuery?.text).not.toContain('company_group_id = any');
  });

  it('returns an empty paginated response for a scoped user with no company', async () => {
    const { res } = await run(list, { user: NO_GROUP });
    expect(res.body).toMatchObject({ items: [], total: 0, page: 1, page_size: 25 });
  });

  it('conceals cross-company and unlinked invoices with 404', async () => {
    mock.invoice = { id: 'inv-x', company_group_id: G2, status: 'Draft' };
    expect((await run(get, { user: MANAGER, params: { id: 'inv-x' } })).error?.status).toBe(404);
    mock.invoice = { id: 'inv-x', company_group_id: null, status: 'Draft' };
    expect((await run(get, { user: MANAGER, params: { id: 'inv-x' } })).error?.status).toBe(404);
  });

  it('allows a manager to create in a co-managed company and rejects no-company users', async () => {
    mock.grants = [{ group_id: G2 }];
    const allowed = await run(create, {
      user: MANAGER,
      body: { ...payload, company_group_id: G2 },
    });
    expect(allowed.error).toBeNull();
    expect(mock.insertedCompany).toBe(G2);
    const denied = await run(create, { user: NO_GROUP, body: payload });
    expect(denied.error?.status).toBe(403);
  });
});
