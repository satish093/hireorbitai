import { test, expect } from '@playwright/test';
import { mockApi, seedSession, trackPageErrors, MANAGER, CONSULTANT, RECRUITER } from './_helpers';

/**
 * Role-based routing: the same /dashboard URL resolves to a different dashboard
 * per role, onboarding gates fire when the role-specific id is missing, and a
 * tier-gated admin route fails closed for a manager.
 */
test.describe('Role-based access', () => {
  test('a CONSULTANT without consultant_id is redirected to onboarding', async ({ page }) => {
    const unfinished = { ...CONSULTANT, consultant_id: null };
    await seedSession(page, unfinished);
    await mockApi(page, { profile: unfinished, flags: {} });

    await page.goto('/dashboard');

    // ProtectedRoute's onboarding gate sends an un-provisioned consultant to
    // the consultant onboarding flow rather than the dashboard.
    await expect(page).toHaveURL(/\/onboarding\/consultant$/);
  });

  test('a finished CONSULTANT lands on the consultant dashboard (not the manager one)', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await seedSession(page, CONSULTANT);
    await mockApi(page, {
      profile: CONSULTANT,
      flags: {},
      // Consultant dashboard fetches these; defaults already return []/null-safe
      // but pin them so widgets never touch undefined nested fields.
      handlers: {
        '/consultants': { json: [] },
        '/applications': { json: [] },
        '/interviews': { json: [] },
      },
    });

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/dashboard$/);
    // Consultant-only copy from ConsultantDashboard's PageHeader description.
    await expect(page.getByText(/marketing status, recent submissions/i)).toBeVisible();
    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('a finished RECRUITER lands on the recruiter dashboard', async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await seedSession(page, RECRUITER);
    await mockApi(page, {
      profile: RECRUITER,
      flags: {},
      handlers: {
        '/consultants': { json: [] },
        '/applications': { json: [] },
        '/activity': { json: [] },
      },
    });

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
    // Recruiter-only quick action from RecruiterDashboard's PageHeader.
    await expect(page.getByRole('button', { name: 'Log submission' })).toBeVisible();
    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('a MANAGER hitting /admin/users (ADMIN_TIER only) is sent to /unauthorized', async ({
    page,
  }) => {
    await seedSession(page, MANAGER);
    await mockApi(page, { profile: MANAGER, flags: {} });

    await page.goto('/admin/users');

    // MANAGER is below ADMIN_TIER, so the role allow-list rejects the route.
    await expect(page).toHaveURL(/\/unauthorized$/);
    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
  });
});
