/**
 * Ownership tests for workAuthDocs.controller.
 *
 * The controller uses a three-tier authorizeConsultantAccess pattern:
 *   MANAGER_TIER+  → unrestricted
 *   RECRUITER      → only their assigned consultants
 *   CONSULTANT     → only themselves
 *
 * All ownership failures correctly throw httpError(404) — these tests
 * verify that the 404 contract is maintained.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mock = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  return { rows };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      insert: () => b,
      update: () => b,
      delete: () => b,
      upsert: () => b,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.rows[table] ?? [], error: null }).then(resolve),
    });
    return b;
  }
  return {
    db: {
      from: (t: string) => makeBuilder(t),
      storage: {
        from: () => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          createSignedUrl: vi
            .fn()
            .mockResolvedValue({ data: { signedUrl: 'https://example.com/signed' }, error: null }),
          remove: vi.fn().mockResolvedValue({ error: null }),
        }),
      },
    },
    pool: {},
  };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/audit.service', () => ({
  audit: vi.fn(),
}));

import * as workAuthDocs from './workAuthDocs.controller';

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
    send() {
      return this;
    },
  };
  return res;
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function call(
  handler: Handler,
  user: { id: string; role: string } | undefined,
  opts: { body?: unknown; params?: Record<string, string> } = {},
): Promise<{ err: { status?: number; message?: string } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler({ user, body: opts.body ?? {}, params: opts.params ?? {}, log }, res, vi.fn());
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number; message?: string }, res };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
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
// Admin tier is unscoped; a group lead (HR_MANAGER/MANAGER) is confined to its
// group (resolved via managerGroupUserIds → reads `users` by group_id).
const ADMIN = { id: 'u-director', role: 'DIRECTOR' };
const GROUP_LEAD = { id: 'u-lead', role: 'MANAGER', group_id: 'g1' };

// ---------------------------------------------------------------------------
// list — ownership via authorizeConsultantAccess
// ---------------------------------------------------------------------------

describe('workAuthDocs.list — authorizeConsultantAccess', () => {
  it('allows a CONSULTANT to list their own documents', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.work_auth_documents = [];
    const { err, res } = await call(workAuthDocs.list as Handler, CONSULTANT_OWNER, {
      params: { consultantId: 'c-1' },
    });
    expect(err).toBeNull();
    expect(res.body).toEqual([]);
  });

  it("returns 404 when a CONSULTANT requests another user's documents", async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(workAuthDocs.list as Handler, CONSULTANT_OTHER, {
      params: { consultantId: 'c-1' },
    });
    expect(err?.status).toBe(404);
    expect(err?.message).toBe('Not found');
  });

  it('allows a RECRUITER assigned to the consultant', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.recruiters = [RECRUITER_ROW];
    mock.rows.work_auth_documents = [];
    const { err } = await call(workAuthDocs.list as Handler, RECRUITER_ASSIGNED, {
      params: { consultantId: 'c-1' },
    });
    expect(err).toBeNull();
  });

  it('returns 404 when a RECRUITER is not assigned to the consultant', async () => {
    mock.rows.consultants = [{ ...CONSULTANT_ROW, recruiter_id: 'r-other' }];
    mock.rows.recruiters = [RECRUITER_ROW]; // rec.id='r-1', consultant has 'r-other'
    const { err } = await call(workAuthDocs.list as Handler, RECRUITER_ASSIGNED, {
      params: { consultantId: 'c-1' },
    });
    expect(err?.status).toBe(404);
  });

  it("allows an ADMIN-tier user to list any consultant's documents", async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.work_auth_documents = [];
    const { err } = await call(workAuthDocs.list as Handler, ADMIN, {
      params: { consultantId: 'c-1' },
    });
    expect(err).toBeNull();
  });

  it('allows a group lead to list documents for a consultant in their group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = [{ id: OWNER_USER_ID }]; // owner in the lead's group
    mock.rows.work_auth_documents = [];
    const { err } = await call(workAuthDocs.list as Handler, GROUP_LEAD, {
      params: { consultantId: 'c-1' },
    });
    expect(err).toBeNull();
  });

  it('returns 404 when a group lead requests docs for a consultant outside their group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = []; // not in the lead's group → fail-closed
    const { err } = await call(workAuthDocs.list as Handler, GROUP_LEAD, {
      params: { consultantId: 'c-1' },
    });
    expect(err?.status).toBe(404);
  });

  it('returns 404 when the consultant row does not exist', async () => {
    mock.rows.consultants = [];
    const { err } = await call(workAuthDocs.list as Handler, CONSULTANT_OWNER, {
      params: { consultantId: 'c-missing' },
    });
    expect(err?.status).toBe(404);
  });

  it('returns 401 when req.user is not set', async () => {
    const { err } = await call(workAuthDocs.list as Handler, undefined, {
      params: { consultantId: 'c-1' },
    });
    expect(err?.status).toBe(401);
  });
});
