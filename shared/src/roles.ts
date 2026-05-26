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

/**
 * Admin tier + people managers (incl. HR Manager).
 *
 * DEVELOPER is intentionally NOT here. A DEVELOPER is a "scoped super-admin"
 * whose access is **nothing by default** and is granted explicitly per-account
 * via `capabilities` (see DEVELOPER_CAPABILITIES + requireRoleOrCapability).
 * Keeping it out of the tiers means tier gates deny it until a capability is
 * granted — the fail-closed base for the configurable role.
 */
export const MANAGER_TIER: Role[] = [...ADMIN_TIER, 'MANAGER', 'HR_MANAGER'];

/** Manager tier + Recruiter — operates on the talent pipeline. */
export const OPERATOR_TIER: Role[] = [...MANAGER_TIER, 'RECRUITER'];

/** Every authenticated role (DEVELOPER + CONSULTANT are not in any access tier). */
export const ALL_ROLES: Role[] = [...OPERATOR_TIER, 'DEVELOPER', 'CONSULTANT'];

/**
 * DEVELOPER capability catalog — the fixed set of switches a SUPER_ADMIN ticks
 * when creating/editing a DEVELOPER account. A DEVELOPER is admitted to a gated
 * area only when it holds the matching capability (requireRoleOrCapability).
 *
 * NOT grantable (SUPER_ADMIN-only, enforced separately): creating SUPER_ADMINs
 * or other DEVELOPERs, and the last-super-admin / impersonate-super-admin
 * actions.
 */
export const DEVELOPER_CAPABILITIES = [
  'users', // /admin/users — user management
  'user_groups', // group management
  'feature_flags', // toggle feature flags
  'invitations', // send/manage invitations
  'reports', // analytics/reports
  'ai_usage', // AI usage dashboard
] as const;

export type DeveloperCapability = (typeof DEVELOPER_CAPABILITIES)[number];

export function isAdmin(role: Role | undefined): boolean {
  return !!role && ADMIN_TIER.includes(role);
}

export function isManagerOrUp(role: Role | undefined): boolean {
  return !!role && MANAGER_TIER.includes(role);
}

// ROLE_LABEL stays in `frontend/src/types/index.ts` — display capitalisation
// is a UI concern, not a domain-model concern. Backend never reads it.
