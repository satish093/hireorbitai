/**
 * Regression test for the users.controller lifecycle rank-check fix (audit
 * HIGH). The legacy /users/:id/deactivate, /reactivate and DELETE /users/:id
 * routes are gated only by requireAdmin (which admits DIRECTOR/CTO). They now
 * call assertCanManageTarget → assertOutranks, so a lower-tier admin can no
 * longer deactivate or delete an equal-or-higher-ranked user (the SUPER_ADMIN
 * lockout the canonical admin surface already prevents).
 */

import { describe, it, expect, vi } from 'vitest';

const mock = vi.hoisted(() => ({ targetRole: 'CONSULTANT' as string }));

vi.mock('../config/db', () => {
  function builder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      delete: () => b,
      maybeSingle: () =>
        Promise.resolve({ data: { role: mock.targetRole, is_active: true }, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    return b;
  }
  return {
    db: {
      from: () => builder(),
      auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) } },
    },
    // assertNotLastSuperAdmin (shared from adminUsers.controller) locks the
    // target row via pool.query(... FOR UPDATE). Return the target row; for a
    // non-SUPER_ADMIN target the guard returns early (no peer-count query).
    pool: {
      query: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ rows: [{ role: mock.targetRole, is_active: true }] }),
        ),
    },
  };
});
vi.mock('../services/auth.service', () => ({
  setUserStatus: vi.fn().mockResolvedValue({ id: 'target', status: 'inactive' }),
  // adminUsers.controller (imported transitively) also pulls requestPasswordReset.
  requestPasswordReset: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { deactivate, reactivate, remove } from './users.controller';

const DIRECTOR = { id: 'u-director', role: 'DIRECTOR', email: 'dir@x.test' };

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

async function call(handler: any, targetId: string): Promise<{ res: any; status?: number }> {
  const res = mkRes();
  try {
    await handler({ params: { id: targetId }, body: {}, user: DIRECTOR }, res, vi.fn());
    return { res };
  } catch (e) {
    return { res, status: (e as { status?: number }).status };
  }
}

describe('users lifecycle — outranks guard', () => {
  it('blocks a DIRECTOR from deactivating a SUPER_ADMIN (403)', async () => {
    mock.targetRole = 'SUPER_ADMIN';
    const { status } = await call(deactivate, 'u-super');
    expect(status).toBe(403);
  });

  it('blocks a DIRECTOR from reactivating a CEO (403)', async () => {
    mock.targetRole = 'CEO';
    const { status } = await call(reactivate, 'u-ceo');
    expect(status).toBe(403);
  });

  it('blocks a DIRECTOR from hard-deleting a CTO (403)', async () => {
    mock.targetRole = 'CTO';
    const { status } = await call(remove, 'u-cto');
    expect(status).toBe(403);
  });

  it('still allows a DIRECTOR to deactivate a lower-tier RECRUITER', async () => {
    mock.targetRole = 'RECRUITER';
    const { res, status } = await call(deactivate, 'u-recruiter');
    expect(status).toBeUndefined();
    expect(res.body?.ok).toBe(true);
  });
});
