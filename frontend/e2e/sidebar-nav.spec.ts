import { test, expect, type Page } from '@playwright/test';
import { mockApi, seedSession, type MockProfile, type Role } from './_helpers';
import { expectedSidebarLabels, ALL_SIDEBAR_LABELS } from './fixtures/rbacMatrix';
import type { DeveloperCapability } from '../src/types';

/**
 * Sidebar parity by role, driven by the RBAC matrix (fixtures/rbacMatrix.ts).
 *
 * For every role we compute the EXACT set of sidebar labels the matrix says it
 * may see, then assert the rendered sidebar shows exactly those and none of the
 * others. Because the expectation comes from the matrix — not a hand-kept list —
 * a drift between the matrix, the Sidebar component, and the route guards fails
 * here. Flags are passed empty so only the role/capability boundary is tested.
 */

function profileFor(role: Role, capabilities: DeveloperCapability[] = []): MockProfile {
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
    capabilities,
  };
}

function navLink(page: Page, label: string) {
  return page
    .getByRole('complementary', { name: 'Primary navigation' })
    .getByRole('link', { name: label, exact: true });
}

const ROLES: Role[] = [
  'SUPER_ADMIN',
  'CEO',
  'CTO',
  'DIRECTOR',
  'HR_MANAGER',
  'MANAGER',
  'RECRUITER',
  'CONSULTANT',
];

test.describe('Sidebar parity by role (matrix-driven)', () => {
  for (const role of ROLES) {
    test(`${role} sees exactly its matrix labels`, async ({ page }) => {
      const profile = profileFor(role);
      await seedSession(page, profile);
      await mockApi(page, { profile, flags: {} });
      await page.goto('/dashboard');
      await expect(navLink(page, 'Dashboard')).toBeVisible();

      const expected = new Set(expectedSidebarLabels(role));
      for (const label of expected) {
        // Assert DOM presence (membership parity) rather than toBeVisible — a
        // collapsible section's open/close animation can momentarily zero an
        // item's height, which would flake a strict visibility check.
        await expect(navLink(page, label), `${role} should see "${label}"`).toHaveCount(1);
      }
      for (const label of ALL_SIDEBAR_LABELS) {
        if (expected.has(label)) continue;
        await expect(navLink(page, label), `${role} should NOT see "${label}"`).toHaveCount(0);
      }
    });
  }

  test('DEVELOPER with no capabilities sees Dashboard + Inbox (support-chat exception)', async ({
    page,
  }) => {
    const profile = profileFor('DEVELOPER');
    await seedSession(page, profile);
    await mockApi(page, { profile, flags: {} });
    await page.goto('/dashboard');
    await expect(navLink(page, 'Dashboard')).toBeVisible();

    // Inbox is the ONE business-app surface DEVELOPER also sees so every user
    // can reach them for bug/error reporting. Everything else stays hidden
    // until a capability is granted.
    const expected = new Set(expectedSidebarLabels('DEVELOPER', []));
    expect([...expected].sort()).toEqual(['Dashboard', 'Inbox']);
    for (const label of ALL_SIDEBAR_LABELS) {
      if (expected.has(label)) continue;
      await expect(navLink(page, label), `dev should NOT see "${label}"`).toHaveCount(0);
    }
  });

  test('DEVELOPER + [users, reports] sees Dashboard + Inbox + Users + Analytics', async ({
    page,
  }) => {
    const caps: DeveloperCapability[] = ['users', 'reports'];
    const profile = profileFor('DEVELOPER', caps);
    await seedSession(page, profile);
    await mockApi(page, { profile, flags: {} });
    await page.goto('/dashboard');
    // A DEVELOPER with the users cap is routed straight to /admin/users.
    await expect(page).toHaveURL(/\/admin\/users$/);

    const expected = new Set(expectedSidebarLabels('DEVELOPER', caps));
    for (const label of expected) {
      await expect(navLink(page, label), `dev+caps should see "${label}"`).toHaveCount(1);
    }
    for (const label of ALL_SIDEBAR_LABELS) {
      if (expected.has(label)) continue;
      await expect(navLink(page, label), `dev+caps should NOT see "${label}"`).toHaveCount(0);
    }
  });
});
