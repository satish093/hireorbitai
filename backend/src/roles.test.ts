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
  GROUP_LEAD_ROLES,
  isAdmin,
  isManagerOrUp,
  outranks,
  roleRank,
  assignableRolesFor,
  canAssignRole,
  SUPER_ADMIN_ONLY_ROLES,
  BUSINESS_ROLES,
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

  it('treats HR_MANAGER and MANAGER as the group-lead roles inside MANAGER_TIER', () => {
    expect(GROUP_LEAD_ROLES).toEqual(['HR_MANAGER', 'MANAGER']);
    for (const r of GROUP_LEAD_ROLES) expect(MANAGER_TIER).toContain(r);
    expect(ADMIN_TIER).not.toContain('HR_MANAGER');
    expect(ADMIN_TIER).not.toContain('MANAGER');
  });
});

describe('rank ceiling (roleRank / outranks / assignableRolesFor)', () => {
  it('ranks roles in the canonical seniority order', () => {
    expect(roleRank('SUPER_ADMIN')).toBeGreaterThan(roleRank('CEO'));
    expect(roleRank('CEO')).toBeGreaterThan(roleRank('CTO'));
    expect(roleRank('CTO')).toBeGreaterThan(roleRank('DIRECTOR'));
    expect(roleRank('DIRECTOR')).toBeGreaterThan(roleRank('HR_MANAGER'));
    expect(roleRank('HR_MANAGER')).toBeGreaterThan(roleRank('MANAGER'));
    expect(roleRank('MANAGER')).toBeGreaterThan(roleRank('DEVELOPER'));
    expect(roleRank('DEVELOPER')).toBeGreaterThan(roleRank('RECRUITER'));
    expect(roleRank('RECRUITER')).toBeGreaterThan(roleRank('CONSULTANT'));
  });

  it('outranks is strict (equal rank does not outrank)', () => {
    expect(outranks('DIRECTOR', 'MANAGER')).toBe(true);
    expect(outranks('DIRECTOR', 'DIRECTOR')).toBe(false);
    expect(outranks('MANAGER', 'DIRECTOR')).toBe(false);
  });

  it('assignableRolesFor: a SUPER_ADMIN may assign every role (incl. SUPER_ADMIN)', () => {
    const a = assignableRolesFor('SUPER_ADMIN');
    for (const r of ALL_ROLES) expect(a).toContain(r);
  });

  it('assignableRolesFor: non-super never gets SUPER_ADMIN or an equal/higher role', () => {
    const dir = assignableRolesFor('DIRECTOR');
    expect(dir).not.toContain('SUPER_ADMIN');
    expect(dir).not.toContain('CEO');
    expect(dir).not.toContain('CTO');
    expect(dir).not.toContain('DIRECTOR'); // equal rank excluded
    expect(dir).toContain('HR_MANAGER');
    expect(dir).toContain('MANAGER');
    expect(dir).toContain('CONSULTANT');
  });

  it('assignableRolesFor: a RECRUITER may only assign CONSULTANT', () => {
    expect(assignableRolesFor('RECRUITER')).toEqual(['CONSULTANT']);
  });

  it('assignableRolesFor: a CONSULTANT may assign nothing', () => {
    expect(assignableRolesFor('CONSULTANT')).toEqual([]);
  });
});

describe('canAssignRole (SUPER_ADMIN absolute + SA-only roles)', () => {
  it('SUPER_ADMIN may assign every role, including SUPER_ADMIN and DEVELOPER', () => {
    for (const r of ALL_ROLES) expect(canAssignRole('SUPER_ADMIN', r)).toBe(true);
  });

  it('only SUPER_ADMIN may assign the SA-only roles (SUPER_ADMIN + DEVELOPER)', () => {
    expect(SUPER_ADMIN_ONLY_ROLES).toEqual(['SUPER_ADMIN', 'DEVELOPER']);
    for (const actor of [
      'CEO',
      'CTO',
      'DIRECTOR',
      'HR_MANAGER',
      'MANAGER',
      'RECRUITER',
    ] as Role[]) {
      expect(canAssignRole(actor, 'SUPER_ADMIN')).toBe(false);
      expect(canAssignRole(actor, 'DEVELOPER')).toBe(false);
    }
  });

  it('a RECRUITER may assign CONSULTANT and nothing else', () => {
    expect(canAssignRole('RECRUITER', 'CONSULTANT')).toBe(true);
    for (const r of ['RECRUITER', 'MANAGER', 'HR_MANAGER', 'DIRECTOR', 'DEVELOPER'] as Role[]) {
      expect(canAssignRole('RECRUITER', r)).toBe(false);
    }
  });

  it('a non-super may assign strictly-lower non-SA-only roles (DIRECTOR → HR_MANAGER)', () => {
    expect(canAssignRole('DIRECTOR', 'HR_MANAGER')).toBe(true);
    expect(canAssignRole('DIRECTOR', 'DIRECTOR')).toBe(false); // equal rank
  });

  it('BUSINESS_ROLES is every role except DEVELOPER', () => {
    expect(BUSINESS_ROLES).not.toContain('DEVELOPER');
    for (const r of ALL_ROLES) {
      if (r !== 'DEVELOPER') expect(BUSINESS_ROLES).toContain(r);
    }
  });
});
