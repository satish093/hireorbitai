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
 * Admin tier + the group leads (HR_MANAGER and MANAGER).
 *
 * - HR_MANAGER and MANAGER are the **group leads** — functionally identical:
 *   each is assigned to ONE group and only sees the people in that group (see
 *   groupScope + GROUP_LEAD_ROLES). DIRECTOR and above oversee ALL groups.
 * - DEVELOPER is intentionally NOT here — a "scoped super-admin" whose access is
 *   **nothing by default**, granted explicitly per-account via `capabilities`
 *   (DEVELOPER_CAPABILITIES + requireRoleOrCapability).
 */
export const MANAGER_TIER: Role[] = [...ADMIN_TIER, 'HR_MANAGER', 'MANAGER'];

/** Manager tier + Recruiter — operates on the talent pipeline. */
export const OPERATOR_TIER: Role[] = [...MANAGER_TIER, 'RECRUITER'];

/** Every authenticated role. DEVELOPER + CONSULTANT hold no access tier. */
export const ALL_ROLES: Role[] = [...OPERATOR_TIER, 'DEVELOPER', 'CONSULTANT'];

/**
 * Group leads — confined to their single group by groupScope. DIRECTOR+ (admin
 * tier) are NOT group-scoped: they oversee every group. Add a role here to make
 * it group-scoped.
 */
export const GROUP_LEAD_ROLES: Role[] = ['HR_MANAGER', 'MANAGER'];

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

/**
 * Seniority ladder, most-senior first. Single source of truth for "who outranks
 * whom" — the backend rank tables (invitationHierarchy / adminUsers) mirror this
 * order. Index 0 is the most senior.
 */
export const ROLE_ORDER: Role[] = [
  'SUPER_ADMIN',
  'CEO',
  'CTO',
  'DIRECTOR',
  'HR_MANAGER',
  'MANAGER',
  'DEVELOPER',
  'RECRUITER',
  'CONSULTANT',
];

/** Numeric rank — higher = more senior. Unknown roles rank 0 (lowest). */
export function roleRank(role: Role): number {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? 0 : ROLE_ORDER.length - i;
}

/** Actor strictly outranks target (the rank ceiling for create/invite/assign). */
export function outranks(actor: Role, target: Role): boolean {
  return roleRank(actor) > roleRank(target);
}

/**
 * Roles `actorRole` is allowed to create / invite / assign. A SUPER_ADMIN may
 * assign any role (incl. SUPER_ADMIN); everyone else may only assign roles
 * STRICTLY below their own rank and never SUPER_ADMIN. Mirrors the backend
 * ceiling (canManageRole + the SUPER_ADMIN special-case) so frontend dropdowns
 * never offer a role the server will reject.
 */
export function assignableRolesFor(actorRole: Role): Role[] {
  if (actorRole === 'SUPER_ADMIN') return [...ALL_ROLES];
  return ALL_ROLES.filter((r) => r !== 'SUPER_ADMIN' && outranks(actorRole, r));
}

// ROLE_LABEL stays in `frontend/src/types/index.ts` — display capitalisation
// is a UI concern, not a domain-model concern. Backend never reads it.
