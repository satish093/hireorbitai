/**
 * DEVELOPER capability enforcement. A DEVELOPER has NO tier membership, so it is
 * admitted to a gated surface only when it holds the matching capability —
 * fail-closed. Tier members pass as before; everyone else is denied.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/db', () => ({ db: {}, pool: {} }));
vi.mock('../config/env', () => ({ env: {} }));

import { requireRoleOrCapability, hasCapability } from './auth';
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
});
