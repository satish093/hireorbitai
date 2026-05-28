/**
 * RBAC permission matrix — the single machine-checked source of truth for the
 * "definition of done" audit. Every protected route in App.tsx is listed once
 * with its frontend allow-tier, optional DEVELOPER capability, optional feature
 * flag, the sidebar label it surfaces as (if any), the backend gate that mirrors
 * it, its data scope, and the primary actions an allowed actor should see.
 *
 * Role arrays are IMPORTED from the shared role constants (never duplicated as
 * literal strings — see .claude/rules). The sidebar-parity and route-guard specs
 * derive their expectations from this table, so a drift between the matrix and
 * the rendered app fails a test rather than silently rotting.
 *
 * Human-readable companion: docs/rbac-matrix.md.
 */

import {
  ALL_ROLES,
  BUSINESS_ROLES,
  OPERATOR_TIER,
  MANAGER_TIER,
  ADMIN_TIER,
  OWNER_TIER,
  type Role,
  type DeveloperCapability,
} from '../../src/types';

export type Scope =
  | 'global' // workspace-wide for everyone allowed (no group filter)
  | 'group-scoped' // group leads see only their group; admin-tier unscoped
  | 'owner-scoped' // self / own assigned rows only
  | 'public'; // no row scoping (toggles, public lists)

export interface RoutePolicy {
  /** Canonical route path in App.tsx (the page the guard protects). */
  path: string;
  /** Sidebar nav label, if this route appears in the sidebar. */
  sidebarLabel?: string;
  /** Sidebar section heading (informational). */
  section?: 'Workspace' | 'Talent' | 'Training' | 'Admin';
  /** Frontend ProtectedRoute allow-list (a shared tier array). */
  allow: Role[];
  /** A DEVELOPER holding this capability is also admitted. */
  capability?: DeveloperCapability;
  /** Feature-flag gate (hidden/blocked when the flag is OFF for the group). */
  flagKey?: string;
  /** Human description of the backend route gate that mirrors `allow`. */
  backendGate: string;
  /** Data scope the backend enforces on rows for this surface. */
  scope: Scope;
  /** Primary actions an allowed actor should be able to execute on the page. */
  primaryActions: string[];
  /** Workspace-wide exception note (DoD: every exception needs a comment + test). */
  workspaceWideException?: string;
}

