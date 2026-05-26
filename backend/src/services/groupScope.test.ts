/**
 * Group-scoped visibility helper. Only MANAGER is confined to its group;
 * HR_MANAGER + admin-tier see all groups (null = no scope). A MANAGER without a
 * group is fail-closed to an empty set (sees nobody), never org-wide.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = vi.hoisted(() => ({
  groupUserRows: [{ id: 'u1' }, { id: 'u2' }] as { id: string }[],
}));

vi.mock('../config/db', () => {
  function builder() {
    const b: any = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      in: () => b,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.groupUserRows, error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: () => builder() } };
});

import { managerGroupUserIds } from './groupScope';

beforeEach(() => {
  mock.groupUserRows = [{ id: 'u1' }, { id: 'u2' }];
});

describe('managerGroupUserIds', () => {
  it('returns null (no scope) for HR_MANAGER and admin-tier', async () => {
    expect(await managerGroupUserIds({ role: 'HR_MANAGER', group_id: 'g1' })).toBeNull();
    expect(await managerGroupUserIds({ role: 'DIRECTOR', group_id: null })).toBeNull();
    expect(await managerGroupUserIds({ role: 'SUPER_ADMIN' })).toBeNull();
  });

  it('returns the group user ids for a MANAGER with a group', async () => {
    expect(await managerGroupUserIds({ role: 'MANAGER', group_id: 'g1' })).toEqual(['u1', 'u2']);
  });

  it('fail-closes to an empty set for a MANAGER with no group', async () => {
    expect(await managerGroupUserIds({ role: 'MANAGER', group_id: null })).toEqual([]);
    expect(await managerGroupUserIds({ role: 'MANAGER' })).toEqual([]);
  });
});
