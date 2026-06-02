/**
 * Tests for cross-group co-management in the central scope chokepoint
 * `managerGroupUserIds` — extending a lead's visible-user set to UNION their home
 * group with any groups granted via manager_group_grants. This is what propagates
 * co-management to the recruiters/consultants/pipeline lists and every
 * leadCanAccessUser-gated mutation.
 *
 * The DB mock filters rows by the recorded `.eq()` filters so home (g1) vs
 * granted (g2) group members are distinguishable, and can simulate the grants
 * table being unmigrated (errorTables).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  errorTables: new Set<string>(),
}));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const resolve = () => {
      if (mock.errorTables.has(table)) {
        return { data: null, error: { message: `relation "${table}" does not exist` } };
      }
      let data = (mock.rows[table] ?? []) as any[];
      for (const [col, val] of eqs) data = data.filter((r) => r[col] === val);
      return { data, error: null };
    };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (col: string, val: unknown) => {
        eqs.push([col, val]);
        return b;
      },
      in: () => b,
      order: () => b,
      maybeSingle: () => {
        const r = resolve();
        return Promise.resolve({ data: (r.data ?? [])[0] ?? null, error: r.error });
      },
      single: () => {
        const r = resolve();
        return Promise.resolve({ data: (r.data ?? [])[0] ?? null, error: r.error });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(res, rej),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

import { managerGroupUserIds, leadCanAccessUser } from './groupScope';

const MGR = { id: 'm1', role: 'MANAGER' as const };

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.errorTables.clear();
  mock.rows.users = [
    { id: 'u1', group_id: 'g1' },
    { id: 'u2', group_id: 'g1' },
    { id: 'u3', group_id: 'g2' },
  ];
});

describe('managerGroupUserIds — co-management union', () => {
  it('unions the home group with a granted group (de-duped)', async () => {
    mock.rows.manager_group_grants = [{ manager_id: 'm1', group_id: 'g2' }];
    const ids = await managerGroupUserIds({ ...MGR, group_id: 'g1' });
    expect(new Set(ids)).toEqual(new Set(['u1', 'u2', 'u3']));
  });

  it('returns home-group ids only when there are no grants', async () => {
    mock.rows.manager_group_grants = [];
    const ids = await managerGroupUserIds({ ...MGR, group_id: 'g1' });
    expect(new Set(ids)).toEqual(new Set(['u1', 'u2']));
  });

  it('degrades to home-group only when the grants table is unmigrated', async () => {
    mock.errorTables.add('manager_group_grants');
    const ids = await managerGroupUserIds({ ...MGR, group_id: 'g1' });
    expect(new Set(ids)).toEqual(new Set(['u1', 'u2']));
  });

  it('returns null (unscoped) for admin-tier callers', async () => {
    const ids = await managerGroupUserIds({ id: 'd1', role: 'DIRECTOR', group_id: null });
    expect(ids).toBeNull();
  });

  it('returns null for non-lead callers (RECRUITER)', async () => {
    const ids = await managerGroupUserIds({ id: 'r1', role: 'RECRUITER', group_id: 'g1' });
    expect(ids).toBeNull();
  });

  it('returns the granted group when the lead has no home group', async () => {
    mock.rows.manager_group_grants = [{ manager_id: 'm1', group_id: 'g2' }];
    const ids = await managerGroupUserIds({ ...MGR, group_id: null });
    expect(new Set(ids)).toEqual(new Set(['u3']));
  });

  it('fail-closed: no home group and no grants → empty set', async () => {
    mock.rows.manager_group_grants = [];
    const ids = await managerGroupUserIds({ ...MGR, group_id: null });
    expect(ids).toEqual([]);
  });
});

describe('leadCanAccessUser — propagation to mutation guards', () => {
  it('grants access to a user in a granted group', async () => {
    mock.rows.manager_group_grants = [{ manager_id: 'm1', group_id: 'g2' }];
    expect(await leadCanAccessUser({ ...MGR, group_id: 'g1' }, 'u3')).toBe(true);
  });

  it('denies access to a user outside home + granted groups', async () => {
    mock.rows.manager_group_grants = [{ manager_id: 'm1', group_id: 'g2' }];
    expect(await leadCanAccessUser({ ...MGR, group_id: 'g1' }, 'u-other')).toBe(false);
  });
});
