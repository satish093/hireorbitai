/**
 * Tests for the "moonlighting recruiter" enrollment — giving a manager-tier user
 * a `recruiters` row so they can be assigned consultants without a role change.
 *
 * Pins:
 *   - enroll: manager-tier target → 201 (recruiters row upserted); non-manager
 *     (CONSULTANT) → 400; missing user → 404.
 *   - unenroll: manager-tier enrolled recruiter with no consultants → 200; a real
 *     RECRUITER account → 400 (use lifecycle); consultants still assigned → 409
 *     (no orphaning).
 *
 * DB + permission cache are mocked so the controller imports without env.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
      in: () => b,
      upsert: () => b,
      delete: () => b,
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: mock.rows[table] ?? [], error: null }).then(resolve, reject),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/permission.service', () => ({ invalidatePermissionCache: vi.fn() }));

import * as recruiters from './recruiters.controller';

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

async function call(
  handler: Handler,
  user: { id: string; role: string; group_id?: string | null } | undefined,
  opts: { body?: unknown; params?: Record<string, string> } = {},
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler({ user, body: opts.body ?? {}, params: opts.params ?? {} }, res, vi.fn());
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

// DIRECTOR is admin-tier → assertRecruiterInScope is a no-op (no group DB hops).
const ADMIN = { id: 'u-dir', role: 'DIRECTOR' };
const MGR_ID = '00000000-0000-4000-8000-000000000010';

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
});

describe('recruiters.enroll', () => {
  it('enrolls a manager-tier user as a recruiter (201, upserts a recruiters row)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'MANAGER', is_active: true }];
    mock.rows.recruiters = [{ id: 'rec-new', user_id: MGR_ID }];
    const { err, res } = await call(recruiters.enroll as Handler, ADMIN, {
      body: { user_id: MGR_ID },
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 'rec-new', user_id: MGR_ID });
  });

  it('refuses to enroll a CONSULTANT (400)', async () => {
    mock.rows.users = [{ id: MGR_ID, role: 'CONSULTANT', is_active: true }];
    const { err } = await call(recruiters.enroll as Handler, ADMIN, { body: { user_id: MGR_ID } });
    expect(err?.status).toBe(400);
  });

  it('404 when the target user does not exist', async () => {
    mock.rows.users = [];
    const { err } = await call(recruiters.enroll as Handler, ADMIN, { body: { user_id: MGR_ID } });
    expect(err?.status).toBe(404);
  });
});

describe('recruiters.unenroll', () => {
  it('removes the recruiter row from a manager-tier user with no consultants (200)', async () => {
    mock.rows.recruiters = [{ id: 'rec-1', user_id: MGR_ID }];
    mock.rows.users = [{ role: 'MANAGER' }];
    mock.rows.consultants = []; // none assigned
    const { err, res } = await call(recruiters.unenroll as Handler, ADMIN, {
      params: { id: 'rec-1' },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ ok: true });
  });

  it('refuses on a real RECRUITER account (400)', async () => {
    mock.rows.recruiters = [{ id: 'rec-1', user_id: MGR_ID }];
    mock.rows.users = [{ role: 'RECRUITER' }];
    const { err } = await call(recruiters.unenroll as Handler, ADMIN, { params: { id: 'rec-1' } });
    expect(err?.status).toBe(400);
  });

  it('refuses (409) when consultants are still assigned — no orphaning', async () => {
    mock.rows.recruiters = [{ id: 'rec-1', user_id: MGR_ID }];
    mock.rows.users = [{ role: 'MANAGER' }];
    mock.rows.consultants = [{ id: 'c-1' }]; // still assigned
    const { err } = await call(recruiters.unenroll as Handler, ADMIN, { params: { id: 'rec-1' } });
    expect(err?.status).toBe(409);
  });
});
