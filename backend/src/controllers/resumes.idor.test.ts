/**
 * IDOR / ownership tests for resumes.controller.authorizeConsultantAccess.
 *
 * Pins the security boundary introduced when the bug was fixed:
 *   - authorizeConsultantAccess must throw 404 (not 403) on ownership failure
 *     so the endpoint cannot be used as an existence oracle.
 *
 * Uses listForConsultant as the entry point because it:
 *   1. Has an explicit req.user guard (→ tests 401 case)
 *   2. Calls authorizeConsultantAccess directly with req.params.consultantId
 *   3. Requires minimal DB rows (no prior resume fetch needed)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mock = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const updates: { table: string; payload: Record<string, unknown> }[] = [];
  return { rows, updates };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      neq: () => b,
      order: () => b,
      limit: () => b,
      in: () => b,
      or: () => b,
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      update(payload: Record<string, unknown>) {
        mock.updates.push({ table, payload });
        return b;
      },
      delete: () => b,
      insert(payload: Record<string, unknown>) {
        mock.updates.push({ table: `insert:${table}`, payload });
        return b;
      },
      upsert: () => b,
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

vi.mock('../services/storage.service', () => ({
  uploadResumeFile: vi.fn(),
  getResumeSignedUrl: vi.fn(),
  readResumeFile: vi.fn(),
  deleteResumeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/ai.service', () => ({
  scoreResume: vi.fn(),
  parseResumeProfile: vi.fn(),
  tailorResumeForJob: vi.fn(),
  tailorResumeForJobStructured: vi.fn(),
  scoreResumeAgainstJob: vi.fn(),
  extractJobRequirements: vi.fn(),
}));

import * as resumes from './resumes.controller';

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
    end() {
      return this;
    },
  };
  return res;
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function call(
  handler: Handler,
  user: { id: string; role: string } | undefined,
  opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {},
): Promise<{ err: { status?: number; message?: string } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler(
      { user, body: opts.body ?? {}, params: opts.params ?? {}, query: opts.query ?? {}, log },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number; message?: string }, res };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.updates.length = 0;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_USER_ID = 'u-owner';
const OTHER_USER_ID = 'u-other';
const RECRUITER_USER_ID = 'u-recruiter';

const CONSULTANT_ROW = { id: 'c-1', user_id: OWNER_USER_ID, recruiter_id: 'r-1' };
const RECRUITER_ROW = { id: 'r-1' };

const CONSULTANT_OWNER = { id: OWNER_USER_ID, role: 'CONSULTANT' };
const CONSULTANT_OTHER = { id: OTHER_USER_ID, role: 'CONSULTANT' };
const RECRUITER_ASSIGNED = { id: RECRUITER_USER_ID, role: 'RECRUITER' };
const MANAGER = { id: 'u-manager', role: 'MANAGER' };
const UNKNOWN_ROLE = { id: 'u-unknown', role: 'VENDOR' };

// ---------------------------------------------------------------------------
// listForConsultant — ownership via authorizeConsultantAccess
// ---------------------------------------------------------------------------

describe('resumes.listForConsultant — authorizeConsultantAccess', () => {
  it('allows a CONSULTANT to list their own resumes', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(resumes.listForConsultant as Handler, CONSULTANT_OWNER, {
      params: { consultantId: 'c-1' },
    });
    expect(err).toBeNull();
  });

  it("returns 404 (not 403) when a CONSULTANT requests another user's resumes", async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(resumes.listForConsultant as Handler, CONSULTANT_OTHER, {
      params: { consultantId: 'c-1' },
    });
    // Regression guard: must be 404, not 403, to prevent existence oracle.
    expect(err?.status).toBe(404);
    expect(err?.message).toBe('Not found');
  });

  it('allows a RECRUITER assigned to the consultant', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.recruiters = [RECRUITER_ROW];
    const { err } = await call(resumes.listForConsultant as Handler, RECRUITER_ASSIGNED, {
      params: { consultantId: 'c-1' },
    });
    expect(err).toBeNull();
  });

  it('returns 404 when a RECRUITER is not assigned to the consultant', async () => {
    mock.rows.consultants = [{ ...CONSULTANT_ROW, recruiter_id: 'r-other' }];
    mock.rows.recruiters = [RECRUITER_ROW]; // rec.id = 'r-1', but consultant has 'r-other'
    const { err } = await call(resumes.listForConsultant as Handler, RECRUITER_ASSIGNED, {
      params: { consultantId: 'c-1' },
    });
    expect(err?.status).toBe(404);
    expect(err?.message).toBe('Not found');
  });

  it("allows a MANAGER to list any consultant's resumes", async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(resumes.listForConsultant as Handler, MANAGER, {
      params: { consultantId: 'c-1' },
    });
    expect(err).toBeNull();
  });

  it('returns 404 for an unknown role', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(resumes.listForConsultant as Handler, UNKNOWN_ROLE, {
      params: { consultantId: 'c-1' },
    });
    expect(err?.status).toBe(404);
  });

  it('returns 404 when the consultant row does not exist', async () => {
    mock.rows.consultants = [];
    const { err } = await call(resumes.listForConsultant as Handler, CONSULTANT_OWNER, {
      params: { consultantId: 'c-missing' },
    });
    expect(err?.status).toBe(404);
    expect(err?.message).toBe('Consultant not found');
  });

  it('returns 401 when req.user is not set', async () => {
    const { err } = await call(resumes.listForConsultant as Handler, undefined, {
      params: { consultantId: 'c-1' },
    });
    expect(err?.status).toBe(401);
  });
});