export const RBAC_MATRIX: RoutePolicy[] = [
  // ── Workspace ──────────────────────────────────────────────────────────
  {
    path: '/dashboard',
    sidebarLabel: 'Dashboard',
    section: 'Workspace',
    allow: ALL_ROLES,
    backendGate: 'requireAuth (role-specific dashboards resolve client-side)',
    scope: 'owner-scoped',
    primaryActions: ['view role dashboard'],
  },
  {
    path: '/tasks',
    sidebarLabel: 'Tasks',
    section: 'Workspace',
    allow: BUSINESS_ROLES,
    flagKey: 'tasks',
    backendGate: 'requireRole(...BUSINESS_ROLES) + requireFeature(tasks)',
    scope: 'group-scoped',
    primaryActions: ['create task (manager)', 'update own status', 'comment'],
  },
  {
    path: '/calendar',
    sidebarLabel: 'Calendar',
    section: 'Workspace',
    allow: BUSINESS_ROLES,
    backendGate: 'requireRole(...BUSINESS_ROLES)',
    scope: 'owner-scoped',
    primaryActions: ['view calendar'],
  },
  {
    path: '/messages',
    sidebarLabel: 'Inbox',
    section: 'Workspace',
    allow: BUSINESS_ROLES,
    flagKey: 'messages',
    backendGate: 'requireRole(...BUSINESS_ROLES) + requireFeature(messages)',
    scope: 'owner-scoped',
    primaryActions: ['message permitted peers only (permission.service)'],
  },
  {
    path: '/reminders',
    sidebarLabel: 'Reminders',
    section: 'Workspace',
    allow: BUSINESS_ROLES,
    flagKey: 'reminders',
    backendGate: 'requireRole(...BUSINESS_ROLES) + requireFeature(reminders)',
    scope: 'owner-scoped',
    primaryActions: ['create/snooze own reminders'],
  },
  {
    path: '/my-resume',
    sidebarLabel: 'My Resume',
    section: 'Workspace',
    allow: ['CONSULTANT'],
    backendGate:
      'CONSULTANT-only route; backend resume endpoints scope to caller via authorizeConsultantAccess',
    scope: 'owner-scoped',
    primaryActions: ['upload / list / download / set-current / delete own resume'],
  },

  // ── Talent ─────────────────────────────────────────────────────────────
  {
    path: '/consultants',
    sidebarLabel: 'Consultants',
    section: 'Talent',
    allow: OPERATOR_TIER,
    backendGate: 'requireRole(...OPERATOR_TIER) + per-row ownership',
    scope: 'group-scoped',
    primaryActions: [
      'reassign recruiter (manager/admin)',
      'update allowed fields/status (recruiter, own only)',
    ],
  },
  {
    path: '/recruiters',
    sidebarLabel: 'Recruiters',
    section: 'Talent',
    allow: MANAGER_TIER,
    backendGate: 'requireRole(...MANAGER_TIER) + group scope',
    scope: 'group-scoped',
    primaryActions: ['manage supervisor assignments (in-scope only)'],
  },
  {
    path: '/jobs',
    sidebarLabel: 'Jobs',
    section: 'Talent',
    allow: OPERATOR_TIER,
    backendGate: 'requireRole(...OPERATOR_TIER)',
    scope: 'global',
    primaryActions: ['search/view jobs (CONSULTANT excluded)'],
  },
  {
    path: '/applications',
    sidebarLabel: 'Applications',
    section: 'Talent',
    allow: OPERATOR_TIER,
    backendGate: 'requireRole(...OPERATOR_TIER) + assertCanAccessConsultant',
    scope: 'group-scoped',
    primaryActions: ['create application for in-scope consultant'],
  },
  {
    path: '/interviews',
    sidebarLabel: 'Interviews',
    section: 'Talent',
    allow: BUSINESS_ROLES,
    flagKey: 'interviews',
    backendGate: 'requireRole(...BUSINESS_ROLES) + requireFeature(interviews) + ownership',
    scope: 'group-scoped',
    primaryActions: ['schedule/update interviews (in-scope)'],
  },
  {
    path: '/resumes',
    sidebarLabel: 'Resumes',
    section: 'Talent',
    allow: OPERATOR_TIER,
    backendGate: 'requireRole(...OPERATOR_TIER) + authorizeConsultantAccess',
    scope: 'group-scoped',
    primaryActions: ['view/manage resumes for in-scope consultants (CONSULTANT denied)'],
  },
  {
    path: '/vendors',
    sidebarLabel: 'Vendors',
    section: 'Talent',
    allow: OPERATOR_TIER,
    backendGate: 'requireRole(...OPERATOR_TIER)',
    scope: 'group-scoped',
    primaryActions: ['manage vendors'],
  },
  {
    path: '/clients',
    sidebarLabel: 'Clients',
    section: 'Talent',
    allow: OPERATOR_TIER,
    backendGate: 'requireRole(...OPERATOR_TIER)',
    scope: 'group-scoped',
    primaryActions: ['manage clients'],
  },
  {
    path: '/reports',
    sidebarLabel: 'Analytics',
    section: 'Talent',
    allow: MANAGER_TIER,
    capability: 'reports',
    flagKey: 'reports',
    backendGate: 'requireRoleOrCapability(MANAGER_TIER, reports) + requireFeature(reports)',
    scope: 'global',
    primaryActions: ['view org analytics'],
    workspaceWideException:
      'Analytics are workspace-wide for all of MANAGER_TIER incl. group leads — aggregate org metrics, not row-level PII. See reports.controller.ts RBAC POLICY comment + rbac.workspaceWide.test.ts.',
  },

  // ── Training ─────────────────────────────────────────────────────────────
  {
    path: '/training',
    sidebarLabel: 'My Training',
    section: 'Training',
    allow: BUSINESS_ROLES,
    flagKey: 'training',
    backendGate:
      'requireRole(...BUSINESS_ROLES) + requireFeature(training) + own-assignment ownership',
    scope: 'owner-scoped',
    primaryActions: ['view own assignments, lessons, quizzes, plan'],
  },
  {
    path: '/training/courses',
    sidebarLabel: 'Courses',
    section: 'Training',
    allow: MANAGER_TIER,
    flagKey: 'training',
    backendGate: 'requireRole(...MANAGER_TIER) + requireFeature(training)',
    scope: 'global',
    primaryActions: ['author/manage courses (manual)', 'AI generation (admin only)'],
    workspaceWideException:
      'Course/assignment administration is workspace-wide for MANAGER_TIER incl. group leads — org training catalog, not PII. See training.controller.ts RBAC POLICY comment + rbac.workspaceWide.test.ts.',
  },
  {
    path: '/training/assignments',
    sidebarLabel: 'Assignments',
    section: 'Training',
    allow: MANAGER_TIER,
    flagKey: 'training',
    backendGate: 'requireRole(...MANAGER_TIER) + requireFeature(training)',
    scope: 'global',
    primaryActions: ['assign training to any org user', 'give assignment feedback'],
    workspaceWideException:
      'Assignment to any org user is intentional for MANAGER_TIER — see rbac.workspaceWide.test.ts.',
  },
  {
    path: '/training/reports',
    sidebarLabel: 'Reports',
    section: 'Training',
    allow: MANAGER_TIER,
    flagKey: 'training',
    backendGate: 'requireRole(...MANAGER_TIER) + requireFeature(training)',
    scope: 'global',
    primaryActions: ['view training reports (org-wide)'],
    workspaceWideException: 'Training reports are org-wide for MANAGER_TIER.',
  },
  {
    path: '/training/ai-activity',
    sidebarLabel: 'AI Activity',
    section: 'Training',
    allow: MANAGER_TIER,
    flagKey: 'training',
    backendGate: 'requireRole(...MANAGER_TIER) (AI authoring actions are ADMIN_TIER-gated)',
    scope: 'global',
    primaryActions: ['view AI generation status; retry is admin-only (backend fails closed)'],
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  {
    path: '/admin/users',
    sidebarLabel: 'Users',
    section: 'Admin',
    allow: ADMIN_TIER,
    capability: 'users',
    backendGate:
      'requireRoleOrCapability(ADMIN_TIER, users) + assertOutranks/canAssignRole/last-SA',
    scope: 'global',
    primaryActions: [
      'change role (canAssignRole only)',
      'impersonate (SUPER_ADMIN only)',
      'edit DEVELOPER capabilities (SUPER_ADMIN only, DEVELOPER targets)',
    ],
  },
  {
    path: '/invitations',
    sidebarLabel: 'Invitations',
    section: 'Admin',
    allow: OPERATOR_TIER,
    capability: 'invitations',
    backendGate:
      'requireRoleOrCapability(OPERATOR_TIER, invitations) + canAssignRole + assertCanAssignGroup',
    scope: 'group-scoped',
    primaryActions: [
      'invite roles below own rank (recruiter → CONSULTANT only)',
      'group restricted for group leads/recruiters',
    ],
  },
  {
    path: '/admin/groups',
    sidebarLabel: 'User Groups',
    section: 'Admin',
    allow: ADMIN_TIER,
    capability: 'user_groups',
    backendGate: 'requireRoleOrCapability(ADMIN_TIER, user_groups)',
    scope: 'global',
    primaryActions: ['create/edit/delete groups, set members (any group)'],
    workspaceWideException:
      'Group administration is ADMIN_TIER-global: any admin manages any group; group leads do NOT administer groups (they are scoped to their group elsewhere). See userGroups.gate.test.ts.',
  },
  {
    path: '/ai-usage',
    sidebarLabel: 'AI Usage',
    section: 'Admin',
    allow: MANAGER_TIER,
    capability: 'ai_usage',
    backendGate: 'requireRoleOrCapability(MANAGER_TIER, ai_usage)',
    scope: 'global',
    primaryActions: ['view AI usage dashboard'],
  },
  {
    path: '/ai-email',
    sidebarLabel: 'AI Email',
    section: 'Admin',
    allow: OPERATOR_TIER,
    flagKey: 'ai_email',
    backendGate: 'requireRole(...OPERATOR_TIER) + requireFeature(ai_email)',
    scope: 'group-scoped',
    primaryActions: ['draft AI emails'],
  },
  {
    path: '/admin/deactivated',
    sidebarLabel: 'Deactivated',
    section: 'Admin',
    allow: ADMIN_TIER,
    backendGate: 'requireRole(...ADMIN_TIER)',
    scope: 'global',
    primaryActions: ['view/reactivate deactivated accounts'],
  },
  {
    path: '/admin/features',
    sidebarLabel: 'Feature Flags',
    section: 'Admin',
    allow: OWNER_TIER,
    capability: 'feature_flags',
    backendGate: 'read: ADMIN_TIER; write: requireRoleOrCapability(OWNER_TIER, feature_flags)',
    scope: 'global',
    primaryActions: ['toggle flags + group overrides (OWNER_TIER: SUPER_ADMIN + CEO)'],
    workspaceWideException:
      'Feature-flag writes are OWNER_TIER (SUPER_ADMIN + CEO) — CEO owner power is intentional. CTO/DIRECTOR can read but not write. See capability.guard.test.ts feature-flag gate test.',
  },
  {
    path: '/admin/ai-settings',
    sidebarLabel: 'AI Settings',
    section: 'Admin',
    allow: ADMIN_TIER,
    backendGate: 'requireRole(...ADMIN_TIER)',
    scope: 'global',
    primaryActions: ['manage AI provider settings'],
  },
  {
    path: '/admin/audit-log',
    sidebarLabel: 'Audit Log',
    section: 'Admin',
    allow: ADMIN_TIER,
    backendGate: 'requireRole(...ADMIN_TIER)',
    scope: 'global',
    primaryActions: ['view audit log'],
  },
];

/** A role (with optional DEVELOPER capabilities) is admitted to a route. */
export function roleSeesRoute(
  role: Role,
  capabilities: DeveloperCapability[],
  p: RoutePolicy,
): boolean {
  if (p.allow.includes(role)) return true;
  if (p.capability && role === 'DEVELOPER' && capabilities.includes(p.capability)) return true;
  return false;
}

/**
 * Expected visible sidebar labels for a role — mirrors Sidebar.tsx's filter
 * (role/capability allow + flag not explicitly OFF). With `flags = {}` no
 * flag-gated item is hidden, so this is the role/capability boundary only.
 */
export function expectedSidebarLabels(
  role: Role,
  capabilities: DeveloperCapability[] = [],
  flags: Record<string, boolean> = {},
): string[] {
  return RBAC_MATRIX.filter((p) => p.sidebarLabel)
    .filter((p) => roleSeesRoute(role, capabilities, p))
    .filter((p) => !p.flagKey || flags[p.flagKey] !== false)
    .map((p) => p.sidebarLabel!);
}

/** Every sidebar label in the matrix (for "should NOT see" assertions). */
export const ALL_SIDEBAR_LABELS: string[] = RBAC_MATRIX.filter((p) => p.sidebarLabel).map(
  (p) => p.sidebarLabel!,
);
