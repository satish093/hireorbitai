import { test, expect } from '@playwright/test';
import { mockApi, seedSession, trackPageErrors, MANAGER } from './_helpers';

/**
 * Auth lifecycle from an already-authenticated session: explicit sign-out and
 * involuntary boot when the stored token is no longer accepted by the backend.
 */
test.describe('Authenticated session lifecycle', () => {
  test('signing out returns the user to /login', async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: {},
      handlers: {
        '/reports/manager-summary': { body: 'null' },
        '/tasks/metrics': { body: 'null' },
        '/jobs': { json: [] },
        // Best-effort revoke the AuthContext fires on signOut.
        'POST /auth/logout': { json: { ok: true } },
      },
    });

    await page.goto('/dashboard');
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();

    // The sign-out control is an icon-only button whose accessible name comes
    // from its title attribute. Scope to the sidebar to avoid the mobile copy.
    const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
    await sidebar.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('an expired/invalid token (GET /auth/me 401) lands on /unauthorized', async ({ page }) => {
    // A seeded session whose profile fetch is rejected. /auth/me is an auth
    // route, so api.ts does NOT boot to /login on its 401 — instead the profile
    // stays null and ProtectedRoute fails closed to /unauthorized (session
    // present, no usable profile). That page offers a sign-out back to /login.
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: null, // GET /auth/me → 401 in the helper's default branch
      flags: {},
    });

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/unauthorized$/);
    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
