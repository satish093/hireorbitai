/**
 * Ownership + validation tests for recruiterGoals.controller.
 *
 * Goals are always scoped to the calling user's own recruiter row — no
 * cross-user access is possible by design. Tests verify:
 *   1. getGoals merges DB rows with defaults
 *   2. getGoals falls back gracefully when the user has no recruiter row
 *   3. setGoals writes only for the caller's own recruiter row
 *   4. setGoals rejects non-recruiter callers with 403
 *   5. Validation: invalid body shape → 400
 *   6. Auth: missing req.user → 401 on both handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mock = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const upserts: unknown[] = [];
  return { rows, upserts };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      insert: () => b,
      update: () => b,
      delete: () => b,
      upsert(payload: unknown) {
        mock.upserts.push({ table, payload });
        return b;
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.rows[table] ?? [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as recruiterGoals from './recruiterGoals.controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function call(
  handler: Handler,
  user: { id: string; role: string } | undefined,
  opts: { body?: unknown } = {},
): Promise<{ err: { status?: number; message?: string } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler({ user, body: opts.body ?? {}, params: {}, log }, res, vi.fn());
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number; message?: string }, res };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.upserts.length = 0;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECRUITER = { id: 'u-recruiter', role: 'RECRUITER' };
const MANAGER = { id: 'u-manager', role: 'MANAGER' };
const RECRUITER_ROW = { id: 'r-1' };

const GOAL_DEFAULTS = [
  { goal_type: 'submissions', target: 10 },
  { goal_type: 'interviews', target: 4 },
  { goal_type: 'offers', target: 2 },
  { goal_type: 'bench_refresh', target: 100 },
];

// ---------------------------------------------------------------------------
// getGoals
// ---------------------------------------------------------------------------

describe('recruiterGoals.getGoals', () => {
  it('returns defaults merged with DB rows when recruiter row exists', async () => {
    mock.rows.recruiters = [RECRUITER_ROW];
    mock.rows.recruiter_goals = [
      { goal_type: 'submissions', target: 15 },
      { goal_type: 'interviews', target: 6 },
    ];
    const { err, res } = await call(recruiterGoals.getGoals as Handler, RECRUITER);
    expect(err).toBeNull();
    const goals = res.body as { goal_type: string; target: number }[];
    expect(goals.find((g) => g.goal_type === 'submissions')?.target).toBe(15);
    expect(goals.find((g) => g.goal_type === 'interviews')?.target).toBe(6);
    // Unset goals fall back to defaults
    expect(goals.find((g) => g.goal_type === 'offers')?.target).toBe(2);
    expect(goals.find((g) => g.goal_type === 'bench_refresh')?.target).toBe(100);
  });

  it('returns defaults when user has no recruiter row', async () => {
    mock.rows.recruiters = []; // no recruiter row → recId is null
    const { err, res } = await call(recruiterGoals.getGoals as Handler, MANAGER);
    expect(err).toBeNull();
    expect(res.body).toEqual(GOAL_DEFAULTS);
  });

  it('returns 401 when req.user is not set', async () => {
    const { err } = await call(recruiterGoals.getGoals as Handler, undefined);
    expect(err?.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// setGoals
// ---------------------------------------------------------------------------

describe('recruiterGoals.setGoals', () => {
  it('allows a recruiter to set their own goals', async () => {
    mock.rows.recruiters = [RECRUITER_ROW];
    const { err, res } = await call(recruiterGoals.setGoals as Handler, RECRUITER, {
      body: {
        goals: [
          { goal_type: 'submissions', target: 20 },
          { goal_type: 'interviews', target: 8 },
        ],
      },
    });
    expect(err).toBeNull();
    expect(res.body).toEqual({ ok: true });
    expect(mock.upserts.length).toBe(2);
  });

  it('returns 403 when the caller has no recruiter row', async () => {
    mock.rows.recruiters = []; // non-recruiter (or manager without recruiter row)
    const { err } = await call(recruiterGoals.setGoals as Handler, MANAGER, {
      body: { goals: [{ goal_type: 'submissions', target: 5 }] },
    });
    expect(err?.status).toBe(403);
    expect(err?.message).toBe('Only recruiters can set goals');
    expect(mock.upserts.length).toBe(0);
  });

  it('returns 400 for an invalid goal_type', async () => {
    mock.rows.recruiters = [RECRUITER_ROW];
    const { err } = await call(recruiterGoals.setGoals as Handler, RECRUITER, {
      body: { goals: [{ goal_type: 'invalid_type', target: 5 }] },
    });
    expect(err?.status).toBe(400);
    expect(mock.upserts.length).toBe(0);
  });

  it('returns 400 when target exceeds maximum (100000)', async () => {
    mock.rows.recruiters = [RECRUITER_ROW];
    const { err } = await call(recruiterGoals.setGoals as Handler, RECRUITER, {
      body: { goals: [{ goal_type: 'submissions', target: 999999 }] },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 401 when req.user is not set', async () => {
    const { err } = await call(recruiterGoals.setGoals as Handler, undefined, {
      body: { goals: [] },
    });
    expect(err?.status).toBe(401);
  });
});
