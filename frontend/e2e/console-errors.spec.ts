import { test, expect, type Page } from '@playwright/test';
import { mockApi, seedSession, trackPageErrors, MANAGER } from './_helpers';

/**
 * A clean-console guard. Loading the two highest-traffic surfaces (the login
 * screen and the manager dashboard) must produce ZERO uncaught exceptions and
 * ZERO console.error output. This catches dashboard render failures, missing
 * null-guards, and ErrorBoundary trips that don't necessarily change the URL.
 */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('Clean console', () => {
  test('/login loads with no uncaught exceptions or console errors', async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    const consoleErrors = collectConsoleErrors(page);
    await mockApi(page);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toHaveLength(0);
  });

  test('the manager /dashboard paints with no uncaught exceptions or console errors', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const consoleErrors = collectConsoleErrors(page);
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: {},
      handlers: {
        // Null-safe metric shapes so dashboard widgets never crash the boundary.
        '/reports/manager-summary': { body: 'null' },
        '/tasks/metrics': { body: 'null' },
        '/jobs': { json: [] },
        '/consultants': { json: [] },
        '/applications': { json: [] },
        '/activity': { json: [] },
      },
    });

    await page.goto('/dashboard');
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toHaveLength(0);
  });
});
