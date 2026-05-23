/**
 * Training page E2E tests.
 *
 * Covers:
 *   1. Feature flag OFF → training routes show the disabled panel.
 *   2. Feature flag ON → training courses list renders correctly.
 *   3. CONSULTANT with training enabled can load their training page without errors.
 *
 * Mirrors the pattern established in feature-guard.spec.ts and task-flows.spec.ts.
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, CONSULTANT, trackPageErrors } from './_helpers';

const MOCK_COURSES = [
  {
    id: 'course-1',
    title: 'Intro to AWS',
    status: 'PUBLISHED',
    category: 'AWS',
    description: 'Cloud fundamentals for consultants',
    created_by: 'u-manager',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'course-2',
    title: 'TypeScript Deep Dive',
    status: 'PUBLISHED',
    category: 'Node.js',
    description: 'Advanced TypeScript patterns',
    created_by: 'u-manager',
    created_at: '2024-01-02T00:00:00Z',
  },
];

test.describe('Training page — feature flag gate', () => {
  test('shows a disabled panel when the training flag is off', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { training: false },
    });
    await page.goto('/training');
    await page.waitForLoadState('networkidle');

    // The FeatureGuard renders a "feature is turned off" message when disabled.
    await expect(page.getByText(/turned off|not enabled|feature.*disabled/i).first()).toBeVisible({
      timeout: 8000,
    });

    expect(errors).toHaveLength(0);
  });
});

test.describe('Training page — course list rendering', () => {
  test('MANAGER can see training courses at /training/courses when the flag is on', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { training: true },
      handlers: {
        '/training/courses': { json: MOCK_COURSES },
        '/training/assignments': { json: [] },
        '/training/reports': { json: [] },
      },
    });
    // /training shows MyTraining (personal progress). Course list is at /training/courses.
    await page.goto('/training/courses');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Intro to AWS')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('TypeScript Deep Dive')).toBeVisible({ timeout: 8000 });

    // Capture screenshot for visual review
    await page.screenshot({ path: 'e2e-results/training-courses-manager.png' });

    expect(errors).toHaveLength(0);
  });

  test('CONSULTANT can load training page without console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, CONSULTANT);
    await mockApi(page, {
      profile: CONSULTANT,
      flags: { training: true },
      handlers: {
        '/training/assignments': { json: [] },
        '/training/courses': { json: MOCK_COURSES },
      },
    });
    await page.goto('/training');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
