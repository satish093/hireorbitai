/**
 * Rank-protection tests for the User Groups move endpoints.
 *
 * The route gate (requireRoleOrCapability(ADMIN_TIER, 'user_groups')) only
 * checks the CALLER's tier — without a per-target rank check, a DIRECTOR or a
 * DEVELOPER+user_groups could move a SUPER_ADMIN between groups, which is a
 * privilege-escalation surface via group-scoped feature-flag overrides.
 *
 * canMoveUser inside the controller now enforces:
 *   SUPER_ADMIN              → anyone
 *   Target SUPER_ADMIN       → never (no one else can touch a SUPER_ADMIN)
 *   DEVELOPER + user_groups  → NOT ADMIN_TIER and NOT DEVELOPER
 *   CEO/CTO/DIRECTOR         → canAssignRole (strict outrank, no SA-only)
 *
 * DB mocked at module load (no Postgres / env), per the permission.service pattern.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {};
  const updates: { table: string; payload: unknown }[] = [];
  return { rows, updates };
});

vi.mock('../config/db', () => {
  function builder(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return b;
      },
      update: (payload: unknown) => {
        mock.updates.push({ table, payload });
        return b;
      },
      apply() {
        return (mock.rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
      },
      maybeSingle: () => Promise.resolve({ data: (b as any).apply()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (b as any).apply()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: (b as any).apply(),
          error: null,
          count: (b as any).apply().length,
        }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

import { assignOne, setMembers } from './userGroups.controller';

const GROUP_A = '00000000-0000-4000-8000-000000000001';
const GROUP_B = '00000000-0000-4000-8000-000000000002';
const U_SA = '11111111-1111-4111-8111-111111111111';
const U_CEO = '11111111-1111-4111-8111-111111111112';
const U_DIR = '11111111-1111-4111-8111-111111111113';
const U_MGR = '11111111-1111-4111-8111-111111111114';
const U_REC = '11111111-1111-4111-8111-111111111115';
const U_DEV = '11111111-1111-4111-8111-111111111116';

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

async function call(handler: any, user: any, body: any, params: any = {}): Promise<{ err: any }> {
  const res = mkRes();
  try {
    await handler({ user, body, params, query: {} }, res, vi.fn());
    return { err: null };
  } catch (e) {
    return { err: e };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.updates.length = 0;
  // Two groups so the "target group exists" check passes for valid moves.
  mock.rows.user_groups = [{ id: GROUP_A }, { id: GROUP_B }];
  mock.rows.users = [
    { id: U_SA, email: 'sa@x.test', role: 'SUPER_ADMIN', group_id: null },
    { id: U_CEO, email: 'ceo@x.test', role: 'CEO', group_id: null },
    { id: U_DIR, email: 'dir@x.test', role: 'DIRECTOR', group_id: null },
    { id: U_MGR, email: 'mgr@x.test', role: 'MANAGER', group_id: GROUP_A },
    { id: U_REC, email: 'rec@x.test', role: 'RECRUITER', group_id: GROUP_A },
    { id: U_DEV, email: 'dev@x.test', role: 'DEVELOPER', group_id: null },
  ];
});

const DIRECTOR = { id: U_DIR, role: 'DIRECTOR' as const };
const SUPER_ADMIN = { id: U_SA, role: 'SUPER_ADMIN' as const };
const DEVELOPER = { id: U_DEV, role: 'DEVELOPER' as const };

describe('userGroups.assignOne — rank protection', () => {
  it('DIRECTOR CANNOT move a SUPER_ADMIN', async () => {
    const { err } = await call(assignOne, DIRECTOR, { user_id: U_SA, group_id: GROUP_B });
    expect(err?.status).toBe(403);
    expect(mock.updates.find((u) => u.table === 'users')).toBeUndefined();
  });

  it('DIRECTOR CANNOT move a CEO (equal/higher rank)', async () => {
    const { err } = await call(assignOne, DIRECTOR, { user_id: U_CEO, group_id: GROUP_B });
    expect(err?.status).toBe(403);
  });

  it('DIRECTOR CAN move a MANAGER (strictly outranks)', async () => {
    const { err } = await call(assignOne, DIRECTOR, { user_id: U_MGR, group_id: GROUP_B });
    expect(err).toBeNull();
    expect(mock.updates.some((u) => u.table === 'users')).toBe(true);
  });

  it('SUPER_ADMIN CAN move another SUPER_ADMIN (absolute)', async () => {
    const { err } = await call(assignOne, SUPER_ADMIN, { user_id: U_SA, group_id: GROUP_B });
    expect(err).toBeNull();
  });

  it('DEVELOPER+user_groups CANNOT move SUPER_ADMIN / CEO / DIRECTOR / another DEVELOPER', async () => {
    for (const target of [U_SA, U_CEO, U_DIR, U_DEV]) {
      mock.updates.length = 0;
      const { err } = await call(assignOne, DEVELOPER, { user_id: target, group_id: GROUP_B });
      expect(err?.status).toBe(403);
      expect(mock.updates.find((u) => u.table === 'users')).toBeUndefined();
    }
  });

  it('DEVELOPER+user_groups CAN move MANAGER / RECRUITER (below admin-tier)', async () => {
    for (const target of [U_MGR, U_REC]) {
      mock.updates.length = 0;
      const { err } = await call(assignOne, DEVELOPER, { user_id: target, group_id: GROUP_B });
      expect(err).toBeNull();
    }
  });

  it('rejects assignment to a non-existent group', async () => {
    const FAKE = '99999999-9999-4999-8999-999999999999';
    const { err } = await call(assignOne, DIRECTOR, { user_id: U_MGR, group_id: FAKE });
    expect(err?.status).toBe(404);
  });

  it("allows clearing a user's group_id (group_id = null) without a group lookup", async () => {
    const { err } = await call(assignOne, DIRECTOR, { user_id: U_MGR, group_id: null });
    expect(err).toBeNull();
  });
});

describe('userGroups.setMembers — bulk rank protection', () => {
  it('DIRECTOR bulk-adding a SUPER_ADMIN among the batch is rejected (whole batch)', async () => {
    const { err } = await call(
      setMembers,
      DIRECTOR,
      { user_ids: [U_MGR, U_REC, U_SA] },
      { id: GROUP_B },
    );
    expect(err?.status).toBe(403);
    expect(mock.updates.find((u) => u.table === 'users')).toBeUndefined();
  });

  it('DIRECTOR bulk-adding only allowed targets succeeds', async () => {
    const { err } = await call(setMembers, DIRECTOR, { user_ids: [U_MGR, U_REC] }, { id: GROUP_B });
    expect(err).toBeNull();
    expect(mock.updates.some((u) => u.table === 'users')).toBe(true);
  });

  it('rejects bulk-add to a non-existent target group', async () => {
    const FAKE = '99999999-9999-4999-8999-999999999999';
    const { err } = await call(setMembers, DIRECTOR, { user_ids: [U_MGR] }, { id: FAKE });
    expect(err?.status).toBe(404);
  });

  it('rejects when any user_id does not exist', async () => {
    const FAKE = '99999999-9999-4999-8999-999999999911';
    const { err } = await call(setMembers, DIRECTOR, { user_ids: [U_MGR, FAKE] }, { id: GROUP_B });
    expect(err?.status).toBe(404);
  });
});
