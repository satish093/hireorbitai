/**
 * Unit tests for the admin-lifecycle guards in adminUsers.controller.
 *
 * These two guards are the backstop that stops a lower-tier admin from locking
 * out (or tampering with) a higher-tier account, and from removing the org's
 * last SUPER_ADMIN — see .claude/rules/security.md "Admin lifecycle". The DB
 * layer is mocked end-to-end (same strategy as permission.service.test.ts) so
 * the suite runs without Postgres and without a populated env.
 *
 * Importing the controller would otherwise pull in config/db → config/env
 * (which fail-fasts on missing env) and the audit/auth services, so every heavy
 * dependency is mocked at module load before the controller is imported.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB shim. A single `users` handler answers both queries the guard
// makes: the maybeSingle() lookup (eq id) and the count(head) query (eq role
// + eq is_active).
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
        filters.__head = !!opts?.head;
        return builder;
      },
      eq(col: string, value: unknown) {
        filters[`eq:${col}`] = value;
        return builder;
      },
      maybeSingle() {
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
  return { db: { from: (table: string) => makeBuilder(table) }, pool: {} };
});

// The controller imports these at module load; stub them so nothing tries to
// reach a real env / Postgres / email transport.
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/auth.service', () => ({ requestPasswordReset: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// AFTER the mocks are registered.
import { assertOutranks, assertNotLastSuperAdmin, ROLE_RANK } from './adminUsers.controller';

function setupUsers(rows: Record<string, unknown>[]) {
  mock.handlers.clear();
  mock.handlers.set('users', (filters) =>
    rows.filter((row) => {
      const r = row as Record<string, unknown>;
      for (const [k, v] of Object.entries(filters)) {
        if (k.startsWith('eq:')) {
          const col = k.slice(3);
          if (r[col] !== v) return false;
        }
      }
      return true;
    }),
  );
}

beforeEach(() => mock.handlers.clear());

describe('assertOutranks', () => {
  it('lets a higher tier mutate a lower tier (DIRECTOR over MANAGER)', () => {
    expect(() => assertOutranks({ role: 'DIRECTOR' }, 'MANAGER')).not.toThrow();
  });

  it('refuses an equal-rank mutation (DIRECTOR over DIRECTOR)', () => {
    expect(() => assertOutranks({ role: 'DIRECTOR' }, 'DIRECTOR')).toThrowError(/cannot change/i);
  });

  it('refuses a lower tier mutating a higher tier (DIRECTOR over SUPER_ADMIN)', () => {
    let status: number | undefined;
    try {
      assertOutranks({ role: 'DIRECTOR' }, 'SUPER_ADMIN');
    } catch (e) {
      status = (e as { status?: number }).status;
    }
    expect(status).toBe(403);
  });

  it('ranks HR_MANAGER above MANAGER (HR can manage a MANAGER, not vice-versa)', () => {
    expect(ROLE_RANK.HR_MANAGER).toBeGreaterThan(ROLE_RANK.MANAGER);
    // A MANAGER cannot act on an HR_MANAGER…
    expect(() => assertOutranks({ role: 'MANAGER' }, 'HR_MANAGER')).toThrowError(/cannot change/i);
    // …but an HR_MANAGER outranks (can act on) a MANAGER.
    expect(() => assertOutranks({ role: 'HR_MANAGER' }, 'MANAGER')).not.toThrow();
  });

  it('is a no-op when the target role is null/undefined', () => {
    expect(() => assertOutranks({ role: 'CONSULTANT' }, null)).not.toThrow();
    expect(() => assertOutranks({ role: 'CONSULTANT' }, undefined)).not.toThrow();
  });
});

describe('assertNotLastSuperAdmin', () => {
  it('throws 409 when the target is the only active SUPER_ADMIN', async () => {
    setupUsers([{ id: 'u-super', role: 'SUPER_ADMIN', is_active: true }]);
    let status: number | undefined;
    try {
      await assertNotLastSuperAdmin('u-super');
    } catch (e) {
      status = (e as { status?: number }).status;
    }
    expect(status).toBe(409);
  });

  it('allows removing a SUPER_ADMIN when another active one remains', async () => {
    setupUsers([
      { id: 'u-super', role: 'SUPER_ADMIN', is_active: true },
      { id: 'u-super-2', role: 'SUPER_ADMIN', is_active: true },
    ]);
    await expect(assertNotLastSuperAdmin('u-super')).resolves.toBeUndefined();
  });

  it('is a no-op for a non-SUPER_ADMIN target', async () => {
    setupUsers([{ id: 'u-mgr', role: 'MANAGER', is_active: true }]);
    await expect(assertNotLastSuperAdmin('u-mgr')).resolves.toBeUndefined();
  });

  it('is a no-op when the target row does not exist', async () => {
    setupUsers([]);
    await expect(assertNotLastSuperAdmin('missing')).resolves.toBeUndefined();
  });
});
