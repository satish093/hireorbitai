import { test, expect } from '@playwright/test';
import { mockApi, seedSession, CONSULTANT } from './_helpers';

test.describe('Route guards (fail-closed RBAC)', () => {
  test('unauthenticated access to a protected route redirects to /login', async ({ page }) => {
    await mockApi(page); // no profile → /auth/me would 401, but no session is seeded
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('a CONSULTANT hitting an admin route lands on /unauthorized', async ({ page }) => {
    await seedSession(page, CONSULTANT);
    await mockApi(page, { profile: CONSULTANT, flags: {} });
    await page.goto('/admin/users');

    // ProtectedRoute checks the role allow-list before rendering the page.
    await expect(page).toHaveURL(/\/unauthorized$/);
  });
});
