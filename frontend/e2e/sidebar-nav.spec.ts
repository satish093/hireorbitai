import { test, expect, type Page } from '@playwright/test';
import { mockApi, seedSession, type MockProfile, type Role } from './_helpers';

/**
 * Sidebar / route parity by role. The sidebar is the visible half of the RBAC
 * contract — its `roles` / `capability` gates must line up with the App.tsx
 * route allow-lists and the backend tier gates. This pins the *boundary* label
 * each tier may and may not see, for all nine business roles plus a DEVELOPER
 * with and without a capability grant.
 *
 * Flags are passed empty (`{}`), so flag-gated items are NOT hidden — only the
 * role/capability gate is under test here. The exhaustive route-guard coverage
 * lives in role-access.spec.ts; this asserts the nav mirrors it.
 */

function profileFor(role: Role, extra: Partial<MockProfile> = {}): MockProfile {
  return {
    id: `u-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@test.local`,
    full_name: `Test ${role}`,
    role,
    is_active: true,
    must_change_password: false,
    tour_completed_at: '2024-01-01T00:00:00.000Z',
    // Onboarding-complete ids so the operator roles don't get gated to onboarding.
    consultant_id: role === 'CONSULTANT' ? 'c-1' : null,
    recruiter_id: role === 'RECRUITER' ? 'r-1' : null,
    ...extra,
  };
}

/** A nav link is "visible" when its exact-name link renders in the sidebar. */
function navLink(page: Page, label: string) {
  return page
    .getByRole('complementary', { name: 'Primary navigation' })
    .getByRole('link', { name: label, exact: true });
}

interface Expectation {
  name: string;
  profile: MockProfile;
  sees: string[];
  hidden: string[];
}

const cases: Expectation[] = [
  {
    name: 'CONSULTANT — workspace + own training only',
    profile: profileFor('CONSULTANT'),
    sees: ['Dashboard', 'Jobs', 'My Training'],
    hidden: ['Consultants', 'Applications', 'Recruiters', 'Users'],
  },
  {
    name: 'RECRUITER — operator surfaces, no manager/admin',
    profile: profileFor('RECRUITER'),
    sees: ['Consultants', 'Applications', 'Invitations', 'Resumes'],
    hidden: ['Recruiters', 'Analytics', 'Users', 'Feature Flags'],
  },
  {
    name: 'MANAGER — manager tier, no admin',
    profile: profileFor('MANAGER'),
    sees: ['Recruiters', 'Analytics', 'AI Usage', 'Courses'],
    hidden: ['Users', 'User Groups', 'Feature Flags'],
  },
  {
    name: 'HR_MANAGER — manager tier (parity with MANAGER), no admin',
    profile: profileFor('HR_MANAGER'),
    sees: ['Recruiters', 'Analytics', 'AI Usage'],
    hidden: ['Users', 'Feature Flags'],
  },
  {
    name: 'DIRECTOR — admin tier, no owner-only',
    profile: profileFor('DIRECTOR'),
    sees: ['Users', 'User Groups', 'Deactivated', 'Audit Log'],
    hidden: ['Feature Flags'],
  },
  {
    name: 'CTO — admin tier, no owner-only',
    profile: profileFor('CTO'),
    sees: ['Users', 'User Groups'],
    hidden: ['Feature Flags'],
  },
  {
    name: 'CEO — owner tier sees everything incl. Feature Flags',
    profile: profileFor('CEO'),
    sees: ['Users', 'Feature Flags', 'Recruiters'],
    hidden: [],
  },
  {
    name: 'SUPER_ADMIN — absolute, sees Feature Flags',
    profile: profileFor('SUPER_ADMIN'),
    sees: ['Users', 'Feature Flags', 'Analytics'],
    hidden: [],
  },
  {
    name: 'DEVELOPER (no capabilities) — Dashboard only',
    profile: profileFor('DEVELOPER'),
    sees: ['Dashboard'],
    hidden: ['Tasks', 'Jobs', 'Users', 'Feature Flags'],
  },
  {
    name: 'DEVELOPER + users capability — Dashboard + Users only',
    profile: profileFor('DEVELOPER', { capabilities: ['users'] }),
    sees: ['Dashboard', 'Users'],
    hidden: ['Tasks', 'Feature Flags', 'Recruiters'],
  },
];

test.describe('Sidebar parity by role', () => {
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await seedSession(page, c.profile);
      await mockApi(page, { profile: c.profile, flags: {} });
      await page.goto('/dashboard');

      // Wait for the nav to mount before asserting absence.
      await expect(navLink(page, 'Dashboard')).toBeVisible();

      for (const label of c.sees) {
        await expect(navLink(page, label), `${c.profile.role} should see "${label}"`).toBeVisible();
      }
      for (const label of c.hidden) {
        await expect(
          navLink(page, label),
          `${c.profile.role} should NOT see "${label}"`,
        ).toHaveCount(0);
      }
    });
  }
});
