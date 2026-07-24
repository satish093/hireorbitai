/**
 * Tests for cross-group co-management grants (manager_group_grants) on the
 * managers controller.
 *
 * Pins:
 *   - addGrant: admin + MANAGER target + valid group → 201, busts perm cache,
 *     audits; non-admin caller → 403; CONSULTANT/RECRUITER target → 400; missing
 *     user → 404; missing group → 404; granting the manager's OWN group → 400;
 *     inactive manager → 400.
 *   - removeGrant: admin → 200 (cache bust + audit); non-admin → 403.
 *   - listGrants: returns rows; non-lead target → 400.
 *
 * DB, permission cache, and audit are mocked so the controller imports without env.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  return { rows };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      in: () => b,
      upsert: () => b,
      delete: () => b,
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: mock.rows[table] ?? [], error: null }).then(resolve, reject),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const invalidatePermissionCache = vi.fn();
vi.mock('../services/permission.service', () => ({
  invalidatePermissionCache: (id: string) => invalidatePermissionCache(id),
}));
const audit = vi.fn();
vi.mock('../services/audit.service', () => ({ audit: (a: unknown) => audit(a) }));

import * as managers from './managers.controller';

type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;

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
  handler: Handler,
  user: { id: string; role: string; email?: string; group_id?: string | null } | undefined,
  opts: { body?: unknown; params?: Record<string, string> } = {},
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler({ user, body: opts.body ?? {}, params: opts.params ?? {} }, res, vi.fn());
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

const DIRECTOR = { id: 'u-dir', role: 'DIRECTOR', email: 'dir@x.io' };
const MGR_ID = '00000000-0000-4000-8000-000000000010';
const G1 = '00000000-0000-4000-8000-0000000000a1'; // manager's home group
const G2 = '00000000-0000-4000-8000-0000000000a2'; // group being granted

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  invalidatePermissionCache.mockClear();
  audit.mockClear();
});

describe('managers.addGrant', () => {
  it('grants a MANAGER co-management of another group (201, cache bust + audit)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'MANAGER', group_id: G1, is_active: true }];
    mock.rows.user_groups = [{ id: G2 }];
    mock.rows.manager_group_grants = [{ id: 'gr-1', group_id: G2, created_at: 'now' }];
    const { err, res } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: G2 },
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 'gr-1', group_id: G2 });
    expect(invalidatePermissionCache).toHaveBeenCalledWith(MGR_ID);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'manager_group_grant_added' }),
    );
  });

  it('grants an HR_MANAGER co-management (201)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'HR_MANAGER', group_id: G1, is_active: true }];
    mock.rows.user_groups = [{ id: G2 }];
    mock.rows.manager_group_grants = [{ id: 'gr-2', group_id: G2, created_at: 'now' }];
    const { err, res } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: G2 },
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
  });

  it('refuses a non-admin caller (403)', async () => {
    const { err } = await call(
      managers.addGrant as Handler,
      { id: 'u-mgr', role: 'MANAGER', email: 'm@x.io', group_id: G1 },
      { params: { id: MGR_ID }, body: { group_id: G2 } },
    );
    expect(err?.status).toBe(403);
  });

  it('refuses granting to a CONSULTANT (400)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'CONSULTANT', group_id: G1, is_active: true }];
    const { err } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: G2 },
    });
    expect(err?.status).toBe(400);
  });

  it('refuses granting to a RECRUITER (400)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'RECRUITER', group_id: G1, is_active: true }];
    const { err } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: G2 },
    });
    expect(err?.status).toBe(400);
  });

  it('404 when the target user does not exist', async () => {
    mock.rows.users = [];
    const { err } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: G2 },
    });
    expect(err?.status).toBe(404);
  });

  it('404 when the group does not exist', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'MANAGER', group_id: G1, is_active: true }];
    mock.rows.user_groups = [];
    const { err } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: G2 },
    });
    expect(err?.status).toBe(404);
  });

  it('refuses granting the manager’s OWN home group (400)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'MANAGER', group_id: G1, is_active: true }];
    mock.rows.user_groups = [{ id: G1 }];
    const { err } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: G1 },
    });
    expect(err?.status).toBe(400);
  });

  it('refuses an inactive manager (400)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'MANAGER', group_id: G1, is_active: false }];
    const { err } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: G2 },
    });
    expect(err?.status).toBe(400);
  });

  it('rejects an invalid (non-uuid) group_id (400)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'MANAGER', group_id: G1, is_active: true }];
    const { err } = await call(managers.addGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID },
      body: { group_id: 'not-a-uuid' },
    });
    expect(err?.status).toBe(400);
  });
});

describe('managers.removeGrant', () => {
  it('revokes a grant (200, cache bust + audit)', async () => {
    const { err, res } = await call(managers.removeGrant as Handler, DIRECTOR, {
      params: { id: MGR_ID, groupId: G2 },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ ok: true });
    expect(invalidatePermissionCache).toHaveBeenCalledWith(MGR_ID);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'manager_group_grant_removed' }),
    );
  });

  it('refuses a non-admin caller (403)', async () => {
    const { err } = await call(
      managers.removeGrant as Handler,
      { id: 'u-mgr', role: 'MANAGER', email: 'm@x.io', group_id: G1 },
      { params: { id: MGR_ID, groupId: G2 } },
    );
    expect(err?.status).toBe(403);
  });
});

describe('managers.listGrants', () => {
  it('lists the groups a lead co-manages', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'MANAGER', group_id: G1, is_active: true }];
    mock.rows.manager_group_grants = [{ id: 'gr-1', group_id: G2, created_at: 'now' }];
    const { err, res } = await call(managers.listGrants as Handler, DIRECTOR, {
      params: { id: MGR_ID },
    });
    expect(err).toBeNull();
    expect(res.body).toEqual([{ id: 'gr-1', group_id: G2, created_at: 'now' }]);
  });

  it('400 when the target is not a lead', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'CONSULTANT', group_id: G1, is_active: true }];
    const { err } = await call(managers.listGrants as Handler, DIRECTOR, {
      params: { id: MGR_ID },
    });
    expect(err?.status).toBe(400);
  });
});
