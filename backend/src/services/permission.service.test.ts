/**
 * Unit tests for the permission engine. The DB layer is mocked end-to-end so
 * the suite runs in milliseconds without a Postgres dependency.
 *
 * What this covers:
 *   - role-tier branches (admin / manager / recruiter / consultant)
 *   - assignment-based isolation (recruiter ↔ consultant, manager ↔ recruiter)
 *   - reports_to chain is NOT used for messaging permissions
 *   - prior-thread legitimacy is NOT used (strict assignment only)
 *   - self-message refusal
 *   - cache hit, cache miss, cache invalidation
 *
 * What this does NOT cover (intentional — needs a real Postgres in CI):
 *   - SQL correctness of the underlying queries
 *   - controller integration (use supertest + a seeded test DB)
 *   - cross-worker cache behavior (single-process pmodel here)
 *
 * The mock strategy: vi.mock the `config/db` module with a stub that returns
 * canned responses for each table/method combination. Every test resets the
 * mock so cases don't leak into each other.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the db module BEFORE importing permission.service.
// vi.hoisted lets the mock factory reach into closures defined here.
// ---------------------------------------------------------------------------
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
        filters.__cols = _cols;
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
      or(expr: string) {
        filters['or'] = expr;
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
      // Supports head:true selects (count queries).
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
    db: {
      from(table: string) {
        return makeBuilder(table);
      },
    },
    pool: {},
  };
});

// Mock the shared logger so we don't write to stdout during tests.
vi.mock('../config/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// AFTER the mocks are registered.
import {
  canMessageUser,
  canViewConversation,
  getAccessibleUserIds,
  invalidatePermissionCache,
  clearPermissionCache,
} from './permission.service';

// ---------------------------------------------------------------------------
// Test-only helpers — set up the mocked DB state.
// ---------------------------------------------------------------------------
function setupDb(rows: Record<string, unknown[]>) {
  mock.handlers.clear();
  for (const [table, list] of Object.entries(rows)) {
    mock.handlers.set(table, (filters) => {
      // Generic filter application — supports the small set of operators
      // the permission service actually uses.
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
          // `or` is left unmatched — the permission service no longer
          // queries the messages table at all.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('permission.service — admin override', () => {
  it('SUPER_ADMIN can message any active user', async () => {
    setupDb({
      users: [{ id: 'u-target', is_active: true }],
    });
    const ok = await canMessageUser({ id: 'u-admin', role: 'SUPER_ADMIN' }, 'u-target');
    expect(ok).toBe(true);
  });

  it('SUPER_ADMIN cannot message themselves', async () => {
    const ok = await canMessageUser({ id: 'u-admin', role: 'SUPER_ADMIN' }, 'u-admin');
    expect(ok).toBe(false);
  });

  it('SUPER_ADMIN cannot message an inactive user', async () => {
    setupDb({
      users: [{ id: 'u-target', is_active: false }],
    });
    const ok = await canMessageUser({ id: 'u-admin', role: 'SUPER_ADMIN' }, 'u-target');
    expect(ok).toBe(false);
  });

  it('MANAGER sees their own recruiter/consultant subtree, not unrelated users', async () => {
    setupDb({
      users: [
        { id: 'u-admin', role: 'SUPER_ADMIN', is_active: true },
        { id: 'u-manager', role: 'MANAGER', is_active: true, reports_to: null },
        { id: 'u-recruiter', is_active: true },
        { id: 'u-consultant', is_active: true },
        { id: 'u-unrelated', is_active: true },
        { id: 'u-other-recruiter', is_active: true },
      ],
      recruiters: [
        { id: 'r-mine', user_id: 'u-recruiter', manager_id: 'u-manager' },
        { id: 'r-other', user_id: 'u-other-recruiter', manager_id: null },
      ],
      recruiter_managers: [],
      consultants: [{ recruiter_id: 'r-mine', user_id: 'u-consultant' }],
    });
    const ids = await getAccessibleUserIds({ id: 'u-manager', role: 'MANAGER' });
    // Admin users always reachable
    expect(ids.has('u-admin')).toBe(true);
    // Their own recruiter is reachable
    expect(ids.has('u-recruiter')).toBe(true);
    // That recruiter's consultant is reachable
    expect(ids.has('u-consultant')).toBe(true);
    // Unrelated user is NOT reachable
    expect(ids.has('u-unrelated')).toBe(false);
    // Another manager's recruiter is NOT reachable
    expect(ids.has('u-other-recruiter')).toBe(false);
    // Self never appears
    expect(ids.has('u-manager')).toBe(false);
  });
});

describe('permission.service — recruiter scope (org-wide staff chat)', () => {
  it('recruiter can message their own assigned consultants', async () => {
    setupDb({
      users: [],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      consultants: [
        { recruiter_id: 'r-1', user_id: 'u-consultant-1' },
        { recruiter_id: 'r-1', user_id: 'u-consultant-2' },
      ],
    });
    const ids = await getAccessibleUserIds({ id: 'u-recruiter', role: 'RECRUITER' });
    expect(ids.has('u-consultant-1')).toBe(true);
    expect(ids.has('u-consultant-2')).toBe(true);
  });

  it("recruiter CANNOT message another recruiter's consultant (consultants stay assignment-bound)", async () => {
    setupDb({
      users: [],
      recruiters: [
        { id: 'r-mine', user_id: 'u-recruiter', manager_id: null },
        { id: 'r-other', user_id: 'u-other-recruiter', manager_id: null },
      ],
      consultants: [{ recruiter_id: 'r-other', user_id: 'u-other-consultant' }],
    });
    const ids = await getAccessibleUserIds({ id: 'u-recruiter', role: 'RECRUITER' });
    expect(ids.has('u-other-consultant')).toBe(false);
  });

  it('recruiter can message ANY active staff user (managers, other recruiters, admins) org-wide', async () => {
    setupDb({
      users: [
        { id: 'u-recruiter', role: 'RECRUITER', is_active: true },
        { id: 'u-manager', role: 'MANAGER', is_active: true },
        { id: 'u-hr', role: 'HR_MANAGER', is_active: true },
        { id: 'u-other-recruiter', role: 'RECRUITER', is_active: true },
        { id: 'u-director', role: 'DIRECTOR', is_active: true },
        { id: 'u-inactive-mgr', role: 'MANAGER', is_active: false },
        { id: 'u-some-consultant', role: 'CONSULTANT', is_active: true },
      ],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      consultants: [],
    });
    const ids = await getAccessibleUserIds({ id: 'u-recruiter', role: 'RECRUITER' });
    // Any active staff (not just their manager) is reachable.
    expect(ids.has('u-manager')).toBe(true);
    expect(ids.has('u-hr')).toBe(true);
    expect(ids.has('u-other-recruiter')).toBe(true);
    expect(ids.has('u-director')).toBe(true);
    // Inactive staff excluded; a consultant who isn't theirs is excluded.
    expect(ids.has('u-inactive-mgr')).toBe(false);
    expect(ids.has('u-some-consultant')).toBe(false);
    // Self never appears.
    expect(ids.has('u-recruiter')).toBe(false);
  });

  it('reverse: a non-managing MANAGER can view/reply to a recruiter-initiated thread', async () => {
    // The recruiter reaches all staff (incl. this manager), so the manager must
    // be able to read/reply even though the recruiter is not in their subtree.
    setupDb({
      users: [
        { id: 'u-recruiter', role: 'RECRUITER', is_active: true },
        { id: 'u-manager', role: 'MANAGER', is_active: true },
      ],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
      consultants: [],
    });
    const ok = await canMessageUser({ id: 'u-manager', role: 'MANAGER' }, 'u-recruiter');
    expect(ok).toBe(true);
  });

  it('reverse does NOT let a consultant reach an arbitrary recruiter', async () => {
    setupDb({
      users: [
        { id: 'u-recruiter', role: 'RECRUITER', is_active: true },
        { id: 'u-consultant', role: 'CONSULTANT', is_active: true },
      ],
      consultants: [{ user_id: 'u-consultant', recruiter_id: 'r-other' }],
      recruiters: [
        { id: 'r-1', user_id: 'u-recruiter', manager_id: null },
        { id: 'r-other', user_id: 'u-their-recruiter', manager_id: null },
      ],
      recruiter_managers: [],
    });
    // u-recruiter is not this consultant's recruiter; the recruiter's staff set
    // excludes consultants, so neither direction grants access.
    const ok = await canMessageUser({ id: 'u-consultant', role: 'CONSULTANT' }, 'u-recruiter');
    expect(ok).toBe(false);
  });

  it('reverse never makes an admin universally reachable', async () => {
    // A consultant must NOT be able to message an admin just because the admin
    // reaches everyone. The reverse check skips admin-tier targets.
    setupDb({
      users: [
        { id: 'u-admin', role: 'SUPER_ADMIN', is_active: true },
        { id: 'u-consultant', role: 'CONSULTANT', is_active: true },
      ],
      consultants: [{ user_id: 'u-consultant', recruiter_id: 'r-1' }],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
    });
    const ok = await canMessageUser({ id: 'u-consultant', role: 'CONSULTANT' }, 'u-admin');
    expect(ok).toBe(false);
  });
});

describe('permission.service — consultant scope', () => {
  it('consultant can message their assigned recruiter', async () => {
    setupDb({
      consultants: [{ user_id: 'u-consultant', recruiter_id: 'r-1' }],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
    });
    const ids = await getAccessibleUserIds({ id: 'u-consultant', role: 'CONSULTANT' });
    expect(ids.has('u-recruiter')).toBe(true);
  });

  it("consultant cannot message another recruiter's users", async () => {
    setupDb({
      consultants: [{ user_id: 'u-consultant', recruiter_id: 'r-mine' }],
      recruiters: [
        { id: 'r-mine', user_id: 'u-my-recruiter', manager_id: null },
        { id: 'r-other', user_id: 'u-other-recruiter', manager_id: null },
      ],
      recruiter_managers: [],
    });
    const ids = await getAccessibleUserIds({ id: 'u-consultant', role: 'CONSULTANT' });
    expect(ids.has('u-my-recruiter')).toBe(true);
    expect(ids.has('u-other-recruiter')).toBe(false);
  });
});

describe('permission.service — strict assignment only (no reports_to, no prior-thread)', () => {
  it('reports_to chain is ignored — consultant with no assignment sees nobody', async () => {
    // Even though u-me has a reports_to boss and direct reports, those are
    // NOT messaging permissions. Only the recruiter assignment matters.
    setupDb({
      recruiters: [],
      recruiter_managers: [],
      consultants: [{ user_id: 'u-me', recruiter_id: null }],
      users: [
        { id: 'u-me', reports_to: 'u-boss' },
        { id: 'u-boss', reports_to: null },
        { id: 'u-report-1', reports_to: 'u-me' },
      ],
    });
    const ids = await getAccessibleUserIds({ id: 'u-me', role: 'CONSULTANT' });
    // reports_to boss is NOT reachable — not an assignment relationship
    expect(ids.has('u-boss')).toBe(false);
    // Direct reports are NOT reachable — not an assignment relationship
    expect(ids.has('u-report-1')).toBe(false);
    expect(ids.has('u-me')).toBe(false);
  });

  it('prior messages do NOT grant ongoing access — assignment is the only gate', async () => {
    // Consultant is assigned to r-mine. They previously messaged u-stranger.
    // u-stranger must still be unreachable because the assignment changed.
    setupDb({
      consultants: [{ user_id: 'u-consultant', recruiter_id: 'r-mine' }],
      recruiters: [{ id: 'r-mine', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
      // Even if messages table had rows between consultant and stranger,
      // we no longer query it — so it doesn't matter.
    });
    const ids = await getAccessibleUserIds({ id: 'u-consultant', role: 'CONSULTANT' });
    expect(ids.has('u-recruiter')).toBe(true);
    expect(ids.has('u-stranger')).toBe(false);
  });
});

describe('permission.service — cache behavior', () => {
  it('second call uses cached result without re-querying', async () => {
    setupDb({
      users: [{ id: 'u-x', is_active: true }],
    });
    const ids1 = await getAccessibleUserIds({ id: 'u-admin', role: 'SUPER_ADMIN' });
    expect(ids1.has('u-x')).toBe(true);

    // Clear handler — if cache works, the result is still correct.
    mock.handlers.clear();
    const ids2 = await getAccessibleUserIds({ id: 'u-admin', role: 'SUPER_ADMIN' });
    expect(ids2.has('u-x')).toBe(true);
    // Same reference confirms cache hit, not just same content.
    expect(ids2).toBe(ids1);
  });

  it('invalidatePermissionCache clears entries for that user', async () => {
    setupDb({
      users: [{ id: 'u-x', is_active: true }],
    });
    await getAccessibleUserIds({ id: 'u-admin', role: 'SUPER_ADMIN' });

    invalidatePermissionCache('u-admin');

    // Now change the underlying data and re-query — must re-fetch because
    // we just invalidated.
    setupDb({
      users: [{ id: 'u-y', is_active: true }],
    });
    const ids = await getAccessibleUserIds({ id: 'u-admin', role: 'SUPER_ADMIN' });
    expect(ids.has('u-y')).toBe(true);
    expect(ids.has('u-x')).toBe(false);
  });

  it('clearPermissionCache wipes everything', async () => {
    setupDb({ users: [{ id: 'u-x', is_active: true }] });
    await getAccessibleUserIds({ id: 'u-a', role: 'SUPER_ADMIN' });
    await getAccessibleUserIds({ id: 'u-b', role: 'CEO' });

    clearPermissionCache();
    setupDb({ users: [{ id: 'u-y', is_active: true }] });
    const ids = await getAccessibleUserIds({ id: 'u-a', role: 'SUPER_ADMIN' });
    expect(ids.has('u-y')).toBe(true);
  });
});

describe('permission.service — canViewConversation alias', () => {
  it('behaves identically to canMessageUser', async () => {
    setupDb({
      users: [{ id: 'u-target', is_active: true }],
    });
    const a = await canMessageUser({ id: 'u-admin', role: 'SUPER_ADMIN' }, 'u-target');
    const b = await canViewConversation({ id: 'u-admin', role: 'SUPER_ADMIN' }, 'u-target');
    expect(a).toBe(b);
  });
});
