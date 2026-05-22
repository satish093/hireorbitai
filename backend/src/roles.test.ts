/**
 * Authorization-foundation tests. The role tier ladder in @hireorbitai/shared
 * is the single source of truth that every requireRole(...) gate and ownership
 * check leans on. A typo that, say, dropped RECRUITER out of OPERATOR_TIER or
 * slipped CONSULTANT into MANAGER_TIER would silently widen access across the
 * whole app. These invariants lock the ladder's containment + membership so
 * such a regression fails CI instead of shipping.
 *
 * Pure constants — no DB, no env, no mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  OWNER_TIER,
  ADMIN_TIER,
  MANAGER_TIER,
  OPERATOR_TIER,
  ALL_ROLES,
  isAdmin,
  isManagerOrUp,
  type Role,
} from '@hireorbitai/shared';

const subset = (inner: Role[], outer: Role[]) => inner.every((r) => outer.includes(r));

describe('role tier ladder', () => {
  it('is strictly nested: OWNER ⊂ ADMIN ⊂ MANAGER ⊂ OPERATOR ⊂ ALL', () => {
    expect(subset(OWNER_TIER, ADMIN_TIER)).toBe(true);
    expect(subset(ADMIN_TIER, MANAGER_TIER)).toBe(true);
    expect(subset(MANAGER_TIER, OPERATOR_TIER)).toBe(true);
    expect(subset(OPERATOR_TIER, ALL_ROLES)).toBe(true);
    // Each step is strictly larger — no accidental aliasing of two tiers.
    expect(ADMIN_TIER.length).toBeGreaterThan(OWNER_TIER.length);
    expect(MANAGER_TIER.length).toBeGreaterThan(ADMIN_TIER.length);
    expect(OPERATOR_TIER.length).toBeGreaterThan(MANAGER_TIER.length);
    expect(ALL_ROLES.length).toBeGreaterThan(OPERATOR_TIER.length);
  });

  it('keeps CONSULTANT out of every privileged tier', () => {
    expect(OWNER_TIER).not.toContain('CONSULTANT');
    expect(ADMIN_TIER).not.toContain('CONSULTANT');
    expect(MANAGER_TIER).not.toContain('CONSULTANT');
    expect(OPERATOR_TIER).not.toContain('CONSULTANT');
    expect(ALL_ROLES).toContain('CONSULTANT');
  });

  it('keeps RECRUITER an operator but never a manager/admin', () => {
    expect(OPERATOR_TIER).toContain('RECRUITER');
    expect(MANAGER_TIER).not.toContain('RECRUITER');
    expect(ADMIN_TIER).not.toContain('RECRUITER');
  });

  it('isAdmin matches ADMIN_TIER membership exactly', () => {
    for (const role of ALL_ROLES) {
      expect(isAdmin(role)).toBe(ADMIN_TIER.includes(role));
    }
    expect(isAdmin(undefined)).toBe(false);
  });

  it('isManagerOrUp matches MANAGER_TIER membership exactly', () => {
    for (const role of ALL_ROLES) {
      expect(isManagerOrUp(role)).toBe(MANAGER_TIER.includes(role));
    }
    expect(isManagerOrUp(undefined)).toBe(false);
  });
});
