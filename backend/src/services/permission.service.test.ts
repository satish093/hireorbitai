/**
 * Permission engine — final policy.
 *
 * Verifies every case from the product spec:
 *   - SUPER_ADMIN can chat with everyone.
 *   - CEO / CTO / DIRECTOR can chat with everyone.
 *   - HR_MANAGER / MANAGER can chat with all managers + HR managers (org-wide).
 *   - HR_MANAGER / MANAGER can chat with admin leadership.
 *   - HR_MANAGER / MANAGER can chat with recruiters in their own group.
 *   - HR_MANAGER / MANAGER can chat with consultants in their own group.
 *   - HR_MANAGER / MANAGER cannot chat with unrelated consultants.
 *   - RECRUITER can chat with all other recruiters.
 *   - RECRUITER can chat with own manager / HR chain.
 *   - RECRUITER can chat with own assigned consultants.
 *   - RECRUITER cannot chat with other recruiters' consultants.
 *   - CONSULTANT can chat with assigned recruiter.
 *   - CONSULTANT can chat with that recruiter's manager chain.
 *   - CONSULTANT cannot chat with other consultants / unrelated recruiters.
 *   - DEVELOPER has no chat.
 *   - No reports_to chain. No prior-thread carry-over.
 *
 * DB mocked at module load — no Postgres / env needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const handlers: Map<string, (filters: Record<string, unknown>) => unknown[]> = new Map();
  return { handlers };
});

vi.mock('../config/db', () => {
  type R = { data: unknown; error: null; count?: number };
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    const builder = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        filters.__head = !!opts?.head;
        return builder;
      },
      eq(col: string, value: unknown) {
        filters[`eq:${col}`] = value;
        return builder;
      },
      neq(col: string, value: unknown) {
        filters[`neq:${col}`] = value;
        return builder;
      },
      is(col: string, value: unknown) {
        filters[`is:${col}`] = value;
        return builder;
      },
      in(col: string, value: unknown[]) {
        filters[`in:${col}`] = value;
        return builder;
      },
      maybeSingle() {
        const rows = mock.handlers.get(table)?.(filters) ?? [];
        return Promise.resolve({ data: rows[0] ?? null, error: null } as R);
      },
      single() {
        const rows = mock.handlers.get(table)?.(filters) ?? [];
        return Promise.resolve({ data: rows[0] ?? null, error: null } as R);
      },
      then<T>(resolve: (value: R) => T) {
        const rows = mock.handlers.get(table)?.(filters) ?? [];
        return Promise.resolve({
          data: filters.__head ? null : rows,
          error: null,
          count: rows.length,
        } as R).then(resolve);
      },
    };
    return builder;
  }
  return {
    db: { from: (table: string) => makeBuilder(table) },
    pool: {},
  };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  canMessageUser,
  canViewConversation,
  getAccessibleUserIds,
  invalidatePermissionCache,
  clearPermissionCache,
} from './permission.service';

function setupDb(rows: Record<string, unknown[]>) {
  mock.handlers.clear();
  for (const [table, list] of Object.entries(rows)) {
    mock.handlers.set(table, (filters) => {
      return list.filter((row) => {
        const r = row as Record<string, unknown>;
        for (const [k, v] of Object.entries(filters)) {
          if (k.startsWith('eq:')) {
            const col = k.slice(3);
            if (r[col] !== v) return false;
          } else if (k.startsWith('neq:')) {
            const col = k.slice(4);
            if (r[col] === v) return false;
          } else if (k.startsWith('in:')) {
            const col = k.slice(3);
            if (!(v as unknown[]).includes(r[col])) return false;
          } else if (k.startsWith('is:')) {
            const col = k.slice(3);
            if (r[col] !== v) return false;
          }
        }
        return true;
      });
    });
  }
}

beforeEach(() => {
  clearPermissionCache();
  mock.handlers.clear();
});

// ─── Admin override ────────────────────────────────────────────────────────
describe('admin tier — chat with everyone', () => {
  it('SUPER_ADMIN can message any active user', async () => {
    setupDb({ users: [{ id: 'u-target', is_active: true }] });
    expect(await canMessageUser({ id: 'u-sa', role: 'SUPER_ADMIN' }, 'u-target')).toBe(true);
  });

  it('CEO / CTO / DIRECTOR can message any active user', async () => {
    setupDb({ users: [{ id: 'u-target', is_active: true }] });
    expect(await canMessageUser({ id: 'u-ceo', role: 'CEO' }, 'u-target')).toBe(true);
    expect(await canMessageUser({ id: 'u-cto', role: 'CTO' }, 'u-target')).toBe(true);
    expect(await canMessageUser({ id: 'u-dir', role: 'DIRECTOR' }, 'u-target')).toBe(true);
  });

  it('admins cannot message themselves', async () => {
    expect(await canMessageUser({ id: 'u-sa', role: 'SUPER_ADMIN' }, 'u-sa')).toBe(false);
  });

  it('admins cannot message inactive users', async () => {
    setupDb({ users: [{ id: 'u-target', is_active: false }] });
    expect(await canMessageUser({ id: 'u-sa', role: 'SUPER_ADMIN' }, 'u-target')).toBe(false);
  });
});

// ─── HR_MANAGER / MANAGER scope ────────────────────────────────────────────
describe('group lead (HR_MANAGER / MANAGER) scope', () => {
  // Fixture: two groups (A, B). Lead M in group A. Various peer + group rows.
  function fixtureManagerScope() {
    setupDb({
      users: [
        // Manager-tier peers (org-wide reachable from any lead).
        { id: 'u-mgr-a', role: 'MANAGER', is_active: true, group_id: 'g-a' },
        { id: 'u-mgr-b', role: 'MANAGER', is_active: true, group_id: 'g-b' },
        { id: 'u-hr-a', role: 'HR_MANAGER', is_active: true, group_id: 'g-a' },
        { id: 'u-hr-b', role: 'HR_MANAGER', is_active: true, group_id: 'g-b' },
        // Admin tier (upward leadership).
        { id: 'u-dir', role: 'DIRECTOR', is_active: true, group_id: null },
        { id: 'u-ceo', role: 'CEO', is_active: true, group_id: null },
        // Recruiters + consultants in each group.
        { id: 'u-rec-a', role: 'RECRUITER', is_active: true, group_id: 'g-a' },
        { id: 'u-rec-b', role: 'RECRUITER', is_active: true, group_id: 'g-b' },
        { id: 'u-cons-a', role: 'CONSULTANT', is_active: true, group_id: 'g-a' },
        { id: 'u-cons-b', role: 'CONSULTANT', is_active: true, group_id: 'g-b' },
      ],
      recruiters: [
        { id: 'r-a', user_id: 'u-rec-a', manager_id: null },
        { id: 'r-b', user_id: 'u-rec-b', manager_id: null },
      ],
      recruiter_managers: [],
      consultants: [
        { recruiter_id: 'r-a', user_id: 'u-cons-a' },
        { recruiter_id: 'r-b', user_id: 'u-cons-b' },
      ],
    });
  }

  it('MANAGER can chat with another MANAGER (any group)', async () => {
    fixtureManagerScope();
    const ok = await canMessageUser({ id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' }, 'u-mgr-b');
    expect(ok).toBe(true);
  });

  it('MANAGER can chat with an HR_MANAGER (any group)', async () => {
    fixtureManagerScope();
    expect(
      await canMessageUser({ id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' }, 'u-hr-b'),
    ).toBe(true);
  });

  it('MANAGER can chat with a DIRECTOR (admin leadership)', async () => {
    fixtureManagerScope();
    expect(await canMessageUser({ id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' }, 'u-dir')).toBe(
      true,
    );
  });

  it('MANAGER can chat with a RECRUITER in their own group', async () => {
    fixtureManagerScope();
    expect(
      await canMessageUser({ id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' }, 'u-rec-a'),
    ).toBe(true);
  });

  it('MANAGER can chat with a CONSULTANT in their own group', async () => {
    fixtureManagerScope();
    expect(
      await canMessageUser({ id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' }, 'u-cons-a'),
    ).toBe(true);
  });

  it('MANAGER CANNOT chat with a CONSULTANT outside their group', async () => {
    fixtureManagerScope();
    expect(
      await canMessageUser({ id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' }, 'u-cons-b'),
    ).toBe(false);
  });

  it('MANAGER CANNOT chat with a RECRUITER outside their group (unless via junction)', async () => {
    fixtureManagerScope();
    expect(
      await canMessageUser({ id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' }, 'u-rec-b'),
    ).toBe(false);
  });

  it('cross-group exception: a manager assigned via recruiter_managers reaches that recruiter + their consultants', async () => {
    setupDb({
      users: [
        { id: 'u-mgr-a', role: 'MANAGER', is_active: true, group_id: 'g-a' },
        { id: 'u-rec-b', role: 'RECRUITER', is_active: true, group_id: 'g-b' },
        { id: 'u-cons-b', role: 'CONSULTANT', is_active: true, group_id: 'g-b' },
      ],
      recruiters: [{ id: 'r-b', user_id: 'u-rec-b', manager_id: null }],
      recruiter_managers: [{ recruiter_id: 'r-b', manager_id: 'u-mgr-a' }],
      consultants: [{ recruiter_id: 'r-b', user_id: 'u-cons-b' }],
    });
    const ok = await canMessageUser({ id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' }, 'u-rec-b');
    const ok2 = await canMessageUser(
      { id: 'u-mgr-a', role: 'MANAGER', group_id: 'g-a' },
      'u-cons-b',
    );
    expect(ok).toBe(true);
    expect(ok2).toBe(true);
  });

  it('group lead with NO group_id sees managers + admins but no recruiters/consultants (fail-closed group branch)', async () => {
    fixtureManagerScope();
    const ids = await getAccessibleUserIds({ id: 'u-mgr-a', role: 'MANAGER', group_id: null });
    expect(ids.has('u-mgr-b')).toBe(true); // org-wide manager peer
    expect(ids.has('u-dir')).toBe(true); // admin
    expect(ids.has('u-rec-a')).toBe(false); // no group → no recruiters
    expect(ids.has('u-cons-a')).toBe(false); // no group → no consultants
  });
});

// ─── RECRUITER scope ───────────────────────────────────────────────────────
describe('recruiter scope', () => {
  function fixtureRecruiterScope() {
    setupDb({
      users: [
        // Recruiters (org-wide reachable from any recruiter).
        { id: 'u-rec-mine', role: 'RECRUITER', is_active: true, group_id: 'g-a' },
        { id: 'u-rec-other', role: 'RECRUITER', is_active: true, group_id: 'g-b' },
        // Admin tier.
        { id: 'u-dir', role: 'DIRECTOR', is_active: true, group_id: null },
        // Managers in own + other group.
        { id: 'u-mgr-a', role: 'MANAGER', is_active: true, group_id: 'g-a' },
        { id: 'u-hr-a', role: 'HR_MANAGER', is_active: true, group_id: 'g-a' },
        { id: 'u-mgr-b', role: 'MANAGER', is_active: true, group_id: 'g-b' },
      ],
      recruiters: [
        { id: 'r-mine', user_id: 'u-rec-mine', manager_id: null },
        { id: 'r-other', user_id: 'u-rec-other', manager_id: null },
      ],
      recruiter_managers: [],
      consultants: [
        { recruiter_id: 'r-mine', user_id: 'u-cons-mine' },
        { recruiter_id: 'r-other', user_id: 'u-cons-other' },
      ],
    });
  }

  it('RECRUITER can chat with another RECRUITER (any group)', async () => {
    fixtureRecruiterScope();
    expect(
      await canMessageUser({ id: 'u-rec-mine', role: 'RECRUITER', group_id: 'g-a' }, 'u-rec-other'),
    ).toBe(true);
  });

  it('RECRUITER can chat with their own manager / HR chain (managers in own group)', async () => {
    fixtureRecruiterScope();
    expect(
      await canMessageUser({ id: 'u-rec-mine', role: 'RECRUITER', group_id: 'g-a' }, 'u-mgr-a'),
    ).toBe(true);
    expect(
      await canMessageUser({ id: 'u-rec-mine', role: 'RECRUITER', group_id: 'g-a' }, 'u-hr-a'),
    ).toBe(true);
  });

  it('RECRUITER can chat with admin leadership (upward)', async () => {
    fixtureRecruiterScope();
    expect(
      await canMessageUser({ id: 'u-rec-mine', role: 'RECRUITER', group_id: 'g-a' }, 'u-dir'),
    ).toBe(true);
  });

  it('RECRUITER can chat with their own assigned consultant', async () => {
    fixtureRecruiterScope();
    expect(
      await canMessageUser({ id: 'u-rec-mine', role: 'RECRUITER', group_id: 'g-a' }, 'u-cons-mine'),
    ).toBe(true);
  });

  it("RECRUITER CANNOT chat with another recruiter's consultant", async () => {
    fixtureRecruiterScope();
    expect(
      await canMessageUser(
        { id: 'u-rec-mine', role: 'RECRUITER', group_id: 'g-a' },
        'u-cons-other',
      ),
    ).toBe(false);
  });

  it('RECRUITER CANNOT chat with an out-of-group manager (not assigned, not in own group)', async () => {
    fixtureRecruiterScope();
    expect(
      await canMessageUser({ id: 'u-rec-mine', role: 'RECRUITER', group_id: 'g-a' }, 'u-mgr-b'),
    ).toBe(false);
  });

  it('RECRUITER reaches their assigned manager via recruiter_managers junction even when out-of-group', async () => {
    setupDb({
      users: [
        { id: 'u-rec-mine', role: 'RECRUITER', is_active: true, group_id: 'g-a' },
        { id: 'u-mgr-b', role: 'MANAGER', is_active: true, group_id: 'g-b' },
      ],
      recruiters: [{ id: 'r-mine', user_id: 'u-rec-mine', manager_id: null }],
      recruiter_managers: [{ recruiter_id: 'r-mine', manager_id: 'u-mgr-b' }],
      consultants: [],
    });
    const ok = await canMessageUser(
      { id: 'u-rec-mine', role: 'RECRUITER', group_id: 'g-a' },
      'u-mgr-b',
    );
    expect(ok).toBe(true);
  });
});

// ─── CONSULTANT scope ──────────────────────────────────────────────────────
describe('consultant scope', () => {
  function fixtureConsultantScope() {
    setupDb({
      users: [
        { id: 'u-cons', role: 'CONSULTANT', is_active: true, group_id: 'g-a' },
        { id: 'u-my-rec', role: 'RECRUITER', is_active: true, group_id: 'g-a' },
        { id: 'u-mgr-a', role: 'MANAGER', is_active: true, group_id: 'g-a' },
        { id: 'u-hr-a', role: 'HR_MANAGER', is_active: true, group_id: 'g-a' },
        { id: 'u-other-rec', role: 'RECRUITER', is_active: true, group_id: 'g-b' },
        { id: 'u-other-cons', role: 'CONSULTANT', is_active: true, group_id: 'g-b' },
      ],
      consultants: [{ user_id: 'u-cons', recruiter_id: 'r-mine' }],
      recruiters: [
        { id: 'r-mine', user_id: 'u-my-rec', manager_id: 'u-mgr-a' },
        { id: 'r-other', user_id: 'u-other-rec', manager_id: null },
      ],
      recruiter_managers: [],
    });
  }

  it('CONSULTANT can chat with their assigned recruiter', async () => {
    fixtureConsultantScope();
    expect(
      await canMessageUser({ id: 'u-cons', role: 'CONSULTANT', group_id: 'g-a' }, 'u-my-rec'),
    ).toBe(true);
  });

  it("CONSULTANT can chat with their recruiter's manager chain", async () => {
    fixtureConsultantScope();
    expect(
      await canMessageUser({ id: 'u-cons', role: 'CONSULTANT', group_id: 'g-a' }, 'u-mgr-a'),
    ).toBe(true);
  });

  it('CONSULTANT can chat with the HR_MANAGER in their group (in-group manager-tier)', async () => {
    fixtureConsultantScope();
    expect(
      await canMessageUser({ id: 'u-cons', role: 'CONSULTANT', group_id: 'g-a' }, 'u-hr-a'),
    ).toBe(true);
  });

  it('CONSULTANT CANNOT chat with an unrelated recruiter', async () => {
    fixtureConsultantScope();
    expect(
      await canMessageUser({ id: 'u-cons', role: 'CONSULTANT', group_id: 'g-a' }, 'u-other-rec'),
    ).toBe(false);
  });

  it('CONSULTANT CANNOT chat with another consultant', async () => {
    fixtureConsultantScope();
    expect(
      await canMessageUser({ id: 'u-cons', role: 'CONSULTANT', group_id: 'g-a' }, 'u-other-cons'),
    ).toBe(false);
  });
});

// ─── DEVELOPER ─────────────────────────────────────────────────────────────
describe('developer — no chat by default', () => {
  it('DEVELOPER has an empty accessible set', async () => {
    setupDb({
      users: [
        { id: 'u-dir', role: 'DIRECTOR', is_active: true },
        { id: 'u-rec', role: 'RECRUITER', is_active: true },
      ],
    });
    const ids = await getAccessibleUserIds({ id: 'u-dev', role: 'DEVELOPER', group_id: null });
    expect(ids.size).toBe(0);
  });

  it('DEVELOPER cannot message anyone (capability grants are for admin surfaces, not chat)', async () => {
    expect(await canMessageUser({ id: 'u-dev', role: 'DEVELOPER', group_id: null }, 'u-rec')).toBe(
      false,
    );
  });
});

// ─── Strict assignment-only (no reports_to, no prior-thread) ───────────────
describe('strict assignment + group only', () => {
  it('reports_to chain is ignored — consultant with no assignment sees nobody', async () => {
    setupDb({
      recruiters: [],
      recruiter_managers: [],
      consultants: [{ user_id: 'u-me', recruiter_id: null }],
      users: [
        { id: 'u-me', reports_to: 'u-boss', group_id: null },
        { id: 'u-boss', reports_to: null, role: 'MANAGER', is_active: true, group_id: null },
        { id: 'u-report', reports_to: 'u-me', role: 'CONSULTANT', is_active: true, group_id: null },
      ],
    });
    const ids = await getAccessibleUserIds({ id: 'u-me', role: 'CONSULTANT', group_id: null });
    expect(ids.has('u-boss')).toBe(false);
    expect(ids.has('u-report')).toBe(false);
  });

  it('prior messages do NOT grant ongoing access — assignment is the only gate', async () => {
    setupDb({
      consultants: [{ user_id: 'u-cons', recruiter_id: 'r-mine' }],
      recruiters: [{ id: 'r-mine', user_id: 'u-my-rec', manager_id: null }],
      recruiter_managers: [],
      users: [],
    });
    const ids = await getAccessibleUserIds({ id: 'u-cons', role: 'CONSULTANT', group_id: 'g-a' });
    expect(ids.has('u-my-rec')).toBe(true);
    expect(ids.has('u-stranger')).toBe(false);
  });
});

// ─── Cache behaviour ───────────────────────────────────────────────────────
describe('permission cache', () => {
  it('second call uses cached result without re-querying', async () => {
    setupDb({ users: [{ id: 'u-x', is_active: true }] });
    const ids1 = await getAccessibleUserIds({ id: 'u-admin', role: 'SUPER_ADMIN' });
    mock.handlers.clear();
    const ids2 = await getAccessibleUserIds({ id: 'u-admin', role: 'SUPER_ADMIN' });
    expect(ids2).toBe(ids1); // identity-equal → cache hit
    expect(ids2.has('u-x')).toBe(true);
  });

  it('invalidatePermissionCache clears entries for that user', async () => {
    setupDb({ users: [{ id: 'u-x', is_active: true }] });
    await getAccessibleUserIds({ id: 'u-admin', role: 'SUPER_ADMIN' });
    invalidatePermissionCache('u-admin');
    setupDb({ users: [{ id: 'u-y', is_active: true }] });
    const ids = await getAccessibleUserIds({ id: 'u-admin', role: 'SUPER_ADMIN' });
    expect(ids.has('u-y')).toBe(true);
    expect(ids.has('u-x')).toBe(false);
  });

  it('cache key includes group_id so a re-grouped user gets a fresh resolution', async () => {
    setupDb({
      users: [
        { id: 'u-rec-a', role: 'RECRUITER', is_active: true, group_id: 'g-a' },
        { id: 'u-mgr-a', role: 'MANAGER', is_active: true, group_id: 'g-a' },
        { id: 'u-mgr-b', role: 'MANAGER', is_active: true, group_id: 'g-b' },
      ],
      recruiters: [{ id: 'r-mine', user_id: 'u-me', manager_id: null }],
      recruiter_managers: [],
      consultants: [],
    });
    const inA = await getAccessibleUserIds({ id: 'u-me', role: 'RECRUITER', group_id: 'g-a' });
    const inB = await getAccessibleUserIds({ id: 'u-me', role: 'RECRUITER', group_id: 'g-b' });
    expect(inA.has('u-mgr-a')).toBe(true);
    expect(inA.has('u-mgr-b')).toBe(false);
    expect(inB.has('u-mgr-b')).toBe(true);
    expect(inB.has('u-mgr-a')).toBe(false);
  });
});

// ─── canViewConversation alias ─────────────────────────────────────────────
describe('canViewConversation alias', () => {
  it('behaves identically to canMessageUser', async () => {
    setupDb({ users: [{ id: 'u-target', is_active: true }] });
    const a = await canMessageUser({ id: 'u-sa', role: 'SUPER_ADMIN' }, 'u-target');
    const b = await canViewConversation({ id: 'u-sa', role: 'SUPER_ADMIN' }, 'u-target');
    expect(a).toBe(b);
  });
});
