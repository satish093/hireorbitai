/**
 * Validation + audit tests for consultants.assignRecruiter.
 *
 * Before the fix, the handler accepted any recruiter_id string without
 * verifying it pointed to a real recruiter row. It also emitted no audit event.
 *
 * Tests pin:
 *   - Missing recruiter_id → 400
 *   - Non-existent consultant_id → 404
 *   - Non-existent recruiter_id → 400
 *   - Valid assignment → 200 + audit() is called
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
    const b: any = {
      select() {
        return b;
      },
      eq(col: string, val: unknown) {
        eqs[col] = val;
        return b;
      },
      update(payload: unknown) {
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
        return b.maybeSingle();
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

const { auditSpy, invalidateSpy } = vi.hoisted(() => ({
  auditSpy: vi.fn().mockResolvedValue(undefined),
  invalidateSpy: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ audit: auditSpy }));
vi.mock('../services/permission.service', () => ({ invalidatePermissionCache: invalidateSpy }));

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
  auditSpy.mockClear();
  invalidateSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MANAGER_USER = { id: 'u-manager', role: 'MANAGER' };
const CONSULTANT_ROW = { id: 'cons-1', user_id: 'u-cons', recruiter_id: 'rec-old' };
const OLD_REC_ROW = { id: 'rec-old', user_id: 'u-old-recruiter' };
const NEW_REC_ROW = { id: 'rec-new', user_id: 'u-new-recruiter' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('consultants.assignRecruiter — validation + audit', () => {
  it('returns 400 when recruiter_id is missing from body', async () => {
    const { err } = await call(consultants.assignRecruiter as Handler, MANAGER_USER, {
      body: {},
      params: { id: 'cons-1' },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 404 when the consultant does not exist', async () => {
    mock.rows.consultants = []; // empty — consultant not found
    mock.rows.recruiters = [NEW_REC_ROW];
    const { err } = await call(consultants.assignRecruiter as Handler, MANAGER_USER, {
      body: { recruiter_id: 'rec-new' },
      params: { id: 'cons-missing' },
    });
    expect(err?.status).toBe(404);
  });

  it('returns 400 when recruiter_id does not point to a real recruiter', async () => {
    mock.rows.consultants = [CONSULTANT_ROW];
    mock.rows.recruiters = []; // no recruiter found
    const { err } = await call(consultants.assignRecruiter as Handler, MANAGER_USER, {
      body: { recruiter_id: 'rec-nonexistent' },
      params: { id: 'cons-1' },
    });
    expect(err?.status).toBe(400);
  });

  it('emits an audit event on successful assignment', async () => {
    mock.rows.consultants = [CONSULTANT_ROW, OLD_REC_ROW]; // old rec looked up by id
    mock.rows.recruiters = [OLD_REC_ROW, NEW_REC_ROW];
    const { err } = await call(consultants.assignRecruiter as Handler, MANAGER_USER, {
      body: { recruiter_id: 'rec-new' },
      params: { id: 'cons-1' },
    });
    expect(err).toBeNull();
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consultant_recruiter_assigned' }),
    );
  });

  it('calls invalidatePermissionCache for the old and new recruiter users', async () => {
    mock.rows.consultants = [CONSULTANT_ROW, OLD_REC_ROW];
    mock.rows.recruiters = [OLD_REC_ROW, NEW_REC_ROW];
    const { err } = await call(consultants.assignRecruiter as Handler, MANAGER_USER, {
      body: { recruiter_id: 'rec-new' },
      params: { id: 'cons-1' },
    });
    expect(err).toBeNull();
    // Permission cache must be cleared for the new recruiter's user
    expect(invalidateSpy).toHaveBeenCalledWith('u-new-recruiter');
  });
});
