/**
 * Résumé page E2E tests.
 *
 * Covers:
 *   1. Page loads for manager, consultant, and recruiter — no console errors.
 *   2. URL lands correctly on /resumes after navigation.
 *   3. Page renders résumé versions from the mocked API (manager view).
 *
 * Mock data shapes match the actual backend ResumeVersion type:
 *   { id, consultant_id, version: number, file_name, ai_score, is_current,
 *     created_at, tailored_for_job_id, tailored_job }
 * ResumeVersionStrip renders v{version} (e.g. "v1") — there is no "label" field.
 * Resumes.tsx shows the SelectInput picker when consultants.length > 1; with a
 * single consultant it auto-selects and fires /resumes/consultant/:id.
 * Consultant shape: user object nested ({ id, full_name, email }), not top-level.
 *
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, CONSULTANT, RECRUITER, trackPageErrors } from './_helpers';

// Backend-accurate consultant shape: user object nested, not top-level full_name.
const MOCK_CONSULTANTS = [
  {
    id: 'c-1',
    marketing_status: 'ACTIVE',
    recruiter_id: null,
    user: { id: 'u-c1', full_name: 'Casey Consultant', email: 'consultant@test.local' },
  },
];

// Backend-accurate ResumeVersion shape.
// No `label` field; ResumeVersionStrip displays v{version} (e.g., "v1").
const MOCK_RESUME_VERSIONS = [
  {
    id: 'res-1',
    consultant_id: 'c-1',
    version: 1,
    file_name: 'casey-resume-v1.pdf',
    ai_score: 78,
    is_current: true,
    created_at: '2024-01-01T00:00:00Z',
    tailored_for_job_id: null,
    tailored_job: null,
  },
  {
    id: 'res-2',
    consultant_id: 'c-1',
    version: 2,
    file_name: 'casey-resume-v2.pdf',
    ai_score: 85,
    is_current: false,
    created_at: '2024-03-01T00:00:00Z',
    tailored_for_job_id: null,
    tailored_job: null,
  },
];

test.describe('Résumés page — loading and RBAC', () => {
  test('MANAGER sees resume versions after auto-select (single consultant)', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: {},
      handlers: {
        // Single consultant → useResumeWorkspace auto-selects and fetches versions.
        '/consultants': { json: MOCK_CONSULTANTS },
        '/resumes/consultant/c-1': { json: MOCK_RESUME_VERSIONS },
      },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('networkidle');

    // ResumeVersionStrip renders v{version} for each version card.
    await expect(page.getByText('v1').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('casey-resume-v1.pdf').first()).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/resumes-manager.png' });

    expect(errors).toHaveLength(0);
  });

  test('MANAGER résumé page URL is /resumes', async ({ page }) => {
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: {},
      handlers: {
        '/consultants': { json: MOCK_CONSULTANTS },
        '/resumes/consultant/c-1': { json: MOCK_RESUME_VERSIONS },
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
        '/consultants': { json: MOCK_CONSULTANTS },
        '/resumes/consultant/c-1': { json: MOCK_RESUME_VERSIONS },
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
        '/consultants': { json: MOCK_CONSULTANTS },
        '/resumes/consultant/c-1': { json: MOCK_RESUME_VERSIONS },
      },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
