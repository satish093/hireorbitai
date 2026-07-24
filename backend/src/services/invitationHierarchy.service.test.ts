/**
 * Unit tests for the invitation hierarchy engine.
 *
 * Rank-based flexible hierarchy under test:
 *   CONSULTANT  → RECRUITER (rank ≥ 2) — MANAGER / HR_MANAGER / admin all valid too
 *   RECRUITER   → MANAGER   (rank ≥ 4) — HR_MANAGER / admin also valid
 *   MANAGER     → HR_MANAGER (rank ≥ 5) — admin also valid
 *   HR_MANAGER  → DIRECTOR  (rank ≥ 6) — CTO / CEO / SUPER_ADMIN also valid
 *   DEVELOPER   → MANAGER   (rank ≥ 4) — HR_MANAGER / admin also valid
 *
 * DB layer is fully mocked — same vi.hoisted + vi.mock pattern used by
 * permission.service.test.ts. No Postgres required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock db BEFORE importing the service under test
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
      select(_cols?: string) {
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
      in(col: string, value: unknown[]) {
        filters[`in:${col}`] = value;
        return builder;
      },
      limit(_n: number) {
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
      upsert(payload: unknown, _opts?: unknown) {
        mock.handlers.set(`__upsert:${table}`, () => [payload]);
        return builder;
      },
      update(_payload: unknown) {
        mock.handlers.set(`__update:${table}`, () => [_payload]);
        return builder;
      },
      then<T>(resolve: (value: R) => T) {
        const rows = mock.handlers.get(table)?.(filters) ?? [];
        return Promise.resolve({ data: rows, error: null, count: rows.length } as R).then(resolve);
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

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import AFTER mocks are registered
import {
  ROLE_RANK,
  getRoleRank,
  isHigherThan,
  canManageRole,
  getDefaultParentRole,
  isAllowedParent,
  isValidParentRole,
  canInviterBecomeParent,
  canManualOverride,
  getExpectedParentRoles,
  getAllValidParentRoles,
  resolveAutoParent,
  wireHierarchy,
} from './invitationHierarchy.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupDb(rows: Record<string, unknown[]>) {
  mock.handlers.clear();
  for (const [table, list] of Object.entries(rows)) {
    mock.handlers.set(table, (filters) => {
      return list.filter((row) => {
        const r = row as Record<string, unknown>;
        for (const [k, v] of Object.entries(filters)) {
          if (k.startsWith('eq:')) {
            if (r[k.slice(3)] !== v) return false;
          } else if (k.startsWith('neq:')) {
            if (r[k.slice(4)] === v) return false;
          } else if (k.startsWith('in:')) {
            if (!(v as unknown[]).includes(r[k.slice(3)])) return false;
          }
        }
        return true;
      });
    });
  }
}

beforeEach(() => mock.handlers.clear());

// ---------------------------------------------------------------------------
// ROLE_RANK — rank values
// ---------------------------------------------------------------------------
describe('ROLE_RANK — rank values', () => {
  it('SUPER_ADMIN has highest rank (9)', () => expect(ROLE_RANK.SUPER_ADMIN).toBe(9));
  it('CEO rank 8', () => expect(ROLE_RANK.CEO).toBe(8));
  it('CTO rank 7', () => expect(ROLE_RANK.CTO).toBe(7));
  it('DIRECTOR rank 6', () => expect(ROLE_RANK.DIRECTOR).toBe(6));
  it('HR_MANAGER rank 5', () => expect(ROLE_RANK.HR_MANAGER).toBe(5));
  it('MANAGER rank 4', () => expect(ROLE_RANK.MANAGER).toBe(4));
  it('DEVELOPER rank 3', () => expect(ROLE_RANK.DEVELOPER).toBe(3));
  it('RECRUITER rank 2', () => expect(ROLE_RANK.RECRUITER).toBe(2));
  it('CONSULTANT has lowest rank (1)', () => expect(ROLE_RANK.CONSULTANT).toBe(1));
});

// ---------------------------------------------------------------------------
// getRoleRank / isHigherThan / canManageRole
// ---------------------------------------------------------------------------
describe('getRoleRank', () => {
  it('returns correct rank for each role', () => {
    expect(getRoleRank('SUPER_ADMIN')).toBe(9);
    expect(getRoleRank('HR_MANAGER')).toBe(5);
    expect(getRoleRank('MANAGER')).toBe(4);
    expect(getRoleRank('RECRUITER')).toBe(2);
    expect(getRoleRank('CONSULTANT')).toBe(1);
  });
});

describe('isHigherThan', () => {
  it('SUPER_ADMIN is higher than CONSULTANT', () =>
    expect(isHigherThan('SUPER_ADMIN', 'CONSULTANT')).toBe(true));
  it('HR_MANAGER is higher than MANAGER', () =>
    expect(isHigherThan('HR_MANAGER', 'MANAGER')).toBe(true));
  it('MANAGER is higher than RECRUITER', () =>
    expect(isHigherThan('MANAGER', 'RECRUITER')).toBe(true));
  it('RECRUITER is NOT higher than MANAGER', () =>
    expect(isHigherThan('RECRUITER', 'MANAGER')).toBe(false));
  it('MANAGER is NOT higher than MANAGER (equal)', () =>
    expect(isHigherThan('MANAGER', 'MANAGER')).toBe(false));
});

describe('canManageRole', () => {
  it('HR_MANAGER can manage MANAGER', () =>
    expect(canManageRole('HR_MANAGER', 'MANAGER')).toBe(true));
  it('MANAGER can manage RECRUITER', () =>
    expect(canManageRole('MANAGER', 'RECRUITER')).toBe(true));
  it('MANAGER can manage CONSULTANT', () =>
    expect(canManageRole('MANAGER', 'CONSULTANT')).toBe(true));
  it('RECRUITER can manage CONSULTANT', () =>
    expect(canManageRole('RECRUITER', 'CONSULTANT')).toBe(true));
  it('CONSULTANT cannot manage CONSULTANT (equal rank)', () =>
    expect(canManageRole('CONSULTANT', 'CONSULTANT')).toBe(false));
  it('CONSULTANT cannot manage RECRUITER', () =>
    expect(canManageRole('CONSULTANT', 'RECRUITER')).toBe(false));
  it('RECRUITER cannot manage MANAGER', () =>
    expect(canManageRole('RECRUITER', 'MANAGER')).toBe(false));
});

// ---------------------------------------------------------------------------
// getDefaultParentRole
// ---------------------------------------------------------------------------
describe('getDefaultParentRole — minimum required parent', () => {
  it('CONSULTANT default parent is RECRUITER', () =>
    expect(getDefaultParentRole('CONSULTANT')).toBe('RECRUITER'));
  it('RECRUITER default parent is MANAGER', () =>
    expect(getDefaultParentRole('RECRUITER')).toBe('MANAGER'));
  it('MANAGER default parent is HR_MANAGER', () =>
    expect(getDefaultParentRole('MANAGER')).toBe('HR_MANAGER'));
  it('HR_MANAGER default parent is DIRECTOR', () =>
    expect(getDefaultParentRole('HR_MANAGER')).toBe('DIRECTOR'));
  it('DEVELOPER default parent is MANAGER', () =>
    expect(getDefaultParentRole('DEVELOPER')).toBe('MANAGER'));
  it('SUPER_ADMIN has no parent required (null)', () =>
    expect(getDefaultParentRole('SUPER_ADMIN')).toBeNull());
  it('CEO has no parent required (null)', () => expect(getDefaultParentRole('CEO')).toBeNull());
  it('CTO has no parent required (null)', () => expect(getDefaultParentRole('CTO')).toBeNull());
  it('DIRECTOR has no parent required (null)', () =>
    expect(getDefaultParentRole('DIRECTOR')).toBeNull());
});

// ---------------------------------------------------------------------------
// isAllowedParent — flexible rank-based validation
// ---------------------------------------------------------------------------
describe('isAllowedParent — any role at or above default parent rank is valid', () => {
  // CONSULTANT (needs rank ≥ 2)
  it('RECRUITER can parent CONSULTANT (default)', () =>
    expect(isAllowedParent('CONSULTANT', 'RECRUITER')).toBe(true));
  it('DEVELOPER can parent CONSULTANT (rank 3 ≥ 2)', () =>
    expect(isAllowedParent('CONSULTANT', 'DEVELOPER')).toBe(true));
  it('MANAGER can parent CONSULTANT (rank 4 ≥ 2)', () =>
    expect(isAllowedParent('CONSULTANT', 'MANAGER')).toBe(true));
  it('HR_MANAGER can parent CONSULTANT (rank 5 ≥ 2)', () =>
    expect(isAllowedParent('CONSULTANT', 'HR_MANAGER')).toBe(true));
  it('DIRECTOR can parent CONSULTANT (rank 6 ≥ 2)', () =>
    expect(isAllowedParent('CONSULTANT', 'DIRECTOR')).toBe(true));
  it('SUPER_ADMIN can parent CONSULTANT (rank 9 ≥ 2)', () =>
    expect(isAllowedParent('CONSULTANT', 'SUPER_ADMIN')).toBe(true));
  it('CONSULTANT cannot parent CONSULTANT (rank 1 < 2)', () =>
    expect(isAllowedParent('CONSULTANT', 'CONSULTANT')).toBe(false));

  // RECRUITER (needs rank ≥ 4)
  it('MANAGER can parent RECRUITER (default)', () =>
    expect(isAllowedParent('RECRUITER', 'MANAGER')).toBe(true));
  it('HR_MANAGER can parent RECRUITER (rank 5 ≥ 4)', () =>
    expect(isAllowedParent('RECRUITER', 'HR_MANAGER')).toBe(true));
  it('SUPER_ADMIN can parent RECRUITER (rank 9 ≥ 4)', () =>
    expect(isAllowedParent('RECRUITER', 'SUPER_ADMIN')).toBe(true));
  it('RECRUITER cannot parent RECRUITER (rank 2 < 4)', () =>
    expect(isAllowedParent('RECRUITER', 'RECRUITER')).toBe(false));
  it('CONSULTANT cannot parent RECRUITER', () =>
    expect(isAllowedParent('RECRUITER', 'CONSULTANT')).toBe(false));

  // MANAGER (needs rank ≥ 5)
  it('HR_MANAGER can parent MANAGER (default)', () =>
    expect(isAllowedParent('MANAGER', 'HR_MANAGER')).toBe(true));
  it('DIRECTOR can parent MANAGER (rank 6 ≥ 5)', () =>
    expect(isAllowedParent('MANAGER', 'DIRECTOR')).toBe(true));
  it('SUPER_ADMIN can parent MANAGER (rank 9 ≥ 5)', () =>
    expect(isAllowedParent('MANAGER', 'SUPER_ADMIN')).toBe(true));
  it('MANAGER cannot parent MANAGER (rank 4 < 5)', () =>
    expect(isAllowedParent('MANAGER', 'MANAGER')).toBe(false));
  it('RECRUITER cannot parent MANAGER', () =>
    expect(isAllowedParent('MANAGER', 'RECRUITER')).toBe(false));

  // HR_MANAGER (needs rank ≥ 6)
  it('DIRECTOR can parent HR_MANAGER (default)', () =>
    expect(isAllowedParent('HR_MANAGER', 'DIRECTOR')).toBe(true));
  it('CTO can parent HR_MANAGER (rank 7 ≥ 6)', () =>
    expect(isAllowedParent('HR_MANAGER', 'CTO')).toBe(true));
  it('CEO can parent HR_MANAGER (rank 8 ≥ 6)', () =>
    expect(isAllowedParent('HR_MANAGER', 'CEO')).toBe(true));
  it('SUPER_ADMIN can parent HR_MANAGER (rank 9 ≥ 6)', () =>
    expect(isAllowedParent('HR_MANAGER', 'SUPER_ADMIN')).toBe(true));
  it('HR_MANAGER cannot parent HR_MANAGER (rank 5 < 6)', () =>
    expect(isAllowedParent('HR_MANAGER', 'HR_MANAGER')).toBe(false));
  it('MANAGER cannot parent HR_MANAGER', () =>
    expect(isAllowedParent('HR_MANAGER', 'MANAGER')).toBe(false));

  // Admin-tier: no parent required
  it('any role is valid parent for SUPER_ADMIN (no parent required)', () => {
    expect(isAllowedParent('SUPER_ADMIN', 'CONSULTANT')).toBe(true);
    expect(isAllowedParent('SUPER_ADMIN', 'MANAGER')).toBe(true);
  });
  it('any role is valid parent for CEO (no parent required)', () =>
    expect(isAllowedParent('CEO', 'HR_MANAGER')).toBe(true));
});

// ---------------------------------------------------------------------------
// isValidParentRole — backward-compat alias
// ---------------------------------------------------------------------------
describe('isValidParentRole — delegates to isAllowedParent', () => {
  it('RECRUITER is valid parent for CONSULTANT', () =>
    expect(isValidParentRole('CONSULTANT', 'RECRUITER')).toBe(true));
  it('MANAGER is valid parent for CONSULTANT', () =>
    expect(isValidParentRole('CONSULTANT', 'MANAGER')).toBe(true));
  it('CONSULTANT is NOT valid parent for CONSULTANT', () =>
    expect(isValidParentRole('CONSULTANT', 'CONSULTANT')).toBe(false));
  it('HR_MANAGER is valid parent for RECRUITER', () =>
    expect(isValidParentRole('RECRUITER', 'HR_MANAGER')).toBe(true));
  it('SUPER_ADMIN is valid parent for MANAGER', () =>
    expect(isValidParentRole('MANAGER', 'SUPER_ADMIN')).toBe(true));
  it('DIRECTOR is valid parent for HR_MANAGER', () =>
    expect(isValidParentRole('HR_MANAGER', 'DIRECTOR')).toBe(true));
});

// ---------------------------------------------------------------------------
// canInviterBecomeParent
// ---------------------------------------------------------------------------
describe('canInviterBecomeParent — inviter can be parent when rank ≥ required', () => {
  it('RECRUITER inviting CONSULTANT can be parent', () =>
    expect(canInviterBecomeParent('CONSULTANT', 'RECRUITER')).toBe(true));
  it('MANAGER inviting CONSULTANT can be parent', () =>
    expect(canInviterBecomeParent('CONSULTANT', 'MANAGER')).toBe(true));
  it('HR_MANAGER inviting CONSULTANT can be parent', () =>
    expect(canInviterBecomeParent('CONSULTANT', 'HR_MANAGER')).toBe(true));
  it('SUPER_ADMIN inviting CONSULTANT can be parent', () =>
    expect(canInviterBecomeParent('CONSULTANT', 'SUPER_ADMIN')).toBe(true));
  it('CONSULTANT inviting CONSULTANT cannot be parent (rank too low)', () =>
    expect(canInviterBecomeParent('CONSULTANT', 'CONSULTANT')).toBe(false));

  it('MANAGER inviting RECRUITER can be parent', () =>
    expect(canInviterBecomeParent('RECRUITER', 'MANAGER')).toBe(true));
  it('HR_MANAGER inviting RECRUITER can be parent', () =>
    expect(canInviterBecomeParent('RECRUITER', 'HR_MANAGER')).toBe(true));
  it('RECRUITER inviting RECRUITER cannot be parent (rank 2 < 4)', () =>
    expect(canInviterBecomeParent('RECRUITER', 'RECRUITER')).toBe(false));

  it('HR_MANAGER inviting MANAGER can be parent', () =>
    expect(canInviterBecomeParent('MANAGER', 'HR_MANAGER')).toBe(true));
  it('SUPER_ADMIN inviting MANAGER can be parent', () =>
    expect(canInviterBecomeParent('MANAGER', 'SUPER_ADMIN')).toBe(true));
  it('MANAGER inviting MANAGER cannot be parent (rank 4 < 5)', () =>
    expect(canInviterBecomeParent('MANAGER', 'MANAGER')).toBe(false));
});

// ---------------------------------------------------------------------------
// canManualOverride
// ---------------------------------------------------------------------------
describe('canManualOverride — override permission checks', () => {
  it('SUPER_ADMIN can override anything, even invalid hierarchy', () => {
    expect(canManualOverride('SUPER_ADMIN', 'CONSULTANT', 'CONSULTANT')).toBe(true);
    expect(canManualOverride('SUPER_ADMIN', 'HR_MANAGER', 'RECRUITER')).toBe(true);
  });

  it('HR_MANAGER can override when chosen parent is valid and actor outranks invited', () => {
    expect(canManualOverride('HR_MANAGER', 'CONSULTANT', 'MANAGER')).toBe(true);
    expect(canManualOverride('HR_MANAGER', 'RECRUITER', 'MANAGER')).toBe(true);
  });

  it('MANAGER can override when chosen parent is valid for invited role', () => {
    expect(canManualOverride('MANAGER', 'CONSULTANT', 'RECRUITER')).toBe(true);
  });

  it('RECRUITER can override within CONSULTANT scope', () => {
    expect(canManualOverride('RECRUITER', 'CONSULTANT', 'RECRUITER')).toBe(true);
    expect(canManualOverride('RECRUITER', 'CONSULTANT', 'MANAGER')).toBe(true);
  });

  it('CONSULTANT cannot override (cannot manage CONSULTANT)', () =>
    expect(canManualOverride('CONSULTANT', 'CONSULTANT', 'RECRUITER')).toBe(false));

  it('non-SA cannot override with an invalid parent choice', () => {
    // MANAGER trying to place RECRUITER under RECRUITER (rank 2 < 4 — invalid)
    expect(canManualOverride('MANAGER', 'RECRUITER', 'RECRUITER')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getExpectedParentRoles — error-message helper
// ---------------------------------------------------------------------------
describe('getExpectedParentRoles — returns default parent for error messages', () => {
  it('CONSULTANT returns [RECRUITER]', () =>
    expect(getExpectedParentRoles('CONSULTANT')).toEqual(['RECRUITER']));
  it('RECRUITER returns [MANAGER]', () =>
    expect(getExpectedParentRoles('RECRUITER')).toEqual(['MANAGER']));
  it('MANAGER returns [HR_MANAGER]', () =>
    expect(getExpectedParentRoles('MANAGER')).toEqual(['HR_MANAGER']));
  it('HR_MANAGER returns [DIRECTOR]', () =>
    expect(getExpectedParentRoles('HR_MANAGER')).toEqual(['DIRECTOR']));
  it('DEVELOPER returns [MANAGER]', () =>
    expect(getExpectedParentRoles('DEVELOPER')).toEqual(['MANAGER']));
  it('SUPER_ADMIN returns null', () => expect(getExpectedParentRoles('SUPER_ADMIN')).toBeNull());
  it('CEO returns null', () => expect(getExpectedParentRoles('CEO')).toBeNull());
});

// ---------------------------------------------------------------------------
// getAllValidParentRoles — candidates list
// ---------------------------------------------------------------------------
describe('getAllValidParentRoles — all roles satisfying rank requirement', () => {
  it('CONSULTANT valid parents include RECRUITER, MANAGER, HR_MANAGER, admin-tier', () => {
    const roles = getAllValidParentRoles('CONSULTANT')!;
    expect(roles).toContain('RECRUITER');
    expect(roles).toContain('MANAGER');
    expect(roles).toContain('HR_MANAGER');
    expect(roles).toContain('SUPER_ADMIN');
    expect(roles).not.toContain('CONSULTANT');
  });

  it('RECRUITER valid parents include MANAGER, HR_MANAGER, admin-tier but not RECRUITER/CONSULTANT', () => {
    const roles = getAllValidParentRoles('RECRUITER')!;
    expect(roles).toContain('MANAGER');
    expect(roles).toContain('HR_MANAGER');
    expect(roles).toContain('SUPER_ADMIN');
    expect(roles).not.toContain('RECRUITER');
    expect(roles).not.toContain('CONSULTANT');
  });

  it('SUPER_ADMIN returns null (no parent required)', () =>
    expect(getAllValidParentRoles('SUPER_ADMIN')).toBeNull());
});

// ---------------------------------------------------------------------------
// resolveAutoParent — auto-resolution algorithm
// ---------------------------------------------------------------------------
describe('resolveAutoParent', () => {
  // Case 1: inviter rank ≥ required parent rank → inviter is the parent
  it('1a — Recruiter invites Consultant → parent = Recruiter (rank 2 ≥ 2)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('CONSULTANT', { id: 'u-rec', role: 'RECRUITER' });
    expect(parentId).toBe('u-rec');
  });

  it('1b — Manager invites Consultant → parent = Manager (rank 4 ≥ 2)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('CONSULTANT', { id: 'u-mgr', role: 'MANAGER' });
    expect(parentId).toBe('u-mgr');
  });

  it('1c — HR_MANAGER invites Consultant → parent = HR_MANAGER (rank 5 ≥ 2)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('CONSULTANT', { id: 'u-hrm', role: 'HR_MANAGER' });
    expect(parentId).toBe('u-hrm');
  });

  it('1d — SUPER_ADMIN invites Consultant → parent = SUPER_ADMIN (rank 9 ≥ 2)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('CONSULTANT', { id: 'u-sa', role: 'SUPER_ADMIN' });
    expect(parentId).toBe('u-sa');
  });

  it('1e — Manager invites Recruiter → parent = Manager (rank 4 ≥ 4)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('RECRUITER', { id: 'u-mgr', role: 'MANAGER' });
    expect(parentId).toBe('u-mgr');
  });

  it('1f — HR_MANAGER invites Manager → parent = HR_MANAGER (rank 5 ≥ 5)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('MANAGER', { id: 'u-hrm', role: 'HR_MANAGER' });
    expect(parentId).toBe('u-hrm');
  });

  it('1g — SUPER_ADMIN invites Recruiter → parent = SUPER_ADMIN (rank 9 ≥ 4)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('RECRUITER', { id: 'u-sa', role: 'SUPER_ADMIN' });
    expect(parentId).toBe('u-sa');
  });

  it('1h — SUPER_ADMIN invites Manager → parent = SUPER_ADMIN (rank 9 ≥ 5)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('MANAGER', { id: 'u-sa', role: 'SUPER_ADMIN' });
    expect(parentId).toBe('u-sa');
  });

  // Case 2: inviter rank < required parent rank → walk hierarchy
  it('2a — Recruiter invites Recruiter → walks recruiter_managers to find Manager (Case 2)', async () => {
    setupDb({
      users: [
        { id: 'u-recruiter', reports_to: null, is_active: true },
        { id: 'u-manager', role: 'MANAGER', is_active: true },
      ],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [{ recruiter_id: 'r-1', manager_id: 'u-manager' }],
    });
    const parentId = await resolveAutoParent('RECRUITER', { id: 'u-recruiter', role: 'RECRUITER' });
    expect(parentId).toBe('u-manager');
  });

  it('2b — Manager invites Manager → walks reports_to to find HR_MANAGER (Case 2)', async () => {
    setupDb({
      users: [
        { id: 'u-manager', reports_to: 'u-hrm', is_active: true },
        { id: 'u-hrm', role: 'HR_MANAGER', is_active: true },
      ],
      recruiters: [],
      recruiter_managers: [],
    });
    const parentId = await resolveAutoParent('MANAGER', { id: 'u-manager', role: 'MANAGER' });
    expect(parentId).toBe('u-hrm');
  });

  it('2c — DEVELOPER invites Recruiter, reports_to points to MANAGER (Case 2: dev rank 3 < mgr rank 4)', async () => {
    setupDb({
      users: [
        { id: 'u-dev', reports_to: 'u-manager', is_active: true },
        { id: 'u-manager', role: 'MANAGER', is_active: true },
      ],
      recruiters: [],
      recruiter_managers: [],
    });
    const parentId = await resolveAutoParent('RECRUITER', { id: 'u-dev', role: 'DEVELOPER' });
    expect(parentId).toBe('u-manager');
  });

  // Case 3: workspace search
  it('3a — Recruiter invites Recruiter, no manager in hierarchy but one Manager in workspace → auto-assign', async () => {
    setupDb({
      users: [
        { id: 'u-recruiter', reports_to: null, is_active: true },
        { id: 'u-manager', role: 'MANAGER', is_active: true },
      ],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
    });
    const parentId = await resolveAutoParent('RECRUITER', { id: 'u-recruiter', role: 'RECRUITER' });
    expect(parentId).toBe('u-manager');
  });

  it('3b — Recruiter invites Recruiter, multiple Managers in workspace → null (ambiguous)', async () => {
    setupDb({
      users: [
        { id: 'u-recruiter', reports_to: null, is_active: true },
        { id: 'u-mgr-1', role: 'MANAGER', is_active: true },
        { id: 'u-mgr-2', role: 'MANAGER', is_active: true },
      ],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
    });
    const parentId = await resolveAutoParent('RECRUITER', { id: 'u-recruiter', role: 'RECRUITER' });
    expect(parentId).toBeNull();
  });

  it('3c — Recruiter invites Recruiter, zero managers anywhere → null', async () => {
    setupDb({
      users: [{ id: 'u-recruiter', reports_to: null, is_active: true }],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
    });
    const parentId = await resolveAutoParent('RECRUITER', { id: 'u-recruiter', role: 'RECRUITER' });
    expect(parentId).toBeNull();
  });

  // Admin-tier invited role
  it('4 — Admin-tier invited role (SUPER_ADMIN) → null regardless of inviter', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('SUPER_ADMIN', { id: 'u-sa', role: 'SUPER_ADMIN' });
    expect(parentId).toBeNull();
  });

  it('5 — Admin-tier invited role (DIRECTOR) → null regardless of inviter', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('DIRECTOR', { id: 'u-sa', role: 'SUPER_ADMIN' });
    expect(parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wireHierarchy — DB mutation tests
// ---------------------------------------------------------------------------
describe('wireHierarchy', () => {
  it('CONSULTANT under RECRUITER: upserts consultants row with recruiter_id and sets reports_to', async () => {
    setupDb({
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter' }],
    });
    await expect(
      wireHierarchy('u-new-consultant', 'CONSULTANT', 'u-recruiter'),
    ).resolves.not.toThrow();
    const upserted = mock.handlers.get('__upsert:consultants')?.({})?.[0] as any;
    expect(upserted).toBeDefined();
    expect(upserted.user_id).toBe('u-new-consultant');
    expect(upserted.recruiter_id).toBe('r-1');
    const updated = mock.handlers.get('__update:users')?.({})?.[0] as any;
    expect(updated?.reports_to).toBe('u-recruiter');
  });

  it('CONSULTANT under MANAGER (no recruiter row): skips consultants upsert, sets reports_to', async () => {
    setupDb({
      recruiters: [], // manager has no recruiter profile
    });
    await expect(
      wireHierarchy('u-new-consultant', 'CONSULTANT', 'u-manager'),
    ).resolves.not.toThrow();
    const updated = mock.handlers.get('__update:users')?.({})?.[0] as any;
    expect(updated?.reports_to).toBe('u-manager');
  });

  it('RECRUITER: upserts recruiters row, wires recruiter_managers, sets reports_to', async () => {
    setupDb({
      recruiters: [{ id: 'r-new', user_id: 'u-new-recruiter', manager_id: 'u-manager' }],
    });
    await expect(wireHierarchy('u-new-recruiter', 'RECRUITER', 'u-manager')).resolves.not.toThrow();
    const updated = mock.handlers.get('__update:users')?.({})?.[0] as any;
    expect(updated?.reports_to).toBe('u-manager');
  });

  it('MANAGER: only sets reports_to (no profile row needed)', async () => {
    setupDb({});
    await expect(wireHierarchy('u-new-manager', 'MANAGER', 'u-hrm')).resolves.not.toThrow();
    const updated = mock.handlers.get('__update:users')?.({})?.[0] as any;
    expect(updated?.reports_to).toBe('u-hrm');
  });

  it('HR_MANAGER: only sets reports_to pointing at DIRECTOR/above', async () => {
    setupDb({});
    await expect(wireHierarchy('u-new-hrm', 'HR_MANAGER', 'u-director')).resolves.not.toThrow();
    const updated = mock.handlers.get('__update:users')?.({})?.[0] as any;
    expect(updated?.reports_to).toBe('u-director');
  });

  it('null parentUserId → no-op, does not throw', async () => {
    setupDb({});
    await expect(wireHierarchy('u-new', 'CONSULTANT', null)).resolves.not.toThrow();
  });
});
