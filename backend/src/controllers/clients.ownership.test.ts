/**
 * Ownership regression test for clients mutation paths — companion to
 * vendors.ownership.test.ts. Pre-fix: PATCH/DELETE /clients/:id had no
 * ownership check, allowing cross-tenant tampering by any OPERATOR_TIER
 * user. Fix: loadAndAuthorizeClient with 404-on-miss + admin bypass.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  clientRow: null as { id: string; created_by: string | null } | null,
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
      maybeSingle: async () => ({ data: mock.clientRow, error: null }),
      single: async () => ({
        data: mock.clientRow
          ? { ...mock.clientRow, company_name: 'C' }
          : { id: 'c-1', company_name: 'C', created_by: 'u-owner' },
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: () => makeBuilder() }, pool: {} };
});

import { update, remove } from './clients.controller';

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
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler(
      { user, body: opts.body ?? {}, params: opts.params ?? {}, query: {} },
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
  mock.clientRow = { id: 'c-1', created_by: 'u-owner' };
  mock.updates.length = 0;
  mock.deletes = 0;
});

describe('clients.update — ownership', () => {
  it('owner may update', async () => {
    const { err } = await call(update, OWNER, {
      params: { id: 'c-1' },
      body: { company_name: 'New' },
    });
    expect(err).toBeNull();
    expect(mock.updates).toHaveLength(1);
  });

  it('non-owner OPERATOR gets 404 (oracle hygiene)', async () => {
    const { err } = await call(update, OTHER, {
      params: { id: 'c-1' },
      body: { company_name: 'Hijack' },
    });
    expect(err?.status).toBe(404);
    expect(mock.updates).toHaveLength(0);
  });

  it('ADMIN-tier (DIRECTOR) may update any client', async () => {
    const { err } = await call(update, ADMIN, {
      params: { id: 'c-1' },
      body: { company_name: 'Admin' },
    });
    expect(err).toBeNull();
    expect(mock.updates).toHaveLength(1);
  });
});

describe('clients.remove — ownership', () => {
  it('owner may delete', async () => {
    const { err } = await call(remove, OWNER, { params: { id: 'c-1' } });
    expect(err).toBeNull();
    expect(mock.deletes).toBe(1);
  });

  it('non-owner OPERATOR gets 404', async () => {
    const { err } = await call(remove, OTHER, { params: { id: 'c-1' } });
    expect(err?.status).toBe(404);
    expect(mock.deletes).toBe(0);
  });
});
