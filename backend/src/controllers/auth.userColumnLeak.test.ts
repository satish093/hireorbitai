/**
 * Regression test: /auth/me, /auth/sync, and /admin/users/:id must never
 * return password_hash, session_version, or any auth-internal column.
 *
 * Strategy: stub the DB so that when ANY of the handlers under test calls
 * db.from('users').select(...), the mock records the column list it was
 * given and returns a fixture row that includes forbidden columns. We then
 * assert (a) the recorded column string contains no forbidden token, and
 * (b) the JSON the handler emitted contains no forbidden key. Both checks
 * matter — a future regression could either widen the select OR re-spread
 * a forbidden field into the response shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const FORBIDDEN = [
  'password_hash',
  'session_version',
  'reset_token_hash',
  'reset_token_expires_at',
  'refresh_token',
  'refresh_hash',
  'failed_login_attempts',
  'locked_until',
  'lockout_count',
];

// Row the mocked DB returns for every users.select(...) — deliberately
// includes every forbidden column so we'd notice if the handler ever started
// passing them through.
const LEAKY_USER_ROW = {
  id: 'u-1',
  email: 'me@example.test',
  full_name: 'Test User',
  phone: null,
  role: 'CONSULTANT',
  avatar_url: null,
  is_active: true,
  must_change_password: false,
  group_id: null,
  capabilities: [],
  tour_completed_at: null,
  job_alerts: true,
  last_login_at: null,
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  status: 'ACTIVE',
  status_reason: null,
  status_changed_at: null,
  status_changed_by: null,
  reports_to: null,
  notes: null,
  // Forbidden secrets — must never reach the wire.
  password_hash: '$2b$10$VERY_SECRET_HASH_VALUE',
  session_version: 7,
  reset_token_hash: 'SECRET_RESET_HASH',
  reset_token_expires_at: '2026-01-01',
  failed_login_attempts: 3,
  locked_until: null,
};

const mock = vi.hoisted(() => {
  const lastSelect: { table: string; cols: string }[] = [];
  return { lastSelect };
});

/**
 * Project the leaky row down to ONLY the columns asked for — mirrors what
 * Postgres does in production. Empty/star pass through the whole row.
 */
function project(cols: string, row: Record<string, unknown>) {
  if (!cols || cols.trim() === '*') return row;
  const keep = new Set(cols.split(',').map((c) => c.trim()));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) if (keep.has(k)) out[k] = row[k];
  return out;
}

vi.mock('../config/db', () => {
  function builder(table: string) {
    let cols = '';
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: (c?: string) => {
        cols = c ?? '*';
        mock.lastSelect.push({ table, cols });
        return b;
      },
      upsert: () => b,
      eq: () => b,
      in: () => b,
      neq: () => b,
      maybeSingle: () => Promise.resolve({ data: project(cols, LEAKY_USER_ROW), error: null }),
      single: () => Promise.resolve({ data: project(cols, LEAKY_USER_ROW), error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: [project(cols, LEAKY_USER_ROW)],
          error: null,
          count: 1,
        }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});
vi.mock('../config/env', () => ({ env: {} }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/auth.service', () => ({ requestPasswordReset: vi.fn() }));

import { me, syncProfile } from './auth.controller';
import { get as adminGet } from './adminUsers.controller';

function mkRes() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b: unknown) => {
    r.body = b;
    return r;
  };
  return r;
}

async function call(handler: any, req: any) {
  const res = mkRes();
  await handler(req, res, vi.fn());
  return res.body;
}

beforeEach(() => {
  mock.lastSelect.length = 0;
});

function expectNoLeaks(payload: unknown, label: string) {
  const json = JSON.stringify(payload);
  for (const key of FORBIDDEN) {
    expect(json, `${label} response leaked ${key}`).not.toMatch(new RegExp(`"${key}"`));
  }
}

function expectSafeSelect(label: string) {
  const sels = mock.lastSelect.filter((s) => s.table === 'users');
  expect(sels.length, `${label} must select from users`).toBeGreaterThan(0);
  for (const s of sels) {
    expect(s.cols, `${label} used select('*')`).not.toBe('*');
    for (const key of FORBIDDEN) {
      expect(s.cols, `${label} select includes forbidden column "${key}"`).not.toMatch(
        new RegExp(`\\b${key}\\b`),
      );
    }
  }
}

const REQ_USER = { id: 'u-1', email: 'me@example.test', role: 'CONSULTANT', group_id: null };

describe('auth.me — forbidden user columns never leak', () => {
  it('uses an explicit safe column list and the JSON has no auth-secret keys', async () => {
    const body = await call(me, { user: REQ_USER, query: {}, body: {}, params: {} });
    expectSafeSelect('/auth/me');
    expectNoLeaks(body, '/auth/me');
    // Sanity — the user-visible fields ARE present.
    expect((body as any).id).toBe('u-1');
    expect((body as any).email).toBe('me@example.test');
  });
});

describe('auth.syncProfile — forbidden user columns never leak', () => {
  it('uses an explicit safe column list and the JSON has no auth-secret keys', async () => {
    const body = await call(syncProfile, {
      user: REQ_USER,
      query: {},
      body: { full_name: 'Test User' },
      params: {},
    });
    expectSafeSelect('/auth/sync');
    expectNoLeaks(body, '/auth/sync');
    expect((body as any).id).toBe('u-1');
  });
});

describe('adminUsers.get — admin detail must not leak auth secrets', () => {
  it('returns admin-detail fields but never password_hash / session_version / lockout columns', async () => {
    const body = await call(adminGet, {
      user: { id: 'u-admin', role: 'SUPER_ADMIN' },
      params: { id: 'u-1' },
      query: {},
      body: {},
    });
    expectSafeSelect('/admin/users/:id');
    expectNoLeaks(body, '/admin/users/:id');
    expect((body as any).id).toBe('u-1');
    // Admin detail still surfaces operational fields like status / notes.
    expect(Object.keys(body as any)).toEqual(expect.arrayContaining(['status', 'notes']));
  });
});
