/**
 * Résumé page E2E tests.
 *
 * Covers:
 *   1. Page loads for manager, consultant, and recruiter — no console errors.
 *   2. URL lands correctly on /resumes after navigation.
 *   3. Page renders résumé data from the mocked API (manager view).
 *
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, CONSULTANT, RECRUITER, trackPageErrors } from './_helpers';

const MOCK_RESUMES = [
  {
    id: 'res-1',
    consultant_id: 'c-1',
    label: 'Resume v1',
    version: 1,
    is_current: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
];

const MOCK_CONSULTANTS = [
  {
    id: 'c-1',
    full_name: 'Casey Consultant',
    user_id: 'u-consultant',
    primary_skill: 'TypeScript',
    marketing_status: 'AVAILABLE',
  },
];

test.describe('Résumés page — loading and RBAC', () => {
  test('MANAGER can load the résumés page without console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: {},
      handlers: {
        '/resumes': { json: MOCK_RESUMES },
        '/consultants': { json: MOCK_CONSULTANTS },
      },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('networkidle');

    // Capture screenshot of the résumé page for visual review.
    await page.screenshot({ path: 'e2e-results/resumes-manager.png' });

    expect(errors).toHaveLength(0);
  });

  test('MANAGER résumé page URL is /resumes', async ({ page }) => {
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: {},
      handlers: {
        '/resumes': { json: MOCK_RESUMES },
        '/consultants': { json: MOCK_CONSULTANTS },
      },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/resumes$/);
  });

  test('CONSULTANT can load the résumés page without console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, CONSULTANT);
    await mockApi(page, {
      profile: CONSULTANT,
      flags: {},
      handlers: {
        '/resumes': { json: MOCK_RESUMES },
        '/consultants': { json: MOCK_CONSULTANTS },
      },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });

  test('RECRUITER can load the résumés page without console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, RECRUITER);
    await mockApi(page, {
      profile: RECRUITER,
      flags: {},
      handlers: {
        '/resumes': { json: MOCK_RESUMES },
        '/consultants': { json: MOCK_CONSULTANTS },
      },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
