/**
 * Ownership tests for consultants.setMarketingStatus.
 *
 * Before the fix, OPERATOR_TIER (which includes RECRUITER) could update the
 * marketing_status of ANY consultant — no recruiter→consultant ownership check
 * existed. The fix adds the same getCallerRecruiterRowId check used elsewhere.
 *
 * Tests pin:
 *   - RECRUITER updating their own consultant → 200
 *   - RECRUITER blocked from updating another recruiter's consultant → 404
 *   - ADMIN_TIER (DIRECTOR) can update any consultant → 200 (unscoped)
 *   - GROUP LEAD (HR_MANAGER) only within their own group → 200 in-group, 404
 *     out-of-group (fail-closed) — a lead must not flip an out-of-group
 *     consultant's marketing status.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------
const mock = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const updates: { table: string; payload: unknown }[] = [];
  return { rows, updates };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const eqs: Record<string, unknown> = {};
    let _payload: unknown;
    const b: any = {
      select() {
        return b;
      },
      eq(col: string, val: unknown) {
        eqs[col] = val;
        return b;
      },
      update(payload: unknown) {
        _payload = payload;
        mock.updates.push({ table, payload });
        return b;
      },
      maybeSingle() {
        const list = mock.rows[table] ?? [];
        const result =
          list.find((row: any) => Object.entries(eqs).every(([k, v]) => row[k] === v)) ?? null;
        return Promise.resolve({ data: result, error: null });
      },
      single() {
        const list = mock.rows[table] ?? [];
        const result =
          list.find((row: any) => Object.entries(eqs).every(([k, v]) => row[k] === v)) ?? null;
        return Promise.resolve({ data: result, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: mock.rows[table] ?? [], error: null }).then(resolve);
      },
    };
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/ai.service', () => ({}));
vi.mock('../services/permission.service', () => ({
  invalidatePermissionCache: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

import * as consultants from './consultants.controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;

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

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function call(
  handler: Handler,
  user: { id: string; role: string },
  opts: { body?: unknown; params?: Record<string, string> } = {},
) {
  const res = mkRes();
  try {
    await handler(
      { user, body: opts.body ?? {}, params: opts.params ?? {}, query: {}, log },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.updates.length = 0;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MY_REC = { id: 'rec-mine', user_id: 'u-recruiter' };
const MY_CONS = {
  id: 'cons-mine',
  user_id: 'u-cons',
  recruiter_id: 'rec-mine',
  marketing_status: 'ACTIVE',
};
const OTHER_CONS = {
  id: 'cons-other',
  user_id: 'u-other-cons',
  recruiter_id: 'rec-other',
  marketing_status: 'ACTIVE',
};

const RECRUITER = { id: 'u-recruiter', role: 'RECRUITER' };
const ADMIN_USER = { id: 'u-dir', role: 'DIRECTOR' };
const LEAD = { id: 'u-lead', role: 'HR_MANAGER', group_id: 'g1' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('consultants.setMarketingStatus — ownership', () => {
  it('RECRUITER can set status on their own consultant', async () => {
    mock.rows.recruiters = [MY_REC];
    mock.rows.consultants = [MY_CONS];
    const { err } = await call(consultants.setMarketingStatus as Handler, RECRUITER, {
      body: { marketing_status: 'PAUSED' },
      params: { id: 'cons-mine' },
    });
    expect(err).toBeNull();
  });

  it("RECRUITER is blocked from setting status on another recruiter's consultant", async () => {
    mock.rows.recruiters = [MY_REC];
    mock.rows.consultants = [OTHER_CONS];
    const { err } = await call(consultants.setMarketingStatus as Handler, RECRUITER, {
      body: { marketing_status: 'PLACED' },
      params: { id: 'cons-other' },
    });
    expect(err?.status).toBe(404);
  });

  it('ADMIN_TIER (DIRECTOR) can set marketing status on any consultant (unscoped)', async () => {
    mock.rows.consultants = [OTHER_CONS];
    const { err } = await call(consultants.setMarketingStatus as Handler, ADMIN_USER, {
      body: { marketing_status: 'PLACED' },
      params: { id: 'cons-other' },
    });
    expect(err).toBeNull();
  });

  it('GROUP LEAD can set status on an in-group consultant', async () => {
    mock.rows.consultants = [OTHER_CONS];
    mock.rows.users = [{ id: 'u-other-cons' }]; // owner is in the lead's group
    const { err } = await call(consultants.setMarketingStatus as Handler, LEAD, {
      body: { marketing_status: 'PLACED' },
      params: { id: 'cons-other' },
    });
    expect(err).toBeNull();
  });

  it('GROUP LEAD is blocked from an out-of-group consultant (fail-closed → 404)', async () => {
    mock.rows.consultants = [OTHER_CONS];
    mock.rows.users = []; // empty group — lead sees nobody
    const { err } = await call(consultants.setMarketingStatus as Handler, LEAD, {
      body: { marketing_status: 'PLACED' },
      params: { id: 'cons-other' },
    });
    expect(err?.status).toBe(404);
  });

  it('rejects an invalid marketing_status value', async () => {
    mock.rows.recruiters = [MY_REC];
    mock.rows.consultants = [MY_CONS];
    const { err } = await call(consultants.setMarketingStatus as Handler, RECRUITER, {
      body: { marketing_status: 'INVALID' },
      params: { id: 'cons-mine' },
    });
    expect(err?.status).toBe(400);
  });
});
