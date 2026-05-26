/**
 * loadAndAuthorize ownership tests for interviews.controller, driven through the
 * exported `update` handler (the canonical caller of loadAndAuthorize).
 *
 * Pins the four authorization branches the helper implements:
 *   - MANAGER_TIER: full access, no ownership query.
 *   - creator bypass: created_by === caller id is allowed regardless of role.
 *   - recruiter-owns-consultant: a RECRUITER may touch an interview whose
 *     consultant_id is one of their assigned consultants.
 *   - consultant-owns-self: a CONSULTANT may touch an interview tied to their
 *     own consultant row.
 *   - stranger: a non-owner, non-manager gets httpError(404) NOT 403, so the
 *     endpoint can't be used as an existence oracle.
 *
 * config/db is mocked with a tiny filter-aware shim; the heavy reminder service
 * the controller imports is stubbed so importing never reaches config/env.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  // table -> rows; a select applies eq() filters before resolving.
  const rows: Record<string, Record<string, unknown>[]> = {};
  return { rows };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq(col: string, val: unknown) {
        filters[col] = val;
        return b;
      },
      neq: () => b,
      is: () => b,
      in: () => b,
      not: () => b,
      gt: () => b,
      gte: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      update: () => b,
      insert: () => b,
      _match() {
        return (mock.rows[table] ?? []).filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v),
        );
      },
      maybeSingle() {
        return Promise.resolve({ data: (b as any)._match()[0] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: (b as any)._match()[0] ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: (b as any)._match(), error: null }).then(resolve);
      },
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

vi.mock('../services/interviewReminders.service', () => ({
  syncInterviewReminders: vi.fn(),
}));

// Stub the realtime service so importing the controller never loads `pg`
// (its `import { Client } from 'pg'` throws under vitest's module interop).
vi.mock('../services/realtime.service', () => ({
  publishToUser: vi.fn(),
}));

import { update } from './interviews.controller';

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

async function callUpdate(
  user: { id: string; role: string },
  id: string,
): Promise<{ status?: number } | null> {
  try {
    // A valid (empty) update body so the only thing under test is authorization.
    await (update as any)({ user, params: { id }, body: {} }, mkRes(), vi.fn());
    return null;
  } catch (e) {
    return e as { status?: number };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
});

describe('interviews.controller — loadAndAuthorize (via update)', () => {
  it('MANAGER_TIER caller is authorized for any interview', async () => {
    mock.rows.interviews = [{ id: 'iv-1', consultant_id: 'c-1', created_by: 'u-other' }];
    const err = await callUpdate({ id: 'u-mgr', role: 'MANAGER' }, 'iv-1');
    expect(err).toBeNull();
  });

  it('the creator is authorized even as a non-manager (created_by bypass)', async () => {
    mock.rows.interviews = [{ id: 'iv-1', consultant_id: 'c-1', created_by: 'u-creator' }];
    const err = await callUpdate({ id: 'u-creator', role: 'RECRUITER' }, 'iv-1');
    expect(err).toBeNull();
  });

  it('a recruiter who owns the consultant is authorized', async () => {
    mock.rows.interviews = [{ id: 'iv-1', consultant_id: 'c-1', created_by: 'u-other' }];
    // The caller's recruiter row.
    mock.rows.recruiters = [{ id: 'r-1', user_id: 'u-recruiter' }];
    // The interview's consultant belongs to that recruiter.
    mock.rows.consultants = [{ id: 'c-1', recruiter_id: 'r-1' }];
    const err = await callUpdate({ id: 'u-recruiter', role: 'RECRUITER' }, 'iv-1');
    expect(err).toBeNull();
  });

  it('a recruiter who does NOT own the consultant gets 404 (not 403)', async () => {
    mock.rows.interviews = [{ id: 'iv-1', consultant_id: 'c-other', created_by: 'u-other' }];
    mock.rows.recruiters = [{ id: 'r-1', user_id: 'u-recruiter' }];
    // The interview's consultant belongs to a different recruiter, so the
    // eq('id','c-other').eq('recruiter_id','r-1') lookup matches nothing.
    mock.rows.consultants = [{ id: 'c-mine', recruiter_id: 'r-1' }];
    const err = await callUpdate({ id: 'u-recruiter', role: 'RECRUITER' }, 'iv-1');
    expect(err?.status).toBe(404);
  });

  it('a consultant tied to their own consultant row is authorized', async () => {
    mock.rows.interviews = [{ id: 'iv-1', consultant_id: 'c-self', created_by: 'u-other' }];
    mock.rows.consultants = [{ id: 'c-self', user_id: 'u-consultant' }];
    const err = await callUpdate({ id: 'u-consultant', role: 'CONSULTANT' }, 'iv-1');
    expect(err).toBeNull();
  });

  it('a consultant tied to a DIFFERENT consultant row gets 404 (not 403)', async () => {
    mock.rows.interviews = [{ id: 'iv-1', consultant_id: 'c-other', created_by: 'u-other' }];
    mock.rows.consultants = [{ id: 'c-self', user_id: 'u-consultant' }];
    const err = await callUpdate({ id: 'u-consultant', role: 'CONSULTANT' }, 'iv-1');
    expect(err?.status).toBe(404);
  });

  it('a missing interview row yields 404', async () => {
    mock.rows.interviews = [];
    const err = await callUpdate({ id: 'u-mgr', role: 'MANAGER' }, 'iv-missing');
    expect(err?.status).toBe(404);
  });
});
