/**
 * Ownership + field-restriction tests for consultants.controller.
 *
 * Pins three security-sensitive behaviours:
 *   1. get() ownership — a CONSULTANT may only read their own row; another
 *      consultant's row throws 403. Manager-tier reads any row.
 *   2. update() ownership — same scope rule; also verifies user_id and
 *      recruiter_id cannot be mutated via the body (they're not in onboardingSchema).
 *   3. update() field allowlist — server-controlled fields are dropped even
 *      when the Zod schema passes partial data.
 *
 * DB + recruiter-lookup deps are mocked so the controller imports without
 * reaching config/env. All mocks are reset between tests via beforeEach.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock — settable fixture rows + captured update payloads
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
      order: () => b,
      limit: () => b,
      in: () => b,
      or: () => b,
      update(payload: Record<string, unknown>) {
        mock.updates.push({ table, payload });
        return b;
      },
      upsert: () => b,
      insert(payload: Record<string, unknown>) {
        mock.updates.push({ table: `insert:${table}`, payload });
        return b;
      },
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
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

// AI service pulled in by the scoreConsultantsForJob helper
vi.mock('../services/ai.service', () => ({}));

import * as consultants from './consultants.controller';

// ---------------------------------------------------------------------------
// Test helpers
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
const CONSULTANT_ROW = { id: 'c-1', user_id: OWNER_USER_ID, recruiter_id: 'r-1' };

const CONSULTANT_OWNER = { id: OWNER_USER_ID, role: 'CONSULTANT' };
const CONSULTANT_OTHER = { id: OTHER_USER_ID, role: 'CONSULTANT' };
// Admin tier is unscoped — reads/writes any consultant row.
const ADMIN = { id: 'u-director', role: 'DIRECTOR' };
// A group lead (HR_MANAGER/MANAGER) is confined to their own group. Group
// membership is resolved by managerGroupUserIds, which reads `users` by
// group_id — so seeding mock.rows.users controls whether the consultant's
// owning user counts as in-group.
const GROUP_LEAD = { id: 'u-lead', role: 'HR_MANAGER', group_id: 'g1' };
// A RECRUITER is group-scoped like a group lead: sees/edits every consultant in
// their own group, nobody else's. Membership resolves via mock.rows.users too.
const RECRUITER = { id: 'u-recruiter', role: 'RECRUITER', group_id: 'g1' };

// ---------------------------------------------------------------------------
// get() — read ownership
// ---------------------------------------------------------------------------

describe('consultants.get — read ownership', () => {
  it('allows a CONSULTANT to read their own row', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err, res } = await call(consultants.get as Handler, CONSULTANT_OWNER, {
      params: { id: 'c-1' },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ id: 'c-1' });
  });

  it("returns 404 when a CONSULTANT reads another user's row", async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(consultants.get as Handler, CONSULTANT_OTHER, {
      params: { id: 'c-1' },
    });
    // 404 (not 403) so the endpoint cannot be used as an existence oracle.
    expect(err?.status).toBe(404);
  });

  it('returns 404 when the consultant row does not exist', async () => {
    mock.rows.consultants = [];
    const { err } = await call(consultants.get as Handler, CONSULTANT_OWNER, {
      params: { id: 'c-missing' },
    });
    expect(err?.status).toBe(404);
  });

  it('allows an ADMIN-tier user to read any consultant row', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err, res } = await call(consultants.get as Handler, ADMIN, {
      params: { id: 'c-1' },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ id: 'c-1' });
  });

  it('allows a group lead to read a consultant in their own group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = [{ id: OWNER_USER_ID }]; // owner is in the lead's group
    const { err, res } = await call(consultants.get as Handler, GROUP_LEAD, {
      params: { id: 'c-1' },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ id: 'c-1' });
  });

  it('returns 404 when a group lead reads a consultant outside their group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = []; // nobody in the lead's group → fail-closed
    const { err } = await call(consultants.get as Handler, GROUP_LEAD, {
      params: { id: 'c-1' },
    });
    expect(err?.status).toBe(404);
  });

  it('allows a RECRUITER to read a consultant in their own group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = [{ id: OWNER_USER_ID }]; // owner is in the recruiter's group
    const { err, res } = await call(consultants.get as Handler, RECRUITER, {
      params: { id: 'c-1' },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ id: 'c-1' });
  });

  it('returns 404 when a RECRUITER reads a consultant outside their group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = []; // empty group → fail-closed, no org-wide leak
    const { err } = await call(consultants.get as Handler, RECRUITER, {
      params: { id: 'c-1' },
    });
    expect(err?.status).toBe(404);
  });

  it('returns 401 when req.user is undefined', async () => {
    const { err } = await call(consultants.get as Handler, undefined, {
      params: { id: 'c-1' },
    });
    expect(err?.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// update() — write ownership + field allowlist
// ---------------------------------------------------------------------------

describe('consultants.update — write ownership', () => {
  it('allows a CONSULTANT to update their own row', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(consultants.update as Handler, CONSULTANT_OWNER, {
      params: { id: 'c-1' },
      body: { primary_skill: 'TypeScript' },
    });
    expect(err).toBeNull();
    const patch = mock.updates.find((u) => u.table === 'consultants')?.payload;
    expect(patch).toMatchObject({ primary_skill: 'TypeScript' });
  });

  it("returns 404 when a CONSULTANT updates another user's row (oracle hygiene)", async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(consultants.update as Handler, CONSULTANT_OTHER, {
      params: { id: 'c-1' },
      body: { primary_skill: 'Attacker' },
    });
    // 404 (not 403) so the endpoint can't be used as an existence oracle —
    // matches the canonical pattern from applications.loadAndAuthorize.
    expect(err?.status).toBe(404);
    expect(mock.updates.find((u) => u.table === 'consultants')).toBeUndefined();
  });

  it('allows an ADMIN-tier user to update any consultant row', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(consultants.update as Handler, ADMIN, {
      params: { id: 'c-1' },
      body: { primary_skill: 'Java' },
    });
    expect(err).toBeNull();
    const patch = mock.updates.find((u) => u.table === 'consultants')?.payload;
    expect(patch).toMatchObject({ primary_skill: 'Java' });
  });

  it('allows a group lead to update a consultant in their group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = [{ id: OWNER_USER_ID }];
    const { err } = await call(consultants.update as Handler, GROUP_LEAD, {
      params: { id: 'c-1' },
      body: { primary_skill: 'Rust' },
    });
    expect(err).toBeNull();
    expect(mock.updates.find((u) => u.table === 'consultants')?.payload).toMatchObject({
      primary_skill: 'Rust',
    });
  });

  it('returns 404 when a group lead updates a consultant outside their group (oracle hygiene)', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = []; // not in the lead's group
    const { err } = await call(consultants.update as Handler, GROUP_LEAD, {
      params: { id: 'c-1' },
      body: { primary_skill: 'Java' },
    });
    expect(err?.status).toBe(404);
    expect(mock.updates.find((u) => u.table === 'consultants')).toBeUndefined();
  });

  it('allows a RECRUITER to update a consultant in their own group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = [{ id: OWNER_USER_ID }]; // owner in the recruiter's group
    const { err } = await call(consultants.update as Handler, RECRUITER, {
      params: { id: 'c-1' },
      body: { primary_skill: 'Kotlin' },
    });
    expect(err).toBeNull();
    expect(mock.updates.find((u) => u.table === 'consultants')?.payload).toMatchObject({
      primary_skill: 'Kotlin',
    });
  });

  it('returns 404 when a RECRUITER updates a consultant outside their group (oracle hygiene)', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = []; // not in the recruiter's group
    const { err } = await call(consultants.update as Handler, RECRUITER, {
      params: { id: 'c-1' },
      body: { primary_skill: 'Java' },
    });
    expect(err?.status).toBe(404);
    expect(mock.updates.find((u) => u.table === 'consultants')).toBeUndefined();
  });

  it('returns 404 when the consultant row does not exist on update', async () => {
    mock.rows.consultants = [];
    const { err } = await call(consultants.update as Handler, ADMIN, {
      params: { id: 'c-missing' },
      body: { primary_skill: 'Java' },
    });
    expect(err?.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// update() — field allowlist (mass-assignment guard)
// ---------------------------------------------------------------------------

describe('consultants.update — field allowlist (mass-assignment guard)', () => {
  it('rejects body containing user_id — onboardingSchema is .strict()', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(consultants.update as Handler, ADMIN, {
      params: { id: 'c-1' },
      // user_id is a server-controlled field not in onboardingSchema; .strict() rejects it
      body: { primary_skill: 'Go', user_id: 'u-attacker' },
    });
    expect(err?.status).toBe(400);
    // No DB write should have happened
    expect(mock.updates.find((u) => u.table === 'consultants')).toBeUndefined();
  });

  it('rejects body containing recruiter_id — onboardingSchema is .strict()', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(consultants.update as Handler, ADMIN, {
      params: { id: 'c-1' },
      body: { visa_status: 'OPT', recruiter_id: 'r-attacker' },
    });
    expect(err?.status).toBe(400);
    // No DB write should have happened
    expect(mock.updates.find((u) => u.table === 'consultants')).toBeUndefined();
  });

  it('returns 400 for completely invalid body', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err } = await call(consultants.update as Handler, ADMIN, {
      params: { id: 'c-1' },
      // linkedin_url must be a URL or empty string; this is neither
      body: { linkedin_url: 'not-a-url-or-empty' },
    });
    expect(err?.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// list() — recruiter group scoping (visibility, not just per-row ownership)
// ---------------------------------------------------------------------------

describe('consultants.list — recruiter group scoping', () => {
  it('scopes a RECRUITER to the consultants in their own group', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.users = [{ id: OWNER_USER_ID }]; // recruiter's group has this user
    const { err, res } = await call(consultants.list as Handler, RECRUITER, {});
    expect(err).toBeNull();
    expect(res.body).toEqual([CONSULTANT_ROW]);
  });

  it('returns [] for a RECRUITER with no group (fail-closed, no org-wide leak)', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    const { err, res } = await call(
      consultants.list as Handler,
      { id: 'u-recruiter', role: 'RECRUITER' }, // no group_id
      {},
    );
    expect(err).toBeNull();
    expect(res.body).toEqual([]);
  });
});
