/**
 * IDOR regression tests for the skillGap endpoint.
 *
 * Before the fix, `?consultant_id=<any-uuid>` was gated with OPERATOR_TIER
 * which includes RECRUITER — meaning any recruiter could read any consultant's
 * skill profile without needing to own them. The fix replaced that check with
 * assertConsultantAccess(), which verifies ownership.
 *
 * These tests pin that a RECRUITER can only query their own consultant's skill
 * gap, not a stranger's, while MANAGER_TIER can query any.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock — table → rows map; each query filters by eq(col, val).
// ---------------------------------------------------------------------------
const mock = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  return { rows };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    let filtered: unknown[] = [];
    const eqs: Record<string, unknown> = {};
    const b: any = {
      select() {
        return b;
      },
      eq(col: string, val: unknown) {
        eqs[col] = val;
        return b;
      },
      neq() {
        return b;
      },
      in() {
        return b;
      },
      or() {
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      maybeSingle() {
        const list = mock.rows[table] ?? [];
        const result =
          list.find((row: any) => Object.entries(eqs).every(([k, v]) => row[k] === v)) ?? null;
        return Promise.resolve({ data: result, error: null });
      },
      single() {
        return b.maybeSingle();
      },
      then(resolve: (v: unknown) => unknown) {
        const list = mock.rows[table] ?? [];
        filtered = list.filter((row: any) => Object.entries(eqs).every(([k, v]) => row[k] === v));
        return Promise.resolve({ data: filtered, error: null }).then(resolve);
      },
    };
    return b;
  }
  return {
    db: { from: (t: string) => makeBuilder(t) },
    pool: { query: async () => ({ rows: [] }) },
  };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: false, AI_AVAILABLE: false }));
vi.mock('../services/ai.service', () => ({
  matchJobsForConsultant: vi.fn(),
  atsScore: vi.fn(),
  scoreResumeAgainstJob: vi.fn(),
  jobCopilot: vi.fn(),
  analyzeSkillGap: vi.fn().mockResolvedValue({ matched: [], missing: [] }),
}));
vi.mock('../services/jobParser.service', () => ({ parseJobRequirements: vi.fn() }));
vi.mock('./resumes.controller', () => ({ tailorForJob: vi.fn() }));
vi.mock('./applications.controller', () => ({ fromJob: vi.fn() }));

import * as jobs from './jobs.controller';

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
  opts: { params?: Record<string, string>; query?: Record<string, string> } = {},
) {
  const res = mkRes();
  try {
    await handler(
      { user, body: {}, params: opts.params ?? {}, query: opts.query ?? {}, log },
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
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const RECRUITER = { id: 'u-recruiter', role: 'RECRUITER' };
const MANAGER_USER = { id: 'u-manager', role: 'HR_MANAGER' };
const CONSULTANT_USER = { id: 'u-consultant', role: 'CONSULTANT' };

const MY_REC_ROW = { id: 'rec-mine', user_id: 'u-recruiter', manager_id: null };
const MY_CONSULTANT_ROW = {
  id: 'cons-mine',
  user_id: 'u-my-consultant',
  recruiter_id: 'rec-mine',
  primary_skill: 'Java',
  skills: ['Java'],
};
const OTHER_CONSULTANT_ROW = {
  id: 'cons-other',
  user_id: 'u-other-consultant',
  recruiter_id: 'rec-other',
  primary_skill: 'Python',
  skills: ['Python'],
};
const JOB_ROW = { id: 'job-1', title: 'Dev', required_skills: ['Java'], requirements: '' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('skillGap — IDOR protection', () => {
  it("RECRUITER is denied skill gap for another recruiter's consultant", async () => {
    mock.rows.recruiters = [MY_REC_ROW];
    mock.rows.consultants = [MY_CONSULTANT_ROW, OTHER_CONSULTANT_ROW];
    mock.rows.jobs = [JOB_ROW];
    const { err } = await call(jobs.skillGap as Handler, RECRUITER, {
      params: { id: 'job-1' },
      query: { consultant_id: 'cons-other' },
    });
    expect(err?.status).toBe(404);
  });

  it('RECRUITER can gap-check their own consultant', async () => {
    mock.rows.recruiters = [MY_REC_ROW];
    mock.rows.consultants = [MY_CONSULTANT_ROW];
    mock.rows.jobs = [JOB_ROW];
    const { err } = await call(jobs.skillGap as Handler, RECRUITER, {
      params: { id: 'job-1' },
      query: { consultant_id: 'cons-mine' },
    });
    // 200 OK (no ownership error); AI call will return empty but no security error
    expect(err?.status).toBeUndefined();
  });

  it('MANAGER can gap-check any consultant', async () => {
    mock.rows.consultants = [OTHER_CONSULTANT_ROW];
    mock.rows.jobs = [JOB_ROW];
    const { err } = await call(jobs.skillGap as Handler, MANAGER_USER, {
      params: { id: 'job-1' },
      query: { consultant_id: 'cons-other' },
    });
    expect(err?.status).toBeUndefined();
  });

  it('CONSULTANT checking their own gap (no explicit consultant_id) succeeds', async () => {
    mock.rows.consultants = [{ ...MY_CONSULTANT_ROW, user_id: 'u-consultant', id: 'cons-self' }];
    mock.rows.jobs = [JOB_ROW];
    const { err } = await call(jobs.skillGap as Handler, CONSULTANT_USER, {
      params: { id: 'job-1' },
    });
    expect(err?.status).toBeUndefined();
  });

  it('CONSULTANT providing an explicit consultant_id for another user is denied', async () => {
    mock.rows.consultants = [MY_CONSULTANT_ROW, OTHER_CONSULTANT_ROW];
    mock.rows.jobs = [JOB_ROW];
    const { err } = await call(jobs.skillGap as Handler, CONSULTANT_USER, {
      params: { id: 'job-1' },
      query: { consultant_id: 'cons-other' },
    });
    expect(err?.status).toBe(404);
  });
});
