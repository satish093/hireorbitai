/**
 * Dev-auth (role/user switching) behaviour + production-safety.
 *
 * The route-level guard (requireDevTools → 404 when off) is covered in
 * middleware/devtools.guard.test.ts; here we cover the handlers themselves:
 * listUsers returns active seeded users, and login mints a real session via the
 * impersonation primitive (db.auth.admin.createSessionForUser) for a valid
 * seeded user, 404s for unknown users, and 400s on a bad body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = vi.hoisted(() => ({
  users: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'a@x.local',
      full_name: 'Ann Admin',
      role: 'SUPER_ADMIN',
      status: 'active',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'c@x.local',
      full_name: 'Cy Consultant',
      role: 'CONSULTANT',
      status: 'active',
    },
  ] as any[],
  target: undefined as any,
  sessionResult: {
    data: {
      session: {
        access_token: 'acc',
        refresh_token: 'ref',
        expires_at: 9999999999,
      },
    },
    error: null,
  } as any,
}));

vi.mock('../config/db', () => {
  function builder(_table: string) {
    const b: any = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve({ data: mock.target, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.users, error: null }).then(resolve),
    });
    return b;
  }
  return {
    db: {
      from: (t: string) => builder(t),
      auth: { admin: { createSessionForUser: vi.fn(async () => mock.sessionResult) } },
    },
    pool: {},
  };
});
vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { listUsers, login } from './devAuth.controller';

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
  req: any,
): Promise<{ res: any; err: { status?: number } | null }> {
  const res = mkRes();
  try {
    await handler({ body: {}, params: {}, ...req }, res, vi.fn());
    return { res, err: null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

beforeEach(() => {
  mock.target = undefined;
});

describe('devAuth.listUsers', () => {
  it('returns active seeded users sorted by tier (SUPER_ADMIN first)', async () => {
    const { err, res } = await call(listUsers, {});
    expect(err).toBeNull();
    expect(res.body[0].role).toBe('SUPER_ADMIN');
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).not.toHaveProperty('status');
  });
});

describe('devAuth.login', () => {
  it('mints a real session for a valid seeded user', async () => {
    mock.target = mock.users[0];
    const { err, res } = await call(login, {
      body: { userId: '11111111-1111-1111-1111-111111111111' },
    });
    expect(err).toBeNull();
    expect(res.body.access_token).toBe('acc');
    expect(res.body.user.role).toBe('SUPER_ADMIN');
  });

  it('404s for an unknown user', async () => {
    mock.target = null;
    const { err } = await call(login, {
      body: { userId: '33333333-3333-3333-3333-333333333333' },
    });
    expect(err?.status).toBe(404);
  });

  it('400s on a missing/invalid userId', async () => {
    const { err } = await call(login, { body: {} });
    expect(err?.status).toBe(400);
  });
});
