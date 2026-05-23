/**
 * Job search page E2E tests.
 *
 * Covers:
 *   1. Jobs page renders job data from the mocked API.
 *   2. Page is accessible to any authenticated role (/jobs has no allow= restriction).
 *   3. Clicking a job navigates to the job detail page.
 *   4. No console errors throughout.
 *
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, RECRUITER, trackPageErrors } from './_helpers';

const MOCK_JOBS = [
  {
    id: 'j-1',
    title: 'Senior Software Engineer',
    company_name: 'Acme Corp',
    location: 'Remote',
    status: 'ACTIVE',
    job_type: 'FULL_TIME',
    source: 'manual',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'j-2',
    title: 'Frontend Developer',
    company_name: 'Beta Inc',
    location: 'New York, NY',
    status: 'ACTIVE',
    job_type: 'CONTRACT',
    source: 'jsearch',
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
];

const JOB_PAGE_HANDLERS = {
  '/jobs': { json: MOCK_JOBS },
  '/job-sources': { json: [] },
  '/consultants': { json: [] },
  '/recruiters': { json: [] },
};

test.describe('Job search page — rendering', () => {
  // /jobs has no allow= restriction — any authenticated role can access it.
  test('RECRUITER can see job listings from the mocked API', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, RECRUITER);
    await mockApi(page, {
      profile: RECRUITER,
      flags: {},
      handlers: JOB_PAGE_HANDLERS,
    });
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Senior Software Engineer')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Frontend Developer')).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('RECRUITER job search page URL stays at /jobs', async ({ page }) => {
    await seedSession(page, RECRUITER);
    await mockApi(page, {
      profile: RECRUITER,
      flags: {},
      handlers: JOB_PAGE_HANDLERS,
    });
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/jobs$/);
  });

  test('RECRUITER clicking a job navigates to the job detail page', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, RECRUITER);
    await mockApi(page, {
      profile: RECRUITER,
      flags: {},
      handlers: {
        ...JOB_PAGE_HANDLERS,
        '/jobs/j-1': { json: MOCK_JOBS[0] },
      },
    });
    await page.goto('/jobs');

    await expect(page.getByText('Senior Software Engineer')).toBeVisible({ timeout: 8000 });
    await page.getByText('Senior Software Engineer').first().click();

    // Should navigate to job detail (/jobs/:id)
    await expect(page).toHaveURL(/\/jobs\/j-1/, { timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('RECRUITER load the job search page without console errors (second check)', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, RECRUITER);
    await mockApi(page, {
      profile: RECRUITER,
      flags: {},
      handlers: JOB_PAGE_HANDLERS,
    });
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
