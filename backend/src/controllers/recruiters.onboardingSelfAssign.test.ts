/**
 * Regression test for the recruiter self-onboard mass-assignment bug.
 *
 * Previously: `onboardingSchema` was non-strict and listed `manager_id` as a
 * field. A RECRUITER could POST {full_name:'…', manager_id:'<super-admin-id>'}
 * to /recruiters/onboard, the upsert wrote the value into
 * `recruiters.manager_id`, which is one of the union arms behind
 * `public.v_user_relationships` — the source of truth for canMessageUser /
 * canViewConversation / canViewProfile. invalidatePermissionCache fires
 * inside the controller path, so the forged edge is live immediately.
 *
 * Fix: schema is `.strict()` AND drops `manager_id`. Manager assignment
 * stays behind addManager / setPrimaryManager / removeManager / moveGroup,
 * which validate role + group + outranking.
 *
 * Test shape:
 *  - body containing manager_id → 400 (unknown key)
 *  - body containing recruiter_id / user_id → 400 (unknown key)
 *  - clean body → upsert payload contains the safe fields ONLY (no
 *    manager_id even if a real one is sent alongside)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  upserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      update(payload: Record<string, unknown>) {
        mock.updates.push({ table, payload });
        return b;
      },
      upsert(payload: Record<string, unknown>) {
        mock.upserts.push({ table, payload });
        return b;
      },
      single: async () => ({ data: { id: 'r-1', user_id: 'u-rec' }, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

vi.mock('../services/permission.service', () => ({
  invalidatePermissionCache: vi.fn(),
}));
vi.mock('../services/groupScope', () => ({
  managerGroupUserIds: vi.fn(async () => null),
  isAdminTier: () => false,
  isGroupLead: () => false,
  leadCanAccessUser: vi.fn(async () => true),
}));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { onboard } from './recruiters.controller';

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
  body: unknown,
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await (onboard as any)(
      {
        user: { id: 'u-rec', role: 'RECRUITER', email: 'r@x.test' },
        body,
        params: {},
      },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  mock.upserts.length = 0;
  mock.updates.length = 0;
});

describe('recruiters.onboard — strict schema + no authority columns', () => {
  it('400s when body contains manager_id (forged permission edge attempt)', async () => {
    const { err } = await call({
      full_name: 'Self-Assigned Attacker',
      manager_id: '00000000-0000-0000-0000-000000000001',
    });
    expect(err?.status).toBe(400);
    // No DB write should have happened.
    expect(mock.upserts.find((u) => u.table === 'recruiters')).toBeUndefined();
  });

  it('400s when body contains recruiter_id (server-controlled FK)', async () => {
    const { err } = await call({
      full_name: 'X',
      recruiter_id: 'r-attacker',
    });
    expect(err?.status).toBe(400);
    expect(mock.upserts).toHaveLength(0);
  });

  it('400s when body contains user_id (would re-target the row to another user)', async () => {
    const { err } = await call({
      full_name: 'X',
      user_id: 'u-victim',
    });
    expect(err?.status).toBe(400);
    expect(mock.upserts).toHaveLength(0);
  });

  it('accepts a clean body and writes ONLY the safe fields to recruiters', async () => {
    const { err } = await call({
      full_name: 'Real Name',
      phone: '+15555550100',
      team: 'East',
      target_submissions_per_week: 12,
      notes: 'hi',
    });
    expect(err).toBeNull();
    const recruiterUpsert = mock.upserts.find((u) => u.table === 'recruiters');
    expect(recruiterUpsert).toBeDefined();
    expect(recruiterUpsert!.payload).toMatchObject({
      user_id: 'u-rec',
      team: 'East',
      target_submissions_per_week: 12,
      notes: 'hi',
    });
    // Authority columns must never reach the recruiters upsert via onboard.
    expect(recruiterUpsert!.payload).not.toHaveProperty('manager_id');
    expect(recruiterUpsert!.payload).not.toHaveProperty('recruiter_id');
    expect(recruiterUpsert!.payload).not.toHaveProperty('role');
    // The personal fields full_name + phone go to users, not recruiters.
    const userUpdate = mock.updates.find((u) => u.table === 'users');
    expect(userUpdate?.payload).toMatchObject({ full_name: 'Real Name', phone: '+15555550100' });
  });
});
