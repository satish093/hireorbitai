/**
 * Mobile audit — same page-by-page coverage as full-ui-audit.spec.ts but at
 * a 375×812 iPhone viewport.
 *
 * For every major page:
 *   1. Load with rich mock data at mobile viewport.
 *   2. Verify key content is visible.
 *   3. Check there is no horizontal overflow (scrollWidth ≤ viewportWidth).
 *   4. Capture a screenshot → e2e-results/audit-mobile-<page>.png.
 *   5. Run axe audit and fail on critical/serious WCAG violations.
 *
 * All API calls are intercepted; no real backend needed.
 *
 * Pages covered: dashboard, tasks, consultants, jobs, calendar, interviews,
 * reminders, applications, reports, messages, training, resumes.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, mockApi, MANAGER, RECRUITER, CONSULTANT, trackPageErrors } from './_helpers';
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

// ─── Device emulation — iPhone 12 form factor on Chromium ────────────────────
// We specify only the context-level properties (viewport, scale, touch, UA)
// and omit `defaultBrowserType` so the test runs on the configured chromium
// project instead of trying to launch webkit (which is not installed).

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupPage(
  page: import('@playwright/test').Page,
  extraHandlers: Record<string, { json: unknown; status?: number }> = {},
) {
  await seedSession(page, MANAGER);
  await mockApi(page, {
    profile: MANAGER,
    flags: ALL_FLAGS,
    handlers: { ...BASE_HANDLERS, ...extraHandlers },
  });
}

/** Returns true if the document body overflows horizontally at the current viewport. */
async function hasHorizontalOverflow(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth);
}

async function screenshotAndAudit(
  page: import('@playwright/test').Page,
  name: string,
): Promise<import('@axe-core/playwright').AxeResults['violations']> {
  await page.screenshot({ path: `e2e-results/audit-mobile-${name}.png`, fullPage: true });
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
      .join('\n');
    console.error(`Mobile a11y violations on ${name}:\n${summary}`);
  }
  return blocking;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

test.describe('Mobile — Dashboard page', () => {
  test('renders summary metrics with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('load');

    await expect(page.locator('h1, h2, [data-testid="page-header"]').first()).toBeVisible({
      timeout: 8000,
    });
    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile dashboard', async ({ page }) => {
    await setupPage(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'dashboard');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /dashboard`,
    ).toHaveLength(0);
  });
});

// ─── Tasks page ──────────────────────────────────────────────────────────────

test.describe('Mobile — Tasks page', () => {
  test('renders task list with all three tasks visible', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/tasks');
    await page.waitForLoadState('load');

    await expect(page.getByText('Design the onboarding flow')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Implement auth middleware')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Write API documentation')).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile tasks', async ({ page }) => {
    await setupPage(page);
    await page.goto('/tasks');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'tasks');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /tasks`,
    ).toHaveLength(0);
  });
});

// ─── Consultants page ────────────────────────────────────────────────────────

test.describe('Mobile — Consultants page', () => {
  test('renders consultant names and statuses', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/consultants');
    await page.waitForLoadState('load');

    await expect(page.getByText('Alice Chen').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Bob Kim').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Carol Patel').last()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile consultants', async ({ page }) => {
    await setupPage(page);
    await page.goto('/consultants');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'consultants');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /consultants`,
    ).toHaveLength(0);
  });
});

// ─── Jobs page ───────────────────────────────────────────────────────────────

test.describe('Mobile — Jobs page', () => {
  async function forceRecommendedReload(page: import('@playwright/test').Page) {
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: 'Saved' }).click();
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: /^Top/ }).click();
    await page.waitForLoadState('load');
  }

  test('renders job listings after tab cycle', async ({ page }) => {
    const errors = trackPageErrors(page);

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
    await forceRecommendedReload(page);

    await expect(page.getByText('Senior Software Engineer')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Frontend Developer')).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile jobs', async ({ page }) => {
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

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'jobs');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /jobs`,
    ).toHaveLength(0);
  });
});

// ─── Calendar page ───────────────────────────────────────────────────────────

