/**
 * Security regression tests for the canonical scope guards in groupScope.ts
 * (assertCanAccessUser / assertCanAccessConsultant / assertCanAccessRecruiter /
 * assertCanAssignGroup). These are the single source of truth that the
 * controllers delegate to, so pinning them here covers the direct-API attack
 * surface for the group-lead / recruiter / consultant tiers:
 *
 *   - ADMIN_TIER            → unscoped
 *   - GROUP LEAD (HR/MGR)   → own group only; FAIL-CLOSED with no/empty group
 *   - RECRUITER             → own assigned rows / self
 *   - CONSULTANT            → self only
 *
 * DB is mocked at module load (no Postgres / env), per the permission.service
 * test pattern.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {};
  return { rows };
});

vi.mock('../config/db', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      in: () => b,
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.rows[table] ?? [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});

import {
  assertCanAccessUser,
  assertCanAccessConsultant,
  assertCanAccessRecruiter,
  assertCanAssignGroup,
} from './groupScope';

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
});

const ADMIN = { id: 'u-dir', role: 'DIRECTOR' as const };
const LEAD = { id: 'u-lead', role: 'HR_MANAGER' as const, group_id: 'g1' };
const RECRUITER = { id: 'u-rec', role: 'RECRUITER' as const };
const CONSULTANT = { id: 'u-cons', role: 'CONSULTANT' as const };

async function throws(p: Promise<void>): Promise<number | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { status?: number }).status;
  }
}

describe('assertCanAssignGroup', () => {
  it('allows null group for anyone', () => {
    expect(() => assertCanAssignGroup(RECRUITER, null)).not.toThrow();
  });
  it('admin may assign any group', () => {
    expect(() => assertCanAssignGroup(ADMIN, 'g-other')).not.toThrow();
  });
  it('non-admin may assign only their own group', () => {
    expect(() => assertCanAssignGroup(LEAD, 'g1')).not.toThrow();
    expect(() => assertCanAssignGroup(LEAD, 'g-other')).toThrow(/your own group/i);
  });
  it('a recruiter cannot pass an arbitrary group_id', () => {
    expect(() => assertCanAssignGroup({ ...RECRUITER, group_id: 'g1' }, 'g-attacker')).toThrow();
  });
});

describe('assertCanAccessUser', () => {
  it('admin unscoped', async () => {
    expect(await throws(assertCanAccessUser(ADMIN, 'anybody'))).toBeUndefined();
  });
  it('self always allowed', async () => {
    expect(await throws(assertCanAccessUser(RECRUITER, RECRUITER.id))).toBeUndefined();
  });
  it('group lead: in-group allowed, out-of-group 403', async () => {
    mock.rows.users = [{ id: 'u-member' }];
    expect(await throws(assertCanAccessUser(LEAD, 'u-member'))).toBeUndefined();
    mock.rows.users = [];
    expect(await throws(assertCanAccessUser(LEAD, 'u-outsider'))).toBe(403);
  });
  it('a plain recruiter cannot access an arbitrary user', async () => {
    expect(await throws(assertCanAccessUser(RECRUITER, 'someone-else'))).toBe(403);
  });
});

describe('assertCanAccessConsultant', () => {
  it('admin unscoped', async () => {
    mock.rows.consultants = [{ id: 'c1', user_id: 'cu', recruiter_id: 'r1' }];
    expect(await throws(assertCanAccessConsultant(ADMIN, 'c1'))).toBeUndefined();
  });
  it('group lead: out-of-group consultant 403 (fail-closed)', async () => {
    mock.rows.consultants = [{ id: 'c1', user_id: 'cu', recruiter_id: 'r1' }];
    mock.rows.users = []; // empty group
    expect(await throws(assertCanAccessConsultant(LEAD, 'c1'))).toBe(403);
  });
  it('recruiter: own consultant allowed, other 403', async () => {
    mock.rows.consultants = [{ id: 'c1', user_id: 'cu', recruiter_id: 'r-mine' }];
    mock.rows.recruiters = [{ id: 'r-mine' }];
    expect(await throws(assertCanAccessConsultant(RECRUITER, 'c1'))).toBeUndefined();
    mock.rows.consultants = [{ id: 'c1', user_id: 'cu', recruiter_id: 'r-other' }];
    mock.rows.recruiters = [{ id: 'r-mine' }];
    expect(await throws(assertCanAccessConsultant(RECRUITER, 'c1'))).toBe(403);
  });
  it('consultant: self allowed, other 403', async () => {
    mock.rows.consultants = [{ id: 'c1', user_id: CONSULTANT.id, recruiter_id: 'r1' }];
    expect(await throws(assertCanAccessConsultant(CONSULTANT, 'c1'))).toBeUndefined();
    mock.rows.consultants = [{ id: 'c1', user_id: 'someone-else', recruiter_id: 'r1' }];
    expect(await throws(assertCanAccessConsultant(CONSULTANT, 'c1'))).toBe(403);
  });
});

describe('assertCanAccessRecruiter', () => {
  it('admin unscoped', async () => {
    mock.rows.recruiters = [{ id: 'r1', user_id: 'ru' }];
    expect(await throws(assertCanAccessRecruiter(ADMIN, 'r1'))).toBeUndefined();
  });
  it('recruiter: own row allowed', async () => {
    mock.rows.recruiters = [{ id: 'r1', user_id: RECRUITER.id }];
    expect(await throws(assertCanAccessRecruiter(RECRUITER, 'r1'))).toBeUndefined();
  });
  it('group lead: out-of-group recruiter 403 (fail-closed)', async () => {
    mock.rows.recruiters = [{ id: 'r1', user_id: 'ru' }];
    mock.rows.users = []; // empty group
    expect(await throws(assertCanAccessRecruiter(LEAD, 'r1'))).toBe(403);
  });
});
