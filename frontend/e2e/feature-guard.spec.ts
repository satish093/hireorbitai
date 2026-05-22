import { test, expect } from '@playwright/test';
import { mockApi, seedSession, MANAGER } from './_helpers';

test.describe('Feature flag guard', () => {
  test('a disabled feature shows the disabled panel instead of crashing', async ({ page }) => {
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { messages: false },
    });

    await page.goto('/messages');

    // FeatureGuard renders FeatureDisabledPanel rather than mounting the page.
    await expect(page.getByText(/is turned off/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to dashboard' })).toBeVisible();
  });

  test('an enabled feature mounts the page (no disabled panel)', async ({ page }) => {
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { messages: true },
    });

    await page.goto('/messages');

    await expect(page).toHaveURL(/\/messages$/);
    await expect(page.getByText(/is turned off/i)).toHaveCount(0);
  });
});
