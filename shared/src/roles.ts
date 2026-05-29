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
  'calls_usage', // /admin/calls-usage — monthly call-hour budget dashboard
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
 * Roles only a SUPER_ADMIN may create / invite / promote into:
 *  - SUPER_ADMIN — the absolute role; only an existing SA mints another.
 *  - DEVELOPER   — a scoped super-admin whose capability grants are SA-only, so
 *    minting the account itself is SA-only too.
 */
export const SUPER_ADMIN_ONLY_ROLES: Role[] = ['SUPER_ADMIN', 'DEVELOPER'];

/**
 * Can `actor` create / invite / promote a user into `target`?
 *  - SUPER_ADMIN may assign ANY role (incl. SUPER_ADMIN + DEVELOPER).
 *  - Everyone else: never a SUPER_ADMIN-only role, and only a role STRICTLY
 *    below their own rank (so a RECRUITER may assign CONSULTANT, nothing else).
 * Single source of truth shared by frontend dropdowns and backend guards.
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === 'SUPER_ADMIN') return true;
  if (SUPER_ADMIN_ONLY_ROLES.includes(target)) return false;
  return outranks(actor, target);
}

/** Roles `actorRole` may create / invite / assign — drives frontend dropdowns. */
export function assignableRolesFor(actorRole: Role): Role[] {
  return ALL_ROLES.filter((r) => canAssignRole(actorRole, r));
}

/**
 * Business/staff roles for the day-to-day app surface (tasks, jobs, interviews,
 * inbox, reminders, training, etc.). Everyone EXCEPT DEVELOPER, which is a
 * scoped admin with no default business access — it reaches only the capability-
 * gated admin areas it has been granted.
 */
export const BUSINESS_ROLES: Role[] = ALL_ROLES.filter((r) => r !== 'DEVELOPER');

/**
 * Roles that can use the in-app messenger. Same as BUSINESS_ROLES + DEVELOPER —
 * the only exception we make to "DEVELOPER has no business access by default."
 * Lets every user reach a developer for bug/error reporting and lets the
 * developer reply, WITHOUT granting DEVELOPER access to jobs / tasks / training
 * / etc. Only use this for the /messages route gate; everywhere else the
 * BUSINESS_ROLES exclusion of DEVELOPER stays in force.
 */
export const MESSAGING_ROLES: Role[] = [...BUSINESS_ROLES, 'DEVELOPER'];

// ROLE_LABEL stays in `frontend/src/types/index.ts` — display capitalisation
// is a UI concern, not a domain-model concern. Backend never reads it.
