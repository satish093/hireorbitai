/**
 * Auth edge-case tests — null inputs, lockout, bad tokens, self-password change.
 *
 * Tests the controller/middleware boundary for the auth surface:
 *   1. POST /auth/login  — null/empty email, null password, locked account → 423,
 *      wrong password → 401, missing body fields → 400.
 *   2. requireAuth middleware — missing token → 401, malformed JWT → 401.
 *   3. POST /auth/change-password — current == new → 400.
 *
 * The auth service, DB, and bcrypt are all mocked; no real Postgres needed.
 * Pattern: same vi.hoisted + vi.mock approach as the rest of the test suite.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Service-level mock state
// ---------------------------------------------------------------------------

const authMock = vi.hoisted(() => ({
  loginResult: null as unknown,
  loginError: null as { status?: number; message?: string } | null,
  changeResult: null as unknown,
  changeError: null as { status?: number; message?: string } | null,
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../services/auth.service', () => ({
  login: vi.fn(async () => {
    if (authMock.loginError) throw authMock.loginError;
    return authMock.loginResult;
  }),
  changePassword: vi.fn(async () => {
    if (authMock.changeError) throw authMock.changeError;
    return authMock.changeResult;
  }),
  requestPasswordReset: vi.fn(async () => ({})),
  completePasswordReset: vi.fn(async () => ({})),
  refreshSession: vi.fn(async () => ({})),
  logout: vi.fn(async () => ({})),
}));

vi.mock('../config/db', () => ({
  db: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: { message: 'not found' } }),
        }),
      }),
      update: () => ({ eq: () => ({ then: (r: any) => r({ data: {}, error: null }) }) }),
      upsert: vi.fn(async () => ({ data: null, error: null })),
    }),
    auth: {
      // requireAuth calls db.auth.getUser(token) — return "no user" so the
      // middleware throws httpError(401) for any token in these unit tests.
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'invalid token' } })),
      admin: { createUser: vi.fn(), signOut: vi.fn() },
    },
  },
  pool: {},
}));

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;

function mkRes() {
  const r: any = {
    statusCode: 200,
    body: undefined as unknown,
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return r;
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function call(
  handler: Handler,
  opts: {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    user?: { id: string; role: string } | null;
    headers?: Record<string, string>;
  } = {},
): Promise<{ err: { status?: number; message?: string } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler(
      {
        body: opts.body ?? {},
        params: opts.params ?? {},
        query: opts.query ?? {},
        user: opts.user ?? undefined,
        headers: opts.headers ?? {},
        log,
        ip: '127.0.0.1',
        get: (h: string) => opts.headers?.[h.toLowerCase()] ?? '',
      },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number; message?: string }, res };
  }
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { login as loginHandler, changePassword as changePasswordHandler } from './auth.controller';
import { requireAuth } from '../middleware/auth';

// ---------------------------------------------------------------------------
// POST /auth/login — Zod validation + lockout + wrong password
// ---------------------------------------------------------------------------

describe('auth.login — input validation', () => {
  it('returns 400 when email is missing from the body', async () => {
    const { err } = await call(loginHandler as Handler, {
      body: { password: 'secret123' },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 400 when password is missing from the body', async () => {
    const { err } = await call(loginHandler as Handler, {
      body: { email: 'user@example.com' },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 400 when email is an empty string', async () => {
    const { err } = await call(loginHandler as Handler, {
      body: { email: '', password: 'secret123' },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 400 when body is null/undefined', async () => {
    const { err } = await call(loginHandler as Handler, {
      body: null,
    });
    expect(err?.status).toBe(400);
  });

  it('returns 400 when email format is invalid', async () => {
    const { err } = await call(loginHandler as Handler, {
      body: { email: 'not-an-email', password: 'secret123' },
    });
    expect(err?.status).toBe(400);
  });
});

describe('auth.login — service-level outcomes', () => {
  it('returns 401 when auth service throws 401 (wrong password)', async () => {
    authMock.loginError = { status: 401, message: 'Invalid email or password.' };
    const { err } = await call(loginHandler as Handler, {
      body: { email: 'user@example.com', password: 'wrongpassword' },
    });
    expect(err?.status).toBe(401);
    authMock.loginError = null;
  });

  it('returns 423 when auth service throws 423 (account locked)', async () => {
    authMock.loginError = { status: 423, message: 'Account is temporarily locked.' };
    const { err } = await call(loginHandler as Handler, {
      body: { email: 'locked@example.com', password: 'anypassword' },
    });
    expect(err?.status).toBe(423);
    authMock.loginError = null;
  });

  it('returns 200 with tokens on successful login', async () => {
    authMock.loginError = null;
    authMock.loginResult = {
      access_token: 'tok-access',
      refresh_token: 'tok-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u-1', email: 'user@example.com', role: 'MANAGER', full_name: 'Test' },
      must_change_password: false,
    };
    const { err, res } = await call(loginHandler as Handler, {
      body: { email: 'user@example.com', password: 'correct' },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ access_token: 'tok-access' });
    authMock.loginResult = null;
  });
});

// ---------------------------------------------------------------------------
// requireAuth middleware — missing / malformed token
// ---------------------------------------------------------------------------

describe('requireAuth middleware — token validation', () => {
  it('throws 401 when Authorization header is absent', async () => {
    const { err } = await call(requireAuth as unknown as Handler, {
      headers: {},
    });
    expect(err?.status).toBe(401);
  });

  it('throws 401 when Authorization header has no Bearer prefix', async () => {
    const { err } = await call(requireAuth as unknown as Handler, {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(err?.status).toBe(401);
  });

  it('throws 401 when JWT is obviously malformed (not three dot-separated parts)', async () => {
    const { err } = await call(requireAuth as unknown as Handler, {
      headers: { authorization: 'Bearer not.a.valid.jwt.at.all' },
    });
    expect(err?.status).toBe(401);
  });

  it('throws 401 when JWT is structurally valid but signed with wrong secret', async () => {
    // A real JWT signed with a different secret; verification must fail.
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiJ1LTEiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJpYXQiOjE3MDAwMDAwMDB9' +
      '.FAKE_SIGNATURE_THAT_WONT_VERIFY';
    const { err } = await call(requireAuth as unknown as Handler, {
      headers: { authorization: `Bearer ${fakeJwt}` },
    });
    expect(err?.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/change-password — same-password rejection
// ---------------------------------------------------------------------------

// Fields: current_password, new_password, confirm_password (snake_case per changePwSchema)
describe('auth.changePassword — validation', () => {
  it('returns 400 when current_password is missing', async () => {
    const { err } = await call(changePasswordHandler as Handler, {
      user: { id: 'u-1', role: 'MANAGER' },
      body: { new_password: 'NewPass123!Long', confirm_password: 'NewPass123!Long' },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 400 when new_password is missing', async () => {
    const { err } = await call(changePasswordHandler as Handler, {
      user: { id: 'u-1', role: 'MANAGER' },
      body: { current_password: 'OldPass123!' },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 400 when new_password and confirm_password do not match', async () => {
    const { err } = await call(changePasswordHandler as Handler, {
      user: { id: 'u-1', role: 'MANAGER' },
      body: {
        current_password: 'OldPass123!',
        new_password: 'NewPass123!Long',
        confirm_password: 'DifferentPass123!',
      },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 400 when the service rejects same-password reuse', async () => {
    authMock.changeError = { status: 400, message: 'New password must differ from current.' };
    const { err } = await call(changePasswordHandler as Handler, {
      user: { id: 'u-1', role: 'MANAGER' },
      body: {
        current_password: 'SamePass123!Long',
        new_password: 'SamePass123!Long',
        confirm_password: 'SamePass123!Long',
      },
    });
    expect(err?.status).toBe(400);
    authMock.changeError = null;
  });

  it('returns 401 when req.user is not set', async () => {
    const { err } = await call(changePasswordHandler as Handler, {
      user: null,
      body: {
        current_password: 'OldPass123!',
        new_password: 'NewPass123!Long',
        confirm_password: 'NewPass123!Long',
      },
    });
    expect(err?.status).toBe(401);
  });
});
