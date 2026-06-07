/**
 * Role-based per-company scoping for invoices (security).
 *
 *   - list: admin-tier sees ALL (no company filter); a group-scoped caller is
 *     filtered to their own group(s); a scoped caller with no group sees nothing.
 *   - get / update / remove / document / send: 404 (not 403) on an invoice
 *     outside the caller's company scope — no existence oracle.
 *   - create: a scoped caller's company is FORCED to their own group (a spoofed
 *     company_group_id is ignored); admin-tier keeps the chosen company.
 *
 * groupScope runs for real against the mocked db; brevo + audit are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  grants: [] as Array<{ group_id: string }>, // manager_group_grants rows
  invoiceRow: null as Record<string, unknown> | null, // by-id maybeSingle
  inFilter: null as { col: string; vals: unknown[] } | null,
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
}));

vi.mock('../config/db', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      in: (col: string, vals: unknown[]) => {
        if (table === 'invoices') mock.inFilter = { col, vals };
        return b;
      },
      not: () => b,
      order: () => Promise.resolve({ data: [], error: null }),
      insert: (p: Record<string, unknown>) => {
        mock.inserted = p;
        return b;
      },
      update: (p: Record<string, unknown>) => {
        mock.updated = p;
        return b;
      },
      delete: () => b,
      single: () =>
        Promise.resolve({ data: mock.inserted ?? mock.updated ?? mock.invoiceRow, error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: table === 'invoices' ? mock.invoiceRow : null, error: null }),
      // grantedGroupIds awaits `manager_group_grants` directly.
      then: (r: (v: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'manager_group_grants' ? mock.grants : [],
          error: null,
        }).then(r),
    });
    return b;
  }
  const storage = {
    from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }),
  };
  return { db: { from: (t: string) => builder(t), storage }, pool: {} };
});

vi.mock('../services/brevo.service', () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { list, get, create, update, remove } from './invoices.controller';

const CTO = { id: 'u-cto', role: 'CTO', email: 'c@x', group_id: 'gX' }; // admin-tier
const MGR = { id: 'u-mgr', role: 'MANAGER', email: 'm@x', group_id: 'g1' }; // scoped → ['g1']
const MGR_NOGROUP = { id: 'u-mgr2', role: 'MANAGER', email: 'n@x', group_id: null };
const UUID = '11111111-1111-4111-8111-111111111111'; // valid for the company schema

function mkRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}
async function run(handler: any, req: any): Promise<{ res: any; err: { status?: number } | null }> {
  const res = mkRes();
  try {
    await handler({ query: {}, params: {}, body: {}, ...req }, res, vi.fn());
    return { res, err: null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

beforeEach(() => {
  mock.grants = [];
  mock.invoiceRow = null;
  mock.inFilter = null;
  mock.inserted = null;
  mock.updated = null;
  vi.clearAllMocks();
});

describe('invoices.list — company scope', () => {
  it('admin-tier is unscoped (no company filter)', async () => {
    await run(list, { user: CTO });
    expect(mock.inFilter).toBeNull();
  });

  it('a manager is filtered to their own group', async () => {
    await run(list, { user: MGR });
    expect(mock.inFilter).toEqual({ col: 'company_group_id', vals: ['g1'] });
  });

  it('a manager also sees granted (co-managed) groups', async () => {
    mock.grants = [{ group_id: 'g2' }];
    await run(list, { user: MGR });
    expect(mock.inFilter?.vals).toEqual(expect.arrayContaining(['g1', 'g2']));
  });

  it('a scoped caller with no group sees nothing', async () => {
    const { res } = await run(list, { user: MGR_NOGROUP });
    expect(res.body).toEqual([]);
    expect(mock.inFilter).toBeNull(); // short-circuited before the query
  });
});

describe('invoices per-row scope — 404 out of scope', () => {
  it('get: a manager cannot read another company’s invoice', async () => {
    mock.invoiceRow = { id: 'inv-x', company_group_id: 'other-group' };
    const { err } = await run(get, { user: MGR, params: { id: 'inv-x' } });
    expect(err?.status).toBe(404);
  });

  it('get: a manager can read their own company’s invoice', async () => {
    mock.invoiceRow = { id: 'inv-1', company_group_id: 'g1' };
    const { res, err } = await run(get, { user: MGR, params: { id: 'inv-1' } });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ id: 'inv-1' });
  });

  it('get: a manager cannot read an UNLINKED (no company) invoice', async () => {
    mock.invoiceRow = { id: 'inv-0', company_group_id: null };
    const { err } = await run(get, { user: MGR, params: { id: 'inv-0' } });
    expect(err?.status).toBe(404);
  });

  it('admin-tier can read any company’s invoice', async () => {
    mock.invoiceRow = { id: 'inv-x', company_group_id: 'other-group' };
    const { err } = await run(get, { user: CTO, params: { id: 'inv-x' } });
    expect(err).toBeNull();
  });

  it('update + remove: 404 for an out-of-scope invoice', async () => {
    mock.invoiceRow = { id: 'inv-x', company_group_id: 'other-group' };
    const u = await run(update, { user: MGR, params: { id: 'inv-x' }, body: { status: 'Paid' } });
    expect(u.err?.status).toBe(404);
    const d = await run(remove, { user: MGR, params: { id: 'inv-x' } });
    expect(d.err?.status).toBe(404);
  });
});

describe('invoices.create — company auto-assign', () => {
  it('forces a manager’s invoice to their own group (ignores a spoofed company)', async () => {
    await run(create, {
      user: MGR,
      body: { consultant_name: 'A', vendor_name: 'B', company_group_id: UUID },
    });
    expect(mock.inserted?.company_group_id).toBe('g1');
  });

  it('lets admin-tier keep the chosen company', async () => {
    await run(create, {
      user: CTO,
      body: { consultant_name: 'A', vendor_name: 'B', company_group_id: UUID },
    });
    expect(mock.inserted?.company_group_id).toBe(UUID);
  });
});
