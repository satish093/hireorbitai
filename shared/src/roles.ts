/**
 * Canonical role definitions, shared between backend and frontend.
 *
 * Single source of truth — both `backend/src/types/index.ts` and
 * `frontend/src/types/index.ts` re-export from this module. Keeping it in
 * `shared/` means a role change is a one-file edit, not "remember to update
 * both halves and pray they stay in sync".
 *
 * Pure types + constants. No runtime deps. Safe to import from anywhere.
 */

export type Role =
  | 'SUPER_ADMIN'
  | 'CEO'
  | 'CTO'
  | 'DIRECTOR'
  | 'MANAGER'
  | 'HR_MANAGER'
  | 'DEVELOPER'
  | 'RECRUITER'
  | 'CONSULTANT';

/** Workspace owners — can toggle feature flags + irreversible workspace settings. */
export const OWNER_TIER: Role[] = ['SUPER_ADMIN', 'CEO'];

/** Roles with full-org visibility (everything an admin can do). */
export const ADMIN_TIER: Role[] = ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR'];

/** Admin tier + people managers (incl. HR Manager) + internal Developer. */
export const MANAGER_TIER: Role[] = [...ADMIN_TIER, 'MANAGER', 'HR_MANAGER', 'DEVELOPER'];

/** Manager tier + Recruiter — operates on the talent pipeline. */
export const OPERATOR_TIER: Role[] = [...MANAGER_TIER, 'RECRUITER'];

/** Every authenticated role. */
export const ALL_ROLES: Role[] = [...OPERATOR_TIER, 'CONSULTANT'];

export function isAdmin(role: Role | undefined): boolean {
  return !!role && ADMIN_TIER.includes(role);
}

export function isManagerOrUp(role: Role | undefined): boolean {
  return !!role && MANAGER_TIER.includes(role);
}

// ROLE_LABEL stays in `frontend/src/types/index.ts` — display capitalisation
// is a UI concern, not a domain-model concern. Backend never reads it.
