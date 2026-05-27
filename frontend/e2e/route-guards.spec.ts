import { test, expect } from '@playwright/test';
import { mockApi, seedSession, type MockProfile, type Role, CONSULTANT } from './_helpers';
import { RBAC_MATRIX, roleSeesRoute } from './fixtures/rbacMatrix';

/**
 * Route guards (fail-closed RBAC), driven by the RBAC matrix.
 *
 * DoD #1: "every role has a clear allow/deny policy for every route" and "hidden
 * pages must be blocked by the route guard, not just hidden." For each protected
 * route in the matrix we pick a role that is NOT allowed and assert the guard
 * sends it to /unauthorized — proving the guard, not merely the sidebar, denies
 * access. The allowed direction is covered by role-access + sidebar specs.
 */

const CANDIDATE_ROLES: Role[] = [
  'CONSULTANT',
  'RECRUITER',
  'MANAGER',
  'DIRECTOR',
  'CEO',
  'SUPER_ADMIN',
];

function profileFor(role: Role): MockProfile {
  return {
    id: `u-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@test.local`,
    full_name: `Test ${role}`,
    role,
    is_active: true,
    must_change_password: false,
    tour_completed_at: '2024-01-01T00:00:00.000Z',
    consultant_id: role === 'CONSULTANT' ? 'c-1' : null,
    recruiter_id: role === 'RECRUITER' ? 'r-1' : null,
    capabilities: [],
  };
}

test.describe('Route guards (fail-closed RBAC)', () => {
  test('unauthenticated access to a protected route redirects to /login', async ({ page }) => {
    await mockApi(page); // no profile/session
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  // Every route except /dashboard (allowed to ALL_ROLES) must deny at least one
  // role. Pick the lowest-tier role outside the allow-list as the prober.
  for (const policy of RBAC_MATRIX) {
    if (policy.path === '/dashboard') continue; // ALL_ROLES — no denied role
    const deniedRole = CANDIDATE_ROLES.find((r) => !roleSeesRoute(r, [], policy));
    if (!deniedRole) continue;

    test(`${deniedRole} is denied ${policy.path} (guard, not just hidden)`, async ({ page }) => {
      const profile = profileFor(deniedRole);
      await seedSession(page, profile);
      // Pass all flags ON so a denial is the ROLE guard, not a feature flag.
      await mockApi(page, {
        profile,
        flags: {
          tasks: true,
          messages: true,
          reminders: true,
          interviews: true,
          reports: true,
          training: true,
          ai_email: true,
        },
      });
      await page.goto(policy.path);
      await expect(page).toHaveURL(/\/unauthorized$/);
    });
  }

  test('a CONSULTANT hitting an admin route lands on /unauthorized', async ({ page }) => {
    await seedSession(page, CONSULTANT);
    await mockApi(page, { profile: CONSULTANT, flags: {} });
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/unauthorized$/);
  });
});
