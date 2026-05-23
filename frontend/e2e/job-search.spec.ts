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
 *
 * StrictMode + dedup workaround: React 18 StrictMode double-mounts effects,
 * which causes the GET dedup cache (api.ts) to reuse the aborted first
 * request for the second mount — resulting in an empty feed on initial render.
 * The cache clears when the aborted promise settles. To get reliable job data,
 * we switch to a different tab and back after the page loads; that triggers a
 * fresh non-deduped request for /jobs/recommended.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, RECRUITER, trackPageErrors } from './_helpers';

// Backend returns embedded client/vendor joins alongside top-level company_name.
// JobCard resolves: company_name ?? client?.company_name ?? vendor?.company_name.
const MOCK_JOBS = [
  {
    id: 'j-1',
    title: 'Senior Software Engineer',
    company_name: 'Acme Corp',
    client: { id: 'cl-1', company_name: 'Acme Corp' },
    vendor: null,
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
    client: { id: 'cl-2', company_name: 'Beta Inc' },
    vendor: null,
    location: 'New York, NY',
    status: 'ACTIVE',
    job_type: 'CONTRACT',
    source: 'jsearch',
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
];

// Default tab is "recommended" → fetches /jobs/recommended with pagination shape.
const RECOMMENDED_RESPONSE = {
  rows: MOCK_JOBS,
  page: 1,
  per_page: 40,
  total: 2,
  total_pages: 1,
};

const JOB_PAGE_HANDLERS = {
  '/jobs/recommended': { json: RECOMMENDED_RESPONSE },
  '/job-sources': { json: [] },
  '/consultants': { json: [] },
  '/recruiters': { json: [] },
};

/**
 * After the page loads (StrictMode double-mount leaves feed empty due to GET
 * dedup), cycle through the "Saved" tab and back to "Top" to trigger a fresh
 * /jobs/recommended request with a clean dedup cache.
 */
async function forceRecommendedReload(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Saved' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /^Top/ }).click();
  await page.waitForLoadState('networkidle');
}

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
    await forceRecommendedReload(page);

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
    await forceRecommendedReload(page);

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
