/**
 * Tests for the group-move endpoints on consultants and recruiters, and the
 * recruiter scope guard on application creation.
 *
 * Covers:
 *   - Group lead can only move consultant within their own group.
 *   - Group lead blocked from cross-group consultant move.
 *   - Recruiter move blocked when their assigned consultants are in a different group.
 *   - Admin tier can move consultant/recruiter to any group.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Role } from '../types';

// ---------------------------------------------------------------------------
// DB mock - inspectable via `state`
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; group_id: string | null; role?: string }>,
  consultants: {} as Record<string, { id: string; user_id: string; recruiter_id: string | null }>,
  recruiters: {} as Record<string, { id: string; user_id: string }>,
  lastUserUpdate: null as { id: string; group_id: string | null } | null,
}));

vi.mock('../config/db', () => {
  function builder(table: string) {
    let _eq: Record<string, string> = {};
    let _in: { col: string; vals: string[] } | null = null;
    let _updatePatch: Record<string, unknown> | null = null;
    const b: Record<string, unknown> = {};

    Object.assign(b, {
      select: () => b,
      eq(col: string, val: string) {
        _eq[col] = val;
        if (table === 'users' && col === 'id' && _updatePatch) {
          state.lastUserUpdate = { id: val, group_id: _updatePatch['group_id'] as string | null };
        }
        return b;
      },
      in(col: string, vals: string[]) {
        _in = { col, vals };
        return b;
      },
      not: () => b,
      order: () => b,
      limit: () => b,
      update(patch: Record<string, unknown>) {
        _updatePatch = patch;
        return b;
      },
      delete: () => b,
      upsert: () => b,
      insert: () => b,
      single: () => Promise.resolve({ data: state.users[_eq['id'] ?? ''] ?? null, error: null }),
      maybeSingle() {
        if (table === 'consultants') {
          const id = _eq['id'] ?? _eq['user_id'];
          const row =
            Object.values(state.consultants).find((c) => c.id === id || c.user_id === id) ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        if (table === 'recruiters') {
          const id = _eq['id'] ?? _eq['user_id'];
          const row =
            Object.values(state.recruiters).find((r) => r.id === id || r.user_id === id) ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        if (table === 'users') {
          const id = _eq['id'];
          return Promise.resolve({ data: state.users[id ?? ''] ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        // Used by queries that destructure { data, error } directly.
        if (table === 'consultants' && _in?.col === 'recruiter_id') {
          const vals = _in.vals;
          const rows = Object.values(state.consultants).filter(
            (c) => c.recruiter_id && vals.includes(c.recruiter_id),
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }
        if (table === 'consultants' && _eq['recruiter_id']) {
          const rows = Object.values(state.consultants).filter(
            (c) => c.recruiter_id === _eq['recruiter_id'],
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }
        if (table === 'users' && _in?.col === 'id') {
          const vals = _in.vals;
          const rows = vals.map((id) => state.users[id]).filter(Boolean);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }
        if (table === 'users' && _eq['group_id']) {
          const gid = _eq['group_id'];
          const rows = Object.values(state.users).filter((u) => u.group_id === gid);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});

vi.mock('../services/permission.service', () => ({ invalidatePermissionCache: vi.fn() }));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { moveGroup as consultantMoveGroup } from './consultants.controller';
import { moveGroup as recruiterMoveGroup } from './recruiters.controller';
import { assertCanAccessConsultant } from '../services/groupScope';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mkRes() {
  const r: any = {
    statusCode: 200,
    body: null,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return r;
}

async function callMoveConsultantGroup(
  caller: Record<string, unknown>,
  consultantId: string,
  groupId: string | null,
  recruiterId?: string | null,
): Promise<{ status?: number } | null> {
  try {
    await (consultantMoveGroup as any)(
      {
        user: caller,
        params: { id: consultantId },
        body: { group_id: groupId, recruiter_id: recruiterId },
      },
      mkRes(),
      vi.fn(),
    );
    return null;
  } catch (e) {
    return e as { status?: number };
  }
}

async function callMoveRecruiterGroup(
  caller: Record<string, unknown>,
  recruiterId: string,
  groupId: string | null,
  confirm = false,
  managerId?: string | null,
): Promise<{ status?: number } | null> {
  try {
    await (recruiterMoveGroup as any)(
      {
        user: caller,
        params: { id: recruiterId },
        body: {
          group_id: groupId,
          manager_id: managerId,
          confirm_unassign_consultants: confirm,
        },
      },
      mkRes(),
      vi.fn(),
    );
    return null;
  } catch (e) {
    return e as { status?: number };
  }
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const R_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M_G1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M_G2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ADMIN_USER = {
  id: 'u-admin',
  role: 'SUPER_ADMIN' as Role,
  email: 'a@x.test',
  group_id: null,
};
const LEAD_G1 = { id: 'u-lead', role: 'MANAGER' as Role, email: 'l@x.test', group_id: G1 };
const RECRUITER_A = {
  id: 'u-rec-a',
  role: 'RECRUITER' as Role,
  email: 'ra@x.test',
  group_id: G1,
};

// Seed state shared across tests (reset per describe where needed).
state.users = {
  'u-cons-1': { id: 'u-cons-1', group_id: G1 },
  'u-cons-2': { id: 'u-cons-2', group_id: G2 },
  'u-rec-a': { id: 'u-rec-a', group_id: G1 },
  'u-lead': { id: 'u-lead', group_id: G1, role: 'MANAGER' },
  [M_G1]: { id: M_G1, group_id: G1, role: 'MANAGER' },
  [M_G2]: { id: M_G2, group_id: G2, role: 'MANAGER' },
};
state.consultants = {
  'c-1': { id: 'c-1', user_id: 'u-cons-1', recruiter_id: R_A },
  'c-2': { id: 'c-2', user_id: 'u-cons-2', recruiter_id: null },
};
state.recruiters = {
  [R_A]: { id: R_A, user_id: 'u-rec-a' },
};

// ---------------------------------------------------------------------------
// Recruiter -> consultant scope (assertCanAccessConsultant)
// ---------------------------------------------------------------------------
describe('assertCanAccessConsultant - recruiter scope', () => {
  it('allows a recruiter to access their own assigned consultant', async () => {
    // c-1 has recruiter_id = R_A; RECRUITER_A owns R_A
    await expect(assertCanAccessConsultant(RECRUITER_A, 'c-1')).resolves.toBeUndefined();
  });

  it("blocks a recruiter from accessing another recruiter's consultant", async () => {
    // c-2 has recruiter_id = null - not assigned to r-a
    await expect(assertCanAccessConsultant(RECRUITER_A, 'c-2')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('blocks a recruiter from accessing a totally unknown consultant', async () => {
    await expect(assertCanAccessConsultant(RECRUITER_A, 'c-unknown')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('allows admin tier unscoped access', async () => {
    await expect(assertCanAccessConsultant(ADMIN_USER, 'c-2')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Consultant group move
// ---------------------------------------------------------------------------
describe('consultants.moveGroup', () => {
  beforeEach(() => {
    state.lastUserUpdate = null;
  });

  it('admin can move consultant to any group', async () => {
    const err = await callMoveConsultantGroup(ADMIN_USER, 'c-2', G1, R_A);
    expect(err).toBeNull();
    expect(state.lastUserUpdate).toMatchObject({ id: 'u-cons-2', group_id: G1 });
  });

  it('group lead can move in-group consultant to own group', async () => {
    // c-1 user is in G1, LEAD_G1 group is G1, target is G1 (no-op but valid)
    const err = await callMoveConsultantGroup(LEAD_G1, 'c-1', G1, R_A);
    expect(err).toBeNull();
  });

  it('group lead cannot move consultant to a different group', async () => {
    const err = await callMoveConsultantGroup(LEAD_G1, 'c-1', G2);
    expect(err?.status).toBe(403);
  });

  it('group lead cannot move a consultant not in their group', async () => {
    // c-2 user is in G2, LEAD_G1 group is G1
    const err = await callMoveConsultantGroup(LEAD_G1, 'c-2', G1);
    expect(err?.status).toBe(403);
  });

  it('recruiter is forbidden from moving consultant group', async () => {
    const err = await callMoveConsultantGroup(RECRUITER_A, 'c-1', G2);
    expect(err?.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Recruiter group move
// ---------------------------------------------------------------------------
describe('recruiters.moveGroup', () => {
  beforeEach(() => {
    state.lastUserUpdate = null;
  });

  it('admin can move recruiter to any group', async () => {
    // R_A user is in G1; move to G1 (same group - no consultant mismatch)
    const err = await callMoveRecruiterGroup(ADMIN_USER, R_A, G1);
    expect(err).toBeNull();
    expect(state.lastUserUpdate).toMatchObject({ id: 'u-rec-a', group_id: G1 });
  });

  it('blocks move when assigned consultants are in a different group', async () => {
    // Assign c-1 to R_A; c-1 user is in G1. Try to move R_A to G2:
    // c-1 user.group_id (G1) !== target (G2) => 409.
    state.consultants['c-1'].recruiter_id = R_A;
    state.users['u-cons-1'].group_id = G1;

    const err = await callMoveRecruiterGroup(ADMIN_USER, R_A, G2, false, M_G2);
    expect(err?.status).toBe(409);
    expect(state.lastUserUpdate).toBeNull(); // no write should happen
  });

  it('allows confirmed move and unassigns consultants', async () => {
    // Move c-1 user to G2 first so it matches the target.
    state.users['u-cons-1'].group_id = G2;
    state.consultants['c-1'].recruiter_id = R_A;

    const err = await callMoveRecruiterGroup(ADMIN_USER, R_A, G2, true, M_G2);
    expect(err).toBeNull();
    expect(state.lastUserUpdate).toMatchObject({ id: 'u-rec-a', group_id: G2 });
  });
});
