/**
 * Navigation model — a direct port of NAV_SECTIONS + filterNavSections from
 * frontend/src/components/Sidebar.tsx.
 *
 * Same destinations, same role sets, same capability grants, same feature-flag
 * keys. Keeping one model means a user sees the SAME set of places on their
 * phone as on their laptop; if a nav item is added on the web, it is added here
 * and nowhere else in the app.
 *
 * The only field that differs is the route string, because expo-router paths
 * are grouped under `(app)` where react-router used bare paths.
 *
 * Reminder: this gating is presentational. The backend re-checks every one of
 * these rules on every request.
 */

import type { IconName } from '../components/ui/Icon';
import {
  ALL_ROLES,
  ADMIN_TIER,
  BUSINESS_ROLES,
  MANAGER_TIER,
  MESSAGING_ROLES,
  OPERATOR_TIER,
  OWNER_TIER,
  hasCapability,
  type DeveloperCapability,
  type Role,
  type UserProfile,
} from '../types';

export type BadgeKey = 'tasks' | 'reminders' | 'inbox';

export interface NavItem {
  /** expo-router href. */
  to: string;
  label: string;
  roles: Role[];
  icon: IconName;
  badgeKey?: BadgeKey;
  flagKey?: string;
  capability?: DeveloperCapability;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Workspace',
    items: [
      { to: '/(app)/dashboard', label: 'Dashboard', icon: 'home', roles: ALL_ROLES },
      {
        to: '/(app)/tasks',
        label: 'Tasks',
        icon: 'tasks',
        roles: BUSINESS_ROLES,
        badgeKey: 'tasks',
        flagKey: 'tasks',
      },
      {
        to: '/(app)/tasks-assigned',
        label: 'Assigned to me',
        icon: 'tasks',
        roles: BUSINESS_ROLES,
        flagKey: 'tasks',
      },
      { to: '/(app)/calendar', label: 'Calendar', icon: 'calendar', roles: BUSINESS_ROLES },
      {
        to: '/(app)/messages',
        label: 'Inbox',
        icon: 'inbox',
        roles: MESSAGING_ROLES,
        badgeKey: 'inbox',
        flagKey: 'messages',
      },
      {
        to: '/(app)/reminders',
        label: 'Reminders',
        icon: 'reminder',
        roles: BUSINESS_ROLES,
        badgeKey: 'reminders',
        flagKey: 'reminders',
      },
      { to: '/(app)/my-resume', label: 'My Resume', icon: 'file', roles: ['CONSULTANT'] },
    ],
  },
  {
    heading: 'Talent',
    items: [
      { to: '/(app)/consultants', label: 'Consultants', icon: 'users', roles: OPERATOR_TIER },
      { to: '/(app)/recruiters', label: 'Recruiters', icon: 'user', roles: MANAGER_TIER },
      { to: '/(app)/managers', label: 'Managers', icon: 'usersCog', roles: MANAGER_TIER },
      { to: '/(app)/jobs', label: 'Jobs', icon: 'briefcase', roles: OPERATOR_TIER },
      { to: '/(app)/applications', label: 'Applications', icon: 'fileText', roles: OPERATOR_TIER },
      {
        to: '/(app)/interviews',
        label: 'Interviews',
        icon: 'video',
        roles: BUSINESS_ROLES,
        flagKey: 'interviews',
      },
      { to: '/(app)/resumes', label: 'Resumes', icon: 'file', roles: OPERATOR_TIER },
      { to: '/(app)/vendors', label: 'Vendors', icon: 'building', roles: OPERATOR_TIER },
      { to: '/(app)/clients', label: 'Clients', icon: 'building2', roles: OPERATOR_TIER },
      {
        to: '/(app)/invoices',
        label: 'Invoices',
        icon: 'fileText',
        roles: MANAGER_TIER,
        flagKey: 'invoices',
      },
      {
        to: '/(app)/reports',
        label: 'Analytics',
        icon: 'barChart',
        roles: OPERATOR_TIER,
        flagKey: 'reports',
        capability: 'reports',
      },
    ],
  },
  {
    heading: 'Training',
    items: [
      {
        to: '/(app)/training/courses',
        label: 'Courses',
        icon: 'bookOpen',
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
      {
        to: '/(app)/training/assignments',
        label: 'Assignments',
        icon: 'clipboard',
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
      {
        to: '/(app)/training/my',
        label: 'My Training',
        icon: 'graduation',
        roles: BUSINESS_ROLES,
        flagKey: 'training',
      },
      {
        to: '/(app)/training/plan',
        label: 'Study plan',
        icon: 'bookOpen',
        roles: BUSINESS_ROLES,
        flagKey: 'training',
      },
      {
        to: '/(app)/training/reports',
        label: 'Training Reports',
        icon: 'barChart',
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
      {
        to: '/(app)/training/ai-activity',
        label: 'AI Activity',
        icon: 'sparkles',
        roles: MANAGER_TIER,
        flagKey: 'training',
      },
    ],
  },
  {
    heading: 'Admin',
    items: [
      {
        to: '/(app)/admin/users',
        label: 'Users',
        icon: 'users',
        roles: ADMIN_TIER,
        capability: 'users',
      },
      {
        to: '/(app)/invitations',
        label: 'Invitations',
        icon: 'mailPlus',
        roles: OPERATOR_TIER,
        capability: 'invitations',
      },
      {
        to: '/(app)/admin/groups',
        label: 'User Groups',
        icon: 'usersCog',
        roles: ADMIN_TIER,
        capability: 'user_groups',
      },
      {
        to: '/(app)/ai-usage',
        label: 'AI Usage',
        icon: 'sparkles',
        roles: MANAGER_TIER,
        capability: 'ai_usage',
      },
      {
        to: '/(app)/ai-email',
        label: 'AI Email',
        icon: 'mailPlus',
        roles: OPERATOR_TIER,
        flagKey: 'ai_email',
      },
      { to: '/(app)/admin/deactivated', label: 'Deactivated', icon: 'userX', roles: ADMIN_TIER },
      {
        to: '/(app)/admin/features',
        label: 'Feature Flags',
        icon: 'toggle',
        roles: ADMIN_TIER,
        capability: 'feature_flags',
      },
      { to: '/(app)/admin/ai-settings', label: 'AI Settings', icon: 'sparkles', roles: OWNER_TIER },
      { to: '/(app)/admin/audit-log', label: 'Audit Log', icon: 'clipboard', roles: ADMIN_TIER },
      {
        to: '/(app)/admin/calls-usage',
        label: 'Call Usage',
        icon: 'phone',
        roles: OWNER_TIER,
        capability: 'calls_usage',
      },
    ],
  },
];

/**
 * Gate the nav model for a given user: drop items the role / capability / flag
 * rules hide, then drop sections left empty.
 *
 * Byte-for-byte the same logic as the web's filterNavSections — including the
 * detail that a capability grant can substitute for role membership, but a
 * disabled feature flag hides the item regardless.
 */
export function filterNavSections(
  role: Role | undefined,
  profile: Pick<UserProfile, 'role' | 'capabilities'> | null | undefined,
  flags: Record<string, boolean | undefined>,
): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((i) => {
      const roleOk =
        !role ||
        i.roles.includes(role) ||
        (i.capability ? hasCapability(profile, i.capability) : false);
      if (!roleOk) return false;
      if (i.flagKey && flags[i.flagKey] === false) return false;
      return true;
    }),
  })).filter((s) => s.items.length > 0);
}
