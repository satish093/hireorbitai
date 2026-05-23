/**
 * Admin users page RBAC E2E tests.
 *
 * Verifies that:
 *   1. CONSULTANT, MANAGER, and RECRUITER are all redirected away from /admin/users.
 *   2. SUPER_ADMIN can access /admin/users and the page renders.
 *
 * The ProtectedRoute allows only ADMIN_ROLES (SUPER_ADMIN, CEO, CTO, DIRECTOR)
 * on the admin users route. Everyone else should land on /unauthorized.
 *
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import {
  seedSession,
  mockApi,
  MANAGER,
  CONSULTANT,
  RECRUITER,
  trackPageErrors,
  type MockProfile,
} from './_helpers';

const SUPER_ADMIN: MockProfile = {
  id: 'u-super',
  email: 'super@test.local',
  full_name: 'Sam Super',
  role: 'SUPER_ADMIN',
  is_active: true,
  must_change_password: false,
  tour_completed_at: '2024-01-01T00:00:00.000Z',
};

const ADMIN_PAGE_HANDLERS = {
  '/users': { json: [] },
  '/user-groups': { json: [] },
  '/recruiters': { json: [] },
  '/consultants': { json: [] },
};

test.describe('Admin users page — RBAC gate', () => {
  test('CONSULTANT is redirected away from /admin/users', async ({ page }) => {
    await seedSession(page, CONSULTANT);
    await mockApi(page, { profile: CONSULTANT, flags: {} });
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 8000 });
  });

  test('MANAGER is redirected away from /admin/users', async ({ page }) => {
    await seedSession(page, MANAGER);
    await mockApi(page, { profile: MANAGER, flags: {} });
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 8000 });
  });

  test('RECRUITER is redirected away from /admin/users', async ({ page }) => {
    await seedSession(page, RECRUITER);
    await mockApi(page, { profile: RECRUITER, flags: {} });
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 8000 });
  });

  test('SUPER_ADMIN can access /admin/users and page renders without errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, SUPER_ADMIN);
    await mockApi(page, {
      profile: SUPER_ADMIN,
      flags: {},
      handlers: ADMIN_PAGE_HANDLERS,
    });
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    // Should stay on /admin/users, not redirect
    await expect(page).toHaveURL(/\/admin\/users/, { timeout: 8000 });

    // Capture screenshot for visual review
    await page.screenshot({ path: 'e2e-results/admin-users-super-admin.png' });

    expect(errors).toHaveLength(0);
  });
});
