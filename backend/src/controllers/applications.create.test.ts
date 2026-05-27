/**
 * Regression test for the applications.create mass-assignment fix (audit
 * HIGH). The create handler now validates req.body against a `.strict()` Zod
 * allowlist, so a caller can no longer set the server-controlled `recruiter_id`
 * (or any other column) on a new application. See .claude/rules/security.md.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({ inserted: null as Record<string, unknown> | null }));

vi.mock('../config/db', () => {
  function builder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      insert(payload: Record<string, unknown>) {
        mock.inserted = payload;
        return b;
      },
      single: () => Promise.resolve({ data: { id: 'app-new' }, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      // The duplicate-guard query is awaited directly → resolves to no dups.
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: () => builder() }, pool: {} };
});
vi.mock('../services/ai.service', () => ({ atsScore: vi.fn() }));

import { create } from './applications.controller';

const ADMIN = { id: 'u-admin', role: 'SUPER_ADMIN', email: 'a@x.test' };

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

async function call(body: unknown): Promise<{ status?: number } | null> {
  try {
    await (create as any)({ body, user: ADMIN }, mkRes(), vi.fn());
    return null;
  } catch (e) {
    return e as { status?: number };
  }
}

beforeEach(() => {
  mock.inserted = null;
});

describe('applications.create — mass-assignment guard', () => {
  it('rejects an attacker-supplied recruiter_id', async () => {
    const err = await call({ consultant_id: 'c-1', job_id: 'j-1', recruiter_id: 'r-attacker' });
    expect(err?.status).toBe(400);
    expect(mock.inserted).toBeNull();
  });

  it('rejects unknown / server-controlled columns (strict schema)', async () => {
    const err = await call({
      consultant_id: 'c-1',
      job_id: 'j-1',
      created_by: 'u-x',
      status_changed_by: 'u-x',
    });
    expect(err?.status).toBe(400);
  });

  it('inserts only whitelisted fields and drops the consumed `force` flag', async () => {
    const err = await call({ consultant_id: 'c-1', job_id: 'j-1', notes: 'hi', force: true });
    expect(err).toBeNull();
    expect(mock.inserted).toMatchObject({ consultant_id: 'c-1', job_id: 'j-1', notes: 'hi' });
    expect(mock.inserted).not.toHaveProperty('force');
    expect(mock.inserted).not.toHaveProperty('recruiter_id');
  });

  it('returns 403 when a group lead creates an application for an out-of-group consultant', async () => {
    // Group lead with an empty group → leadCanAccessConsultant is false →
    // fail-closed. No insert should happen.
    const res = mkRes();
    let err: { status?: number } | null = null;
    try {
      await (create as any)(
        {
          body: { consultant_id: 'c-1', job_id: 'j-1' },
          user: { id: 'u-lead', role: 'MANAGER', group_id: 'g1', email: 'l@x.test' },
        },
        res,
        vi.fn(),
      );
    } catch (e) {
      err = e as { status?: number };
    }
    expect(err?.status).toBe(403);
    expect(mock.inserted).toBeNull();
  });
});
