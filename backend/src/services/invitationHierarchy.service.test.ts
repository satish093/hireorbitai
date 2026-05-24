/**
 * Unit tests for the invitation hierarchy engine.
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
        // Store payload so tests can inspect it
        mock.handlers.set(`__upsert:${table}`, () => [payload]);
        return builder;
      },
      update(_payload: unknown) {
        mock.handlers.set(`__update:${table}`, () => [_payload]);
        return builder;
      },
      catch() {
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
  getExpectedParentRoles,
  isValidParentRole,
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
// Pure-function tests
// ---------------------------------------------------------------------------
describe('getExpectedParentRoles', () => {
  it('CONSULTANT expects RECRUITER only', () => {
    expect(getExpectedParentRoles('CONSULTANT')).toEqual(['RECRUITER']);
  });

  it('RECRUITER expects manager-tier or above', () => {
    const roles = getExpectedParentRoles('RECRUITER')!;
    expect(roles).toContain('MANAGER');
    expect(roles).toContain('HR_MANAGER');
    expect(roles).toContain('SUPER_ADMIN');
  });

  it('SUPER_ADMIN has no required parent', () => {
    expect(getExpectedParentRoles('SUPER_ADMIN')).toBeNull();
  });
});

describe('isValidParentRole', () => {
  it('RECRUITER is a valid parent for CONSULTANT', () => {
    expect(isValidParentRole('CONSULTANT', 'RECRUITER')).toBe(true);
  });

  it('MANAGER is NOT a valid parent for CONSULTANT', () => {
    expect(isValidParentRole('CONSULTANT', 'MANAGER')).toBe(false);
  });

  it('any role is valid parent for SUPER_ADMIN (no parent needed)', () => {
    expect(isValidParentRole('SUPER_ADMIN', 'CONSULTANT')).toBe(true);
    expect(isValidParentRole('SUPER_ADMIN', 'MANAGER')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveAutoParent tests
// ---------------------------------------------------------------------------
describe('resolveAutoParent', () => {
  it('1 — Manager invites Recruiter → parent = Manager (inviter IS expected parent)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('RECRUITER', { id: 'u-manager', role: 'MANAGER' });
    expect(parentId).toBe('u-manager');
  });

  it('2 — Recruiter invites Consultant → parent = Recruiter (inviter IS expected parent)', async () => {
    setupDb({ users: [], recruiters: [], recruiter_managers: [] });
    const parentId = await resolveAutoParent('CONSULTANT', {
      id: 'u-recruiter',
      role: 'RECRUITER',
    });
    expect(parentId).toBe('u-recruiter');
  });

  it('3 — Super Admin invites Consultant → null (SA is not RECRUITER, no recruiter in hierarchy)', async () => {
    setupDb({
      users: [{ id: 'u-sa', reports_to: null }],
      recruiters: [],
      recruiter_managers: [],
    });
    const parentId = await resolveAutoParent('CONSULTANT', { id: 'u-sa', role: 'SUPER_ADMIN' });
    expect(parentId).toBeNull();
  });

  it('4 — Recruiter invites Recruiter → parent = Manager (walks recruiter_managers)', async () => {
    setupDb({
      users: [
        { id: 'u-recruiter', reports_to: null },
        { id: 'u-manager', role: 'MANAGER' },
      ],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [{ recruiter_id: 'r-1', manager_id: 'u-manager' }],
    });
    const parentId = await resolveAutoParent('RECRUITER', {
      id: 'u-recruiter',
      role: 'RECRUITER',
    });
    expect(parentId).toBe('u-manager');
  });

  it('5 — Manager invites Manager → parent = HR_Manager (walks reports_to)', async () => {
    setupDb({
      users: [
        { id: 'u-manager', reports_to: 'u-hrm' },
        { id: 'u-hrm', role: 'HR_MANAGER' },
      ],
      recruiters: [],
      recruiter_managers: [],
    });
    const parentId = await resolveAutoParent('MANAGER', { id: 'u-manager', role: 'MANAGER' });
    expect(parentId).toBe('u-hrm');
  });

  it('9 — resolveAutoParent when inviter has no manager → returns null', async () => {
    setupDb({
      users: [{ id: 'u-recruiter', reports_to: null }],
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
    });
    const parentId = await resolveAutoParent('RECRUITER', {
      id: 'u-recruiter',
      role: 'RECRUITER',
    });
    expect(parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wireHierarchy tests
// ---------------------------------------------------------------------------
describe('wireHierarchy', () => {
  it('10 — CONSULTANT: upserts consultants row with recruiter_id and sets reports_to', async () => {
    setupDb({
      recruiters: [{ id: 'r-1', user_id: 'u-recruiter' }],
    });
    // Should complete without throwing
    await expect(
      wireHierarchy('u-new-consultant', 'CONSULTANT', 'u-recruiter'),
    ).resolves.not.toThrow();
    // Verify the upsert was called for consultants
    const upserted = mock.handlers.get('__upsert:consultants')?.({})?.[0] as any;
    expect(upserted).toBeDefined();
    expect(upserted.user_id).toBe('u-new-consultant');
    expect(upserted.recruiter_id).toBe('r-1');
    // Verify reports_to update was called
    const updated = mock.handlers.get('__update:users')?.({})?.[0] as any;
    expect(updated?.reports_to).toBe('u-recruiter');
  });

  it('RECRUITER: upserts recruiters row and sets reports_to', async () => {
    setupDb({
      recruiters: [{ id: 'r-new', user_id: 'u-new-recruiter', manager_id: 'u-manager' }],
    });
    await expect(wireHierarchy('u-new-recruiter', 'RECRUITER', 'u-manager')).resolves.not.toThrow();
  });

  it('MANAGER: only sets reports_to', async () => {
    setupDb({});
    await expect(wireHierarchy('u-new-manager', 'MANAGER', 'u-hrm')).resolves.not.toThrow();
    const updated = mock.handlers.get('__update:users')?.({})?.[0] as any;
    expect(updated?.reports_to).toBe('u-hrm');
  });

  it('null parentUserId → no-op, does not throw', async () => {
    setupDb({});
    await expect(wireHierarchy('u-new', 'CONSULTANT', null)).resolves.not.toThrow();
  });
});
