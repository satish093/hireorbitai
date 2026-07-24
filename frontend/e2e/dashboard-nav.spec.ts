import { test, expect } from '@playwright/test';
import { mockApi, seedSession, trackPageErrors, MANAGER } from './_helpers';

test.describe('Dashboard shell', () => {
  test('an authenticated manager paints the dashboard shell without crashing', async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: {},
      handlers: {
        // Null-safe responses: the dashboard renders its skeleton/shell without
        // touching nested metric fields, so no shape drift can crash the page.
        '/reports/manager-summary': { body: 'null' },
        '/tasks/metrics': { body: 'null' },
        '/jobs': { json: [] },
      },
    });

    await page.goto('/dashboard');

    // Did not bounce to /login or /unauthorized.
    await expect(page).toHaveURL(/\/dashboard$/);
    // The primary navigation landmark renders (Layout + Sidebar mounted). The
    // sidebar is an <aside> (role=complementary) labelled "Primary navigation".
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
    // No uncaught exception tripped the top-level ErrorBoundary.
    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
