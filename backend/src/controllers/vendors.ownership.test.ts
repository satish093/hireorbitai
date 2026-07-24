/**
 * Ownership regression test for vendors mutation paths.
 *
 * Pre-fix: PATCH/DELETE /vendors/:id keyed only on `id` — no row load, no
 * ownership check. A group-A operator could mutate/delete any group-B
 * vendor by guessing the id. Multi-tenant data tampering, untraceable.
 *
 * Fix: loadAndAuthorizeVendor() loads the row, returns 404 (not 403) if
 * !isAdminTier(caller) && row.created_by !== caller.id — mirrors the
 * canonical applications.controller.ts loadAndAuthorize.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  vendorRow: null as { id: string; created_by: string | null } | null,
  updates: [] as Array<Record<string, unknown>>,
  deletes: 0,
}));

vi.mock('../config/db', () => {
  function makeBuilder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      ilike: () => b,
      order: () => b,
      update(payload: Record<string, unknown>) {
        mock.updates.push(payload);
        return b;
      },
      delete: () => {
        mock.deletes++;
        return b;
      },
      maybeSingle: async () => ({ data: mock.vendorRow, error: null }),
      single: async () => ({
        data: mock.vendorRow
          ? { ...mock.vendorRow, company_name: 'V' }
          : { id: 'v-1', company_name: 'V', created_by: 'u-owner' },
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: () => makeBuilder() }, pool: {} };
});

import { update, remove } from './vendors.controller';

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

async function call(
  handler: any,
  user: { id: string; role: string } | undefined,
  opts: { params?: Record<string, string>; body?: unknown } = {},
): Promise<{ err: { status?: number; message?: string } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler(
      { user, body: opts.body ?? {}, params: opts.params ?? {}, query: {}, log: console },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

const OWNER = { id: 'u-owner', role: 'RECRUITER' };
const OTHER = { id: 'u-other', role: 'RECRUITER' };
const ADMIN = { id: 'u-admin', role: 'DIRECTOR' };

beforeEach(() => {
  mock.vendorRow = { id: 'v-1', created_by: 'u-owner' };
  mock.updates.length = 0;
  mock.deletes = 0;
});

describe('vendors.update — ownership', () => {
  it('owner may update their own vendor', async () => {
    const { err } = await call(update, OWNER, {
      params: { id: 'v-1' },
      body: { company_name: 'New' },
    });
    expect(err).toBeNull();
    expect(mock.updates).toHaveLength(1);
  });

  it('returns 404 when a non-owner OPERATOR tries to update (oracle hygiene)', async () => {
    const { err } = await call(update, OTHER, {
      params: { id: 'v-1' },
      body: { company_name: 'Hijack' },
    });
    expect(err?.status).toBe(404);
    expect(mock.updates).toHaveLength(0);
  });

  it('ADMIN-tier (DIRECTOR) may update any vendor', async () => {
    const { err } = await call(update, ADMIN, {
      params: { id: 'v-1' },
      body: { company_name: 'Admin edit' },
    });
    expect(err).toBeNull();
    expect(mock.updates).toHaveLength(1);
  });

  it('returns 404 when the vendor row does not exist (true 404 path)', async () => {
    mock.vendorRow = null;
    const { err } = await call(update, ADMIN, {
      params: { id: 'v-missing' },
      body: { company_name: 'X' },
    });
    expect(err?.status).toBe(404);
  });
});

describe('vendors.remove — ownership', () => {
  it('owner may delete their own vendor', async () => {
    const { err } = await call(remove, OWNER, { params: { id: 'v-1' } });
    expect(err).toBeNull();
    expect(mock.deletes).toBe(1);
  });

  it('returns 404 when a non-owner OPERATOR tries to delete', async () => {
    const { err } = await call(remove, OTHER, { params: { id: 'v-1' } });
    expect(err?.status).toBe(404);
    expect(mock.deletes).toBe(0);
  });
});
