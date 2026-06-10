/**
 * DEVELOPER capability enforcement. A DEVELOPER has NO tier membership, so it is
 * admitted to a gated surface only when it holds the matching capability —
 * fail-closed. Tier members pass as before; everyone else is denied.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/db', () => ({ db: {}, pool: {} }));
vi.mock('../config/env', () => ({ env: {} }));

import { requireRole, requireRoleOrCapability, hasCapability } from './auth';
import { OWNER_TIER, MANAGER_TIER } from '../types';
import type { Role } from '../types';

const TIER: Role[] = ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR', 'MANAGER', 'HR_MANAGER'];

function run(user: any): { err: { status?: number } | null; passed: boolean } {
  let passed = false;
  try {
    requireRoleOrCapability(TIER, 'reports')({ user } as any, {} as any, () => {
      passed = true;
    });
    return { err: null, passed };
  } catch (e) {
    return { err: e as { status?: number }, passed };
  }
}

describe('hasCapability', () => {
  it('true only for a DEVELOPER holding the grant', () => {
    expect(hasCapability({ role: 'DEVELOPER', capabilities: ['reports'] }, 'reports')).toBe(true);
    expect(hasCapability({ role: 'DEVELOPER', capabilities: ['users'] }, 'reports')).toBe(false);
    expect(hasCapability({ role: 'DEVELOPER', capabilities: [] }, 'reports')).toBe(false);
    // A non-DEVELOPER never gets capabilities, even if the array is present.
    expect(hasCapability({ role: 'MANAGER', capabilities: ['reports'] }, 'reports')).toBe(false);
    expect(hasCapability(undefined, 'reports')).toBe(false);
  });
});

describe('hasCapability — PAGE-ACCESS caps apply to ANY role', () => {
  it('invoices grant unlocks for every role, not just DEVELOPER', () => {
    for (const role of ['RECRUITER', 'CONSULTANT', 'MANAGER', 'DEVELOPER'] as Role[]) {
      expect(hasCapability({ role, capabilities: ['invoices'] }, 'invoices')).toBe(true);
    }
    // Without the grant → false, regardless of role.
    expect(hasCapability({ role: 'RECRUITER', capabilities: [] }, 'invoices')).toBe(false);
    expect(hasCapability({ role: 'CONSULTANT', capabilities: ['reports'] }, 'invoices')).toBe(
      false,
    );
  });

  it('a DEVELOPER admin-cap (reports) still does NOT leak to non-developers', () => {
    // Page-access widening must not weaken the DEVELOPER-only admin caps.
    expect(hasCapability({ role: 'RECRUITER', capabilities: ['reports'] }, 'reports')).toBe(false);
    expect(hasCapability({ role: 'MANAGER', capabilities: ['users'] }, 'users')).toBe(false);
    expect(hasCapability({ role: 'DEVELOPER', capabilities: ['reports'] }, 'reports')).toBe(true);
  });
});

describe('requireRoleOrCapability(MANAGER_TIER, invoices) — the invoices gate', () => {
  const gate = (user: any): number => {
    let passed = false;
    try {
      requireRoleOrCapability(MANAGER_TIER, 'invoices')({ user } as any, {} as any, () => {
        passed = true;
      });
    } catch (e) {
      return (e as { status?: number }).status ?? 0;
    }
    return passed ? 200 : 0;
  };

  it('admits MANAGER_TIER by role with no grant', () => {
    expect(gate({ role: 'MANAGER' })).toBe(200);
    expect(gate({ role: 'DIRECTOR' })).toBe(200);
  });

  it('admits a RECRUITER / CONSULTANT / DEVELOPER ONLY with the invoices grant', () => {
    expect(gate({ role: 'RECRUITER', capabilities: [] })).toBe(403);
    expect(gate({ role: 'RECRUITER', capabilities: ['invoices'] })).toBe(200);
    expect(gate({ role: 'CONSULTANT', capabilities: ['invoices'] })).toBe(200);
    expect(gate({ role: 'DEVELOPER', capabilities: ['invoices'] })).toBe(200);
    expect(gate({ role: 'CONSULTANT', capabilities: [] })).toBe(403);
  });
});

describe('requireRoleOrCapability', () => {
  it('admits a tier member', () => {
    expect(run({ role: 'MANAGER' }).passed).toBe(true);
    expect(run({ role: 'SUPER_ADMIN' }).passed).toBe(true);
  });

  it('admits a DEVELOPER with the capability', () => {
    expect(run({ role: 'DEVELOPER', capabilities: ['reports'] }).passed).toBe(true);
  });

  it('403s a DEVELOPER without the capability (fail-closed)', () => {
    expect(run({ role: 'DEVELOPER', capabilities: ['users'] }).err?.status).toBe(403);
    expect(run({ role: 'DEVELOPER', capabilities: [] }).err?.status).toBe(403);
  });

  it('403s a role outside the tier', () => {
    expect(run({ role: 'RECRUITER' }).err?.status).toBe(403);
    expect(run({ role: 'CONSULTANT' }).err?.status).toBe(403);
  });

  it('401s when unauthenticated', () => {
    expect(run(undefined).err?.status).toBe(401);
  });

  it('feature-flag mutation gate (OWNER_TIER) blocks non-owners; admits owners + granted dev', () => {
    const OWNER: Role[] = ['SUPER_ADMIN', 'CEO'];
    const gate = (user: any): number => {
      let passed = false;
      try {
        requireRoleOrCapability(OWNER, 'feature_flags')({ user } as any, {} as any, () => {
          passed = true;
        });
      } catch (e) {
        return (e as { status?: number }).status ?? 0;
      }
      return passed ? 200 : 0;
    };
    expect(gate({ role: 'MANAGER' })).toBe(403);
    expect(gate({ role: 'DIRECTOR' })).toBe(403); // admin-tier but not owner
    expect(gate({ role: 'RECRUITER' })).toBe(403);
    expect(gate({ role: 'CEO' })).toBe(200);
    expect(gate({ role: 'SUPER_ADMIN' })).toBe(200);
    expect(gate({ role: 'DEVELOPER', capabilities: ['feature_flags'] })).toBe(200);
    expect(gate({ role: 'DEVELOPER', capabilities: [] })).toBe(403);
  });
});

// The feature-flag WRITE routes (PATCH /feature-flags/:key, PUT /groups/:g/:k)
// use plain requireRole(...OWNER_TIER) — NOT requireRoleOrCapability — so a
// `feature_flags`-capable DEVELOPER (and CTO/DIRECTOR) can READ flag state but
// can never TOGGLE it. Capability grants visibility, not write authority. This
// pins that invariant against a future "helpful" swap to requireRoleOrCapability.
describe('feature-flag WRITE gate is requireRole(OWNER_TIER) — capability does NOT grant writes', () => {
  const writeGate = (user: any): number => {
    let passed = false;
    try {
      requireRole(...OWNER_TIER)({ user } as any, {} as any, () => {
        passed = true;
      });
    } catch (e) {
      return (e as { status?: number }).status ?? 0;
    }
    return passed ? 200 : 0;
  };

  it('admits OWNER_TIER (SUPER_ADMIN, CEO)', () => {
    expect(writeGate({ role: 'SUPER_ADMIN' })).toBe(200);
    expect(writeGate({ role: 'CEO' })).toBe(200);
  });

  it('rejects CTO/DIRECTOR and a feature_flags-capable DEVELOPER (read-only, not write)', () => {
    expect(writeGate({ role: 'CTO' })).toBe(403);
    expect(writeGate({ role: 'DIRECTOR' })).toBe(403);
    expect(writeGate({ role: 'DEVELOPER', capabilities: ['feature_flags'] })).toBe(403);
  });
});
