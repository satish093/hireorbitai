/**
 * Workspace-wide RBAC exceptions — gate-level policy pins.
 *
 * DoD: "Every group lead action must be scoped to their group UNLESS explicitly
 * marked workspace-wide, and every workspace-wide exception must have a comment
 * AND a test." The row-scoped surfaces (consultants, recruiters, applications,
 * interviews, resumes, tasks) are pinned by their own ownership tests. This file
 * pins the deliberate EXCEPTIONS — the surfaces where the group leads
 * (HR_MANAGER / MANAGER) are intentionally NOT group-scoped — at the route gate,
 * and the one admin surface that group leads must NOT administer at all.
 *
 *   - Reports/analytics  → workspace-wide for all MANAGER_TIER incl. leads.
 *   - Training admin      → workspace-wide for all MANAGER_TIER incl. leads.
 *   - Feature flags write → OWNER_TIER (SUPER_ADMIN + CEO); CEO owner-power
 *                            intentional (also covered in capability.guard.test).
 *   - User Groups admin   → ADMIN_TIER-global; group leads are EXCLUDED (they are
 *                            scoped to their group elsewhere, they don't admin groups).
 *
 * Uses the real requireRole / requireRoleOrCapability middleware — no controller
 * mocking. DB + env are stubbed only because auth.ts imports them at load.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/db', () => ({ db: {}, pool: {} }));
vi.mock('../config/env', () => ({ env: {} }));

import { requireRole, requireRoleOrCapability } from './auth';
import {
  MANAGER_TIER,
  ADMIN_TIER,
  OWNER_TIER,
  type Role,
  type DeveloperCapability,
} from '../types';

/** Run a gate and return the HTTP status: 200 = admitted, else the thrown code. */
function gate(
  mw: ReturnType<typeof requireRole> | ReturnType<typeof requireRoleOrCapability>,
  role: Role,
  capabilities: DeveloperCapability[] = [],
): number {
  let passed = false;
  try {
    mw({ user: { id: 'u', role, capabilities } } as any, {} as any, () => {
      passed = true;
    });
  } catch (e) {
    return (e as { status?: number }).status ?? 0;
  }
  return passed ? 200 : 0;
}

describe('workspace-wide exception: reports/analytics admit group leads', () => {
  const mw = requireRoleOrCapability(MANAGER_TIER, 'reports');
  it('admits both group leads (HR_MANAGER + MANAGER) — workspace-wide, not denied', () => {
    expect(gate(mw, 'HR_MANAGER')).toBe(200);
    expect(gate(mw, 'MANAGER')).toBe(200);
  });
  it('admits admin tier and a DEVELOPER with the reports capability', () => {
    expect(gate(mw, 'DIRECTOR')).toBe(200);
    expect(gate(mw, 'DEVELOPER', ['reports'])).toBe(200);
  });
  it('denies RECRUITER and CONSULTANT and a dev without the cap', () => {
    expect(gate(mw, 'RECRUITER')).toBe(403);
    expect(gate(mw, 'CONSULTANT')).toBe(403);
    expect(gate(mw, 'DEVELOPER', [])).toBe(403);
  });
});

describe('workspace-wide exception: training admin admits group leads', () => {
  const mw = requireRole(...MANAGER_TIER);
  it('admits both group leads — training courses/assignments/reports are org-wide', () => {
    expect(gate(mw, 'HR_MANAGER')).toBe(200);
    expect(gate(mw, 'MANAGER')).toBe(200);
  });
  it('denies RECRUITER and CONSULTANT', () => {
    expect(gate(mw, 'RECRUITER')).toBe(403);
    expect(gate(mw, 'CONSULTANT')).toBe(403);
  });
});

describe('feature-flag writes are OWNER_TIER (CEO owner-power intentional)', () => {
  const mw = requireRoleOrCapability(OWNER_TIER, 'feature_flags');
  it('admits SUPER_ADMIN + CEO; a granted DEVELOPER too', () => {
    expect(gate(mw, 'SUPER_ADMIN')).toBe(200);
    expect(gate(mw, 'CEO')).toBe(200);
    expect(gate(mw, 'DEVELOPER', ['feature_flags'])).toBe(200);
  });
  it('denies CTO/DIRECTOR (admin-tier but not owner) and below', () => {
    expect(gate(mw, 'CTO')).toBe(403);
    expect(gate(mw, 'DIRECTOR')).toBe(403);
    expect(gate(mw, 'MANAGER')).toBe(403);
  });
});

describe('user-groups admin is ADMIN_TIER-global; group leads excluded', () => {
  const mw = requireRoleOrCapability(ADMIN_TIER, 'user_groups');
  it('admits admin tier and a DEVELOPER with the user_groups capability', () => {
    expect(gate(mw, 'DIRECTOR')).toBe(200);
    expect(gate(mw, 'CEO')).toBe(200);
    expect(gate(mw, 'DEVELOPER', ['user_groups'])).toBe(200);
  });
  it('DENIES the group leads — they do not administer groups', () => {
    expect(gate(mw, 'HR_MANAGER')).toBe(403);
    expect(gate(mw, 'MANAGER')).toBe(403);
    expect(gate(mw, 'RECRUITER')).toBe(403);
  });
});
