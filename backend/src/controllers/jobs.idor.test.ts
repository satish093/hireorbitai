/**
 * Regression test for the jobs.applied / jobs.applyOptions IDOR fix (audit
 * HIGH). Both handlers now scope an explicit `consultant_id` through
 * assertConsultantAccess: a CONSULTANT may only reference their own consultant
 * row, and a mismatch throws 404 (not an existence-oracle 403). Manager-tier
 * keeps full on-behalf-of access. DB + heavy job-service deps are mocked so the
 * controller imports without reaching config/env.
 */

import { describe, it, expect, vi } from 'vitest';

const mockFlags = vi.hoisted(() => ({ nullConsultant: false }));

vi.mock('../config/db', () => {
  // The caller's own consultant row resolves to id 'mine'; everything else is
  // an empty list / minimal row so the handlers don't crash post-authorization.
  const tableDefaults: Record<string, unknown> = {
    consultants: { id: 'mine', skills: null, primary_skill: null },
    jobs: { id: 'j-1', requirements: null, required_skills: [] },
  };
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      insert: () => b,
      single: () => Promise.resolve({ data: tableDefaults[table] ?? { id: 'x' }, error: null }),
      maybeSingle: () => {
        if (table === 'consultants' && mockFlags.nullConsultant) {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: tableDefaults[table] ?? null, error: null });
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: false, AI_AVAILABLE: false }));
vi.mock('../services/ai.service', () => ({
  matchJobsForConsultant: vi.fn(),
  atsScore: vi.fn(),
  scoreResumeAgainstJob: vi.fn(),
  jobCopilot: vi.fn(),
}));
vi.mock('../services/jobParser.service', () => ({ parseJobRequirements: vi.fn() }));
vi.mock('./resumes.controller', () => ({ tailorForJob: vi.fn() }));
vi.mock('./applications.controller', () => ({ fromJob: vi.fn() }));

import {
  applied,
  applyOptions,
  recommended,
  duplicateCheck,
  matchForConsultant,
  scoreJobs,
} from './jobs.controller';

const CONSULTANT = { id: 'u-consultant', role: 'CONSULTANT' };
const MANAGER = { id: 'u-manager', role: 'MANAGER' };

function mkRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
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
  req: { query?: any; body?: any; params?: any; user: any },
): Promise<{ res: any; err: { status?: number } | null }> {
  const res = mkRes();
  try {
    await handler({ query: {}, body: {}, params: {}, ...req }, res, vi.fn());
    return { res, err: null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

describe('jobs.applied — consultant_id IDOR guard', () => {
  it('404s when a CONSULTANT requests another consultant_id', async () => {
    const { err } = await call(applied, {
      query: { consultant_id: 'someone-else' },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(404);
  });

  it('allows a manager to view any consultant on-behalf-of', async () => {
    const { err, res } = await call(applied, {
      query: { consultant_id: 'someone-else' },
      user: MANAGER,
    });
    expect(err).toBeNull();
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('jobs.applyOptions — consultant_id IDOR guard', () => {
  it('404s when a CONSULTANT supplies another consultant_id', async () => {
    const { err } = await call(applyOptions, {
      params: { id: 'j-1' },
      body: { consultant_id: 'someone-else' },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(404);
  });

  it('allows a manager to pull apply-options for any consultant', async () => {
    const { err, res } = await call(applyOptions, {
      params: { id: 'j-1' },
      body: { consultant_id: 'someone-else' },
      user: MANAGER,
    });
    expect(err).toBeNull();
    expect(res.body).toHaveProperty('job');
  });
});

describe('jobs.recommended — consultant_id IDOR guard', () => {
  it('404s when a CONSULTANT requests another consultant_id', async () => {
    const { err } = await call(recommended, {
      query: { consultant_id: 'someone-else' },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(404);
  });
});

describe('jobs.duplicateCheck — consultant_id IDOR guard', () => {
  it('404s when a CONSULTANT requests another consultant_id', async () => {
    const { err } = await call(duplicateCheck, {
      params: { id: 'j-1' },
      query: { consultant_id: 'someone-else' },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(404);
  });

  it('allows a consultant to check their own consultant_id', async () => {
    const { err, res } = await call(duplicateCheck, {
      params: { id: 'j-1' },
      query: { consultant_id: 'mine' },
      user: CONSULTANT,
    });
    expect(err).toBeNull();
    expect(res.body).toHaveProperty('duplicate', false);
  });
});

describe('jobs.matchForConsultant — :consultantId IDOR guard', () => {
  it('404s when a CONSULTANT requests another consultant', async () => {
    const { err } = await call(matchForConsultant, {
      params: { consultantId: 'someone-else' },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(404);
  });

  it('allows a manager to match on behalf of any consultant', async () => {
    const { err } = await call(matchForConsultant, {
      params: { consultantId: 'someone-else' },
      user: MANAGER,
    });
    expect(err).toBeNull();
  });
});

describe('jobs.scoreJobs — role + profile guards', () => {
  it('400s when CONSULTANT has no consultant profile', async () => {
    mockFlags.nullConsultant = true;
    try {
      const { err } = await call(scoreJobs, { user: CONSULTANT });
      expect(err?.status).toBe(400);
    } finally {
      mockFlags.nullConsultant = false;
    }
  });
});
