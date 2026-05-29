/**
 * Ownership regression test for jobs.setNote.
 *
 * Pre-fix: PATCH /jobs/:id/note (OPERATOR_TIER) had no check on who owned
 * the existing note — a group-A operator could silently overwrite a
 * group-B recruiter's note, and the author name attached to the rendered
 * note would then be theirs. No audit, no trail.
 *
 * Fix: only the existing author may overwrite; admin-tier bypasses; a
 * note with NULL author is open (first OPERATOR claims it). 404 on
 * unauthorized overwrite (oracle hygiene).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  jobRow: null as { id: string; recruiter_note_by: string | null } | null,
  updateCount: 0,
}));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => {
        if (table === 'jobs') return { data: mock.jobRow, error: null };
        if (table === 'users') return { data: { full_name: 'Author' }, error: null };
        return { data: null, error: null };
      },
      update: () => {
        if (table === 'jobs') mock.updateCount++;
        return b;
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

// jobs.controller imports a bunch of AI / cross-controller deps; stub them.
vi.mock('../services/jobParser.service', () => ({ parseJobRequirements: vi.fn() }));
vi.mock('./resumes.controller', () => ({ tailorForJob: vi.fn() }));
vi.mock('./applications.controller', () => ({ fromJob: vi.fn() }));
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: true }));
vi.mock('../services/groupScope', () => ({
  leadCanAccessUser: vi.fn(async () => true),
  isAdminTier: (role: string) => ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR'].includes(role),
}));

import { setNote } from './jobs.controller';

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

async function call(
  user: { id: string; role: string } | undefined,
  params: Record<string, string>,
  body: unknown,
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await (setNote as any)({ user, body, params, query: {} }, res, vi.fn());
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  mock.jobRow = null;
  mock.updateCount = 0;
});

describe('jobs.setNote — note authorship', () => {
  it('first-time note (no existing author) is open: any OPERATOR may claim', async () => {
    mock.jobRow = { id: 'j-1', recruiter_note_by: null };
    const { err } = await call(
      { id: 'u-rec', role: 'RECRUITER' },
      { id: 'j-1' },
      { body: 'first note' },
    );
    expect(err).toBeNull();
    expect(mock.updateCount).toBe(1);
  });

  it('original author may overwrite their own note', async () => {
    mock.jobRow = { id: 'j-1', recruiter_note_by: 'u-rec' };
    const { err } = await call(
      { id: 'u-rec', role: 'RECRUITER' },
      { id: 'j-1' },
      { body: 'updated' },
    );
    expect(err).toBeNull();
    expect(mock.updateCount).toBe(1);
  });

  it("returns 404 when a DIFFERENT operator tries to overwrite another author's note", async () => {
    mock.jobRow = { id: 'j-1', recruiter_note_by: 'u-rec-a' };
    const { err } = await call(
      { id: 'u-rec-b', role: 'RECRUITER' },
      { id: 'j-1' },
      { body: 'hijack' },
    );
    expect(err?.status).toBe(404);
    expect(mock.updateCount).toBe(0);
  });

  it('ADMIN-tier may overwrite any note', async () => {
    mock.jobRow = { id: 'j-1', recruiter_note_by: 'u-rec-a' };
    const { err } = await call(
      { id: 'u-admin', role: 'DIRECTOR' },
      { id: 'j-1' },
      { body: 'admin override' },
    );
    expect(err).toBeNull();
    expect(mock.updateCount).toBe(1);
  });

  it('returns 404 when the job row does not exist', async () => {
    mock.jobRow = null;
    const { err } = await call(
      { id: 'u-rec', role: 'RECRUITER' },
      { id: 'j-missing' },
      { body: 'x' },
    );
    expect(err?.status).toBe(404);
    expect(mock.updateCount).toBe(0);
  });
});
