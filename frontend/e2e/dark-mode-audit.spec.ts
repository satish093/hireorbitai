/**
 * Dark-mode axe audit — desktop (1280×800) and mobile (390×844).
 *
 * For each of the 12 major pages, in both viewport sizes:
 *   1. Load the page with rich mock data.
 *   2. Inject [data-theme="dark"] on <html> to flip all design tokens to their
 *      dark-mode values (Tailwind darkMode: ['selector', '[data-theme="dark"]']).
 *   3. Wait one animation frame so the browser applies the new computed styles.
 *   4. Screenshot → e2e-results/dark-{viewport}-{page}.png.
 *   5. axe audit — fail on any critical or serious violation.
 *
 * Pages: dashboard, tasks, consultants, jobs, calendar, interviews, reminders,
 *        applications, reports, messages, training/courses, resumes.
 */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, mockApi, MANAGER, RECRUITER, CONSULTANT } from './_helpers';
import {
  MOCK_TASKS,
  MOCK_CONSULTANTS,
  MOCK_RECRUITERS,
  MOCK_INTERVIEWS,
  MOCK_REMINDERS,
  MOCK_APPLICATIONS,
  MOCK_JOBS,
  MOCK_COURSES,
  MOCK_RESUMES_FOR_C1,
  ALL_FLAGS,
  BASE_HANDLERS,
} from './_mock-data';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupManagerPage(page: Page, extra: Record<string, { json: unknown }> = {}) {
  await seedSession(page, MANAGER);
  await mockApi(page, {
    profile: MANAGER,
    flags: ALL_FLAGS,
    handlers: { ...BASE_HANDLERS, ...extra },
  });
}

/** Inject dark mode and wait two paint cycles for computed styles to settle. */
async function enableDarkMode(page: Page) {
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

async function auditPage(
  page: Page,
  screenshotName: string,
): Promise<import('@axe-core/playwright').AxeResults['violations']> {
  await page.screenshot({ path: `e2e-results/${screenshotName}.png`, fullPage: true });
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
      .join('\n');
    console.error(`Dark-mode a11y violations on ${screenshotName}:\n${summary}`);
    blocking.forEach((v) =>
      v.nodes.forEach((n) =>
        console.error(
          `  html: ${n.html}\n  target: ${JSON.stringify(n.target)}\n  failureSummary: ${n.failureSummary}`,
        ),
      ),
    );
  }
  return blocking;
}

// ─── Desktop (1280×800) ───────────────────────────────────────────────────────

test.describe('Dark mode — Desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('dashboard — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('load');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-dashboard');
    expect(v, `${v.length} violation(s) on dark desktop /dashboard`).toHaveLength(0);
  });

  test('tasks — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/tasks');
    await page.waitForLoadState('load');
    await expect(page.getByText('Design the onboarding flow')).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-tasks');
    expect(v, `${v.length} violation(s) on dark desktop /tasks`).toHaveLength(0);
  });

  test('consultants — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/consultants');
    await page.waitForLoadState('load');
    await expect(page.getByText('Alice Chen').first()).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-consultants');
    expect(v, `${v.length} violation(s) on dark desktop /consultants`).toHaveLength(0);
  });

  test('jobs — dark mode desktop', async ({ page }) => {
    await seedSession(page, RECRUITER);
    await mockApi(page, {
      profile: RECRUITER,
      flags: ALL_FLAGS,
      handlers: {
        '/jobs/recommended': {
          json: { rows: MOCK_JOBS, page: 1, per_page: 40, total: 2, total_pages: 1 },
        },
        '/job-sources': { json: [] },
        '/consultants': { json: MOCK_CONSULTANTS },
        '/recruiters': { json: MOCK_RECRUITERS },
      },
    });
    await page.goto('/jobs');
    await page.waitForLoadState('load');
    // Cycle to Top tab so job cards are visible
    await page.getByRole('button', { name: 'Saved' }).click();
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: /^Top/ }).click();
    await page.waitForLoadState('load');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-jobs');
    expect(v, `${v.length} violation(s) on dark desktop /jobs`).toHaveLength(0);
  });

  test('calendar — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/calendar');
    await page.waitForLoadState('load');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-calendar');
    expect(v, `${v.length} violation(s) on dark desktop /calendar`).toHaveLength(0);
  });

  test('interviews — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/interviews');
    await page.waitForLoadState('load');
    await expect(page.getByText('Phone Screen').first()).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-interviews');
    expect(v, `${v.length} violation(s) on dark desktop /interviews`).toHaveLength(0);
  });

  test('reminders — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/reminders');
    await page.waitForLoadState('load');
    await expect(page.getByText('Follow up with Alice re: Google offer').first()).toBeVisible({
      timeout: 8000,
    });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-reminders');
    expect(v, `${v.length} violation(s) on dark desktop /reminders`).toHaveLength(0);
  });

  test('applications — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/applications');
    await page.waitForLoadState('load');
    await expect(page.getByText('Alice Chen').first()).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-applications');
    expect(v, `${v.length} violation(s) on dark desktop /applications`).toHaveLength(0);
  });

  test('reports — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/reports');
    await page.waitForLoadState('load');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-reports');
    expect(v, `${v.length} violation(s) on dark desktop /reports`).toHaveLength(0);
  });

  test('messages — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/messages');
    await page.waitForLoadState('load');
    await expect(page.getByText('Alice Chen').first()).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-messages');
    expect(v, `${v.length} violation(s) on dark desktop /messages`).toHaveLength(0);
  });

  test('training/courses — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/training/courses');
    await page.waitForLoadState('load');
    await expect(page.getByText('AWS Cloud Practitioner')).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-training-courses');
    expect(v, `${v.length} violation(s) on dark desktop /training/courses`).toHaveLength(0);
  });

  test('resumes — dark mode desktop', async ({ page }) => {
    await setupManagerPage(page, {
      '/consultants': { json: [MOCK_CONSULTANTS[0]] },
      '/resumes/consultant/c-1': { json: MOCK_RESUMES_FOR_C1 },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('load');
    await expect(page.getByText('Resume workspace')).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-desktop-resumes');
    expect(v, `${v.length} violation(s) on dark desktop /resumes`).toHaveLength(0);
  });
});