test.describe('Mobile — Calendar page', () => {
  test('renders calendar heading with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/calendar');
    await page.waitForLoadState('load');

    await expect(page.locator('h1, h2, [role="heading"]').first()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile calendar', async ({ page }) => {
    await setupPage(page);
    await page.goto('/calendar');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'calendar');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /calendar`,
    ).toHaveLength(0);
  });
});

// ─── Interviews page ─────────────────────────────────────────────────────────

test.describe('Mobile — Interviews page', () => {
  test('renders scheduled interviews with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/interviews');
    await page.waitForLoadState('load');

    await expect(page.locator('h1, h2, [role="heading"]').first()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile interviews', async ({ page }) => {
    await setupPage(page);
    await page.goto('/interviews');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'interviews');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /interviews`,
    ).toHaveLength(0);
  });
});

// ─── Reminders page ──────────────────────────────────────────────────────────

test.describe('Mobile — Reminders page', () => {
  test('renders reminder list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/reminders');
    await page.waitForLoadState('load');

    await expect(page.getByText('Follow up with Alice re: Google offer').last()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Send resume to Acme Corp').last()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile reminders', async ({ page }) => {
    await setupPage(page);
    await page.goto('/reminders');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'reminders');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /reminders`,
    ).toHaveLength(0);
  });
});

// ─── Applications page ───────────────────────────────────────────────────────

test.describe('Mobile — Applications page', () => {
  test('renders applications with consultant and job names', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/applications');
    await page.waitForLoadState('load');

    await expect(page.getByText('Alice Chen').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Senior Java Developer').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('TechStaff Inc').last()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile applications', async ({ page }) => {
    await setupPage(page);
    await page.goto('/applications');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'applications');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /applications`,
    ).toHaveLength(0);
  });
});

// ─── Reports page ────────────────────────────────────────────────────────────

test.describe('Mobile — Reports page', () => {
  test('renders reports dashboard with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/reports');
    await page.waitForLoadState('load');

    await expect(page.locator('h1, h2, [role="tablist"]').first()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile reports', async ({ page }) => {
    await setupPage(page);
    await page.goto('/reports');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'reports');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /reports`,
    ).toHaveLength(0);
  });
});

// ─── Messages page ───────────────────────────────────────────────────────────

test.describe('Mobile — Messages page', () => {
  test('renders conversation list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/messages');
    await page.waitForLoadState('load');

    await expect(page.getByText('Alice Chen')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Can we schedule a call this week?')).toBeVisible({
      timeout: 8000,
    });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile messages', async ({ page }) => {
    await setupPage(page);
    await page.goto('/messages');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'messages');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /messages`,
    ).toHaveLength(0);
  });
});

// ─── Training page ───────────────────────────────────────────────────────────

test.describe('Mobile — Training page', () => {
  test('MANAGER sees course catalog with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/training/courses');
    await page.waitForLoadState('load');

    await expect(page.getByText('AWS Cloud Practitioner')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Node.js Advanced Patterns')).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('CONSULTANT training view loads with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, CONSULTANT);
    await mockApi(page, {
      profile: CONSULTANT,
      flags: ALL_FLAGS,
      handlers: {
        ...BASE_HANDLERS,
        '/training/assignments': { json: [] },
        '/training/courses': { json: MOCK_COURSES },
      },
    });
    await page.goto('/training');
    await page.waitForLoadState('load');

    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile training courses', async ({ page }) => {
    await setupPage(page);
    await page.goto('/training/courses');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'training-courses');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /training/courses`,
    ).toHaveLength(0);
  });
});

// ─── Resumes page ────────────────────────────────────────────────────────────

test.describe('Mobile — Resumes page', () => {
  test('MANAGER sees resume versions with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page, {
      '/consultants': { json: [MOCK_CONSULTANTS[0]] },
      '/resumes/consultant/c-1': { json: MOCK_RESUMES_FOR_C1 },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('load');

    await expect(page.getByText('Resume workspace')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('v1').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('alice-resume-v1.pdf').first()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — mobile resumes', async ({ page }) => {
    await setupPage(page, {
      '/consultants': { json: [MOCK_CONSULTANTS[0]] },
      '/resumes/consultant/c-1': { json: MOCK_RESUMES_FOR_C1 },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('load');

    expect(await hasHorizontalOverflow(page)).toBe(false);
    const violations = await screenshotAndAudit(page, 'resumes');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on mobile /resumes`,
    ).toHaveLength(0);
  });
});