// ─── Mobile (390×844 — iPhone 12 form factor) ─────────────────────────────────

test.describe('Dark mode — Mobile', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  });

  test('dashboard — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('load');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-dashboard');
    expect(v, `${v.length} violation(s) on dark mobile /dashboard`).toHaveLength(0);
  });

  test('tasks — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/tasks');
    await page.waitForLoadState('load');
    await expect(page.getByText('Design the onboarding flow')).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-tasks');
    expect(v, `${v.length} violation(s) on dark mobile /tasks`).toHaveLength(0);
  });

  test('consultants — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/consultants');
    await page.waitForLoadState('load');
    await expect(page.getByText('Alice Chen').last()).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-consultants');
    expect(v, `${v.length} violation(s) on dark mobile /consultants`).toHaveLength(0);
  });

  test('jobs — dark mode mobile', async ({ page }) => {
    await seedSession(page, RECRUITER);
    await mockApi(page, {
      profile: RECRUITER,
      flags: ALL_FLAGS,
      handlers: {
        '/jobs/recommended': {
          json: { rows: MOCK_JOBS, page: 1, per_page: 40, total: 2, total_pages: 1 },
        },
        '/job-sources': { json: [] },
        '/consultants': { json: MOCK_CONSULTANTS },
        '/recruiters': { json: MOCK_RECRUITERS },
      },
    });
    await page.goto('/jobs');
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: 'Saved' }).click();
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: /^Top/ }).click();
    await page.waitForLoadState('load');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-jobs');
    expect(v, `${v.length} violation(s) on dark mobile /jobs`).toHaveLength(0);
  });

  test('calendar — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/calendar');
    await page.waitForLoadState('load');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-calendar');
    expect(v, `${v.length} violation(s) on dark mobile /calendar`).toHaveLength(0);
  });

  test('interviews — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/interviews');
    await page.waitForLoadState('networkidle');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-interviews');
    expect(v, `${v.length} violation(s) on dark mobile /interviews`).toHaveLength(0);
  });

  test('reminders — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/reminders');
    await page.waitForLoadState('load');
    await expect(page.getByText('Follow up with Alice re: Google offer').last()).toBeVisible({
      timeout: 8000,
    });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-reminders');
    expect(v, `${v.length} violation(s) on dark mobile /reminders`).toHaveLength(0);
  });

  test('applications — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/applications');
    await page.waitForLoadState('load');
    await expect(page.getByText('Alice Chen').last()).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-applications');
    expect(v, `${v.length} violation(s) on dark mobile /applications`).toHaveLength(0);
  });

  test('reports — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/reports');
    await page.waitForLoadState('load');
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-reports');
    expect(v, `${v.length} violation(s) on dark mobile /reports`).toHaveLength(0);
  });

  test('messages — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/messages');
    await page.waitForLoadState('load');
    await expect(page.getByText('Alice Chen').first()).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-messages');
    expect(v, `${v.length} violation(s) on dark mobile /messages`).toHaveLength(0);
  });

  test('training/courses — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page);
    await page.goto('/training/courses');
    await page.waitForLoadState('load');
    await expect(page.getByText('AWS Cloud Practitioner')).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-training-courses');
    expect(v, `${v.length} violation(s) on dark mobile /training/courses`).toHaveLength(0);
  });

  test('resumes — dark mode mobile', async ({ page }) => {
    await setupManagerPage(page, {
      '/consultants': { json: [MOCK_CONSULTANTS[0]] },
      '/resumes/consultant/c-1': { json: MOCK_RESUMES_FOR_C1 },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('load');
    await expect(page.getByText('Resume workspace')).toBeVisible({ timeout: 8000 });
    await enableDarkMode(page);
    const v = await auditPage(page, 'dark-mobile-resumes');
    expect(v, `${v.length} violation(s) on dark mobile /resumes`).toHaveLength(0);
  });
});
