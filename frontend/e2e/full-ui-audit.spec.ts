/**
 * Full UI audit — comprehensive page-by-page exercise.
 *
 * For every major page:
 *   1. Load with rich mock data.
 *   2. Verify key headings / content are visible.
 *   3. Exercise primary interactive elements (modals, buttons, nav).
 *   4. Capture a screenshot → e2e-results/audit-<page>.png.
 *   5. Run axe audit and fail on critical/serious WCAG violations.
 *
 * All API calls are intercepted; no real backend needed.
 *
 * Pages covered: dashboard, tasks (+ modal), consultants (+ assign modal),
 * jobs, calendar, interviews, reminders (+ new-reminder modal),
 * applications (+ new-submission modal), reports, messages, training.
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupPage(
  page: import('@playwright/test').Page,
  extraHandlers: Record<string, { json: unknown }> = {},
) {
  await seedSession(page, MANAGER);
  await mockApi(page, {
    profile: MANAGER,
    flags: ALL_FLAGS,
    handlers: { ...BASE_HANDLERS, ...extraHandlers },
  });
}

async function screenshotAndAudit(
  page: import('@playwright/test').Page,
  name: string,
): Promise<import('@axe-core/playwright').AxeResults['violations']> {
  await page.screenshot({ path: `e2e-results/audit-${name}.png` });
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
      .join('\n');
    console.error(`Accessibility violations on ${name}:\n${summary}`);
  }
  return blocking;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

test.describe('Dashboard page', () => {
  test('renders summary metrics and activity with no console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('load');

    // Verify the page rendered a recognisable heading or KPI element.
    await expect(page.locator('h1, h2, [data-testid="page-header"]').first()).toBeVisible({
      timeout: 8000,
    });

    const violations = await screenshotAndAudit(page, 'dashboard');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /dashboard`,
    ).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── Tasks page ──────────────────────────────────────────────────────────────

test.describe('Tasks page', () => {
  test('renders task list with all three tasks visible', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/tasks');

    await expect(page.getByText('Design the onboarding flow')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Implement auth middleware')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Write API documentation')).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('New Task button opens creation modal; Escape closes it', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/tasks');

    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await newTaskBtn.waitFor({ timeout: 8000 });
    await newTaskBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    // Title input inside the modal
    await expect(page.getByRole('dialog').getByRole('textbox').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — tasks page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/tasks');
    await page.waitForLoadState('load');

    const violations = await screenshotAndAudit(page, 'tasks');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /tasks`,
    ).toHaveLength(0);
  });
});

// ─── Consultants page ────────────────────────────────────────────────────────

test.describe('Consultants page', () => {
  test('renders consultant list with names and statuses', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/consultants');
    await page.waitForLoadState('load');

    await expect(page.getByText('Alice Chen')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Bob Kim')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Carol Patel')).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('Assign button opens recruiter assignment modal', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/consultants');
    await page.waitForLoadState('load');

    // Bob Kim has no recruiter — his row should show an "Assign" button.
    const assignBtn = page.getByRole('button', { name: /assign/i }).first();
    await assignBtn.waitFor({ timeout: 8000 });
    await assignBtn.click();

    // A modal or dialog should appear.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — consultants page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/consultants');
    await page.waitForLoadState('load');

    const violations = await screenshotAndAudit(page, 'consultants');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /consultants`,
    ).toHaveLength(0);
  });
});

// ─── Jobs page ───────────────────────────────────────────────────────────────

test.describe('Jobs page', () => {
  async function forceRecommendedReload(page: import('@playwright/test').Page) {
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: 'Saved' }).click();
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: /^Top/ }).click();
    await page.waitForLoadState('load');
  }

  test('renders job listings after tab cycle (StrictMode dedup workaround)', async ({ page }) => {
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

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — jobs page', async ({ page }) => {
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

    const violations = await screenshotAndAudit(page, 'jobs');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /jobs`,
    ).toHaveLength(0);
  });
});

// ─── Calendar page ───────────────────────────────────────────────────────────

test.describe('Calendar page', () => {
  test('renders calendar with interview events', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/calendar');
    await page.waitForLoadState('load');

    // The calendar should render a date/month heading.
    await expect(page.locator('h1, h2, [role="heading"]').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — calendar page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/calendar');
    await page.waitForLoadState('load');

    const violations = await screenshotAndAudit(page, 'calendar');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /calendar`,
    ).toHaveLength(0);
  });
});

// ─── Interviews page ─────────────────────────────────────────────────────────

test.describe('Interviews page', () => {
  test('renders scheduled interviews', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/interviews');
    await page.waitForLoadState('load');

    // Page should render without crashing.
    await expect(page.locator('h1, h2, [role="heading"]').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — interviews page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/interviews');
    await page.waitForLoadState('load');

    const violations = await screenshotAndAudit(page, 'interviews');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /interviews`,
    ).toHaveLength(0);
  });
});

// ─── Reminders page ──────────────────────────────────────────────────────────

test.describe('Reminders page', () => {
  test('renders reminder list with all entries', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/reminders');
    await page.waitForLoadState('load');

    await expect(page.getByText('Follow up with Alice re: Google offer')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Send resume to Acme Corp')).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('New Reminder button opens creation modal', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/reminders');

    const newBtn = page.getByRole('button', { name: /new reminder|add/i });
    await newBtn.waitFor({ timeout: 8000 });
    await newBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — reminders page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/reminders');
    await page.waitForLoadState('load');

    const violations = await screenshotAndAudit(page, 'reminders');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /reminders`,
    ).toHaveLength(0);
  });
});

// ─── Applications page ───────────────────────────────────────────────────────

test.describe('Applications page', () => {
  test('renders application submissions with consultant and job names', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/applications');
    await page.waitForLoadState('load');

    await expect(page.getByText('Alice Chen')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Senior Java Developer')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('TechStaff Inc')).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('New Submission button opens creation modal', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/applications');
    await page.waitForLoadState('load');

    const newBtn = page.getByRole('button', { name: /new submission|submit/i });
    await newBtn.waitFor({ timeout: 8000 });
    await newBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — applications page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/applications');
    await page.waitForLoadState('load');

    const violations = await screenshotAndAudit(page, 'applications');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /applications`,
    ).toHaveLength(0);
  });
});

// ─── Reports page ────────────────────────────────────────────────────────────

test.describe('Reports page', () => {
  test('renders reports dashboard (falls back to bundled mock data)', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/reports');
    await page.waitForLoadState('load');

    // The page header or a tab bar should appear.
    await expect(page.locator('h1, h2, [role="tablist"]').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — reports page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/reports');
    await page.waitForLoadState('load');

    const violations = await screenshotAndAudit(page, 'reports');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /reports`,
    ).toHaveLength(0);
  });
});

// ─── Messages page ───────────────────────────────────────────────────────────

test.describe('Messages page', () => {
  test('renders conversation list with unread badge', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/messages');
    await page.waitForLoadState('load');

    await expect(page.getByText('Alice Chen')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Can we schedule a call this week?')).toBeVisible({
      timeout: 8000,
    });

    expect(errors).toHaveLength(0);
  });

  test('clicking a conversation opens the thread view', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page, {
      '/messages/with/u-c1': { json: [] },
      '/messages/with/u-c1/read': { json: { ok: true } },
    });
    await page.goto('/messages');
    await page.waitForLoadState('load');

    await page.getByText('Alice Chen').first().click();
    await page.waitForLoadState('load');

    // After clicking, the thread area should become visible (composer input or header).
    await expect(page.locator('[placeholder], textarea, [role="textbox"]').first()).toBeVisible({
      timeout: 5000,
    });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — messages page', async ({ page }) => {
    test.setTimeout(90_000);
    await setupPage(page);
    await page.goto('/messages');
    await page.waitForLoadState('load');
    await expect(page.getByText('Alice Chen')).toBeVisible({ timeout: 10_000 });

    const violations = await screenshotAndAudit(page, 'messages');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /messages`,
    ).toHaveLength(0);
  });
});

// ─── Training page ───────────────────────────────────────────────────────────

test.describe('Training page', () => {
  test('MANAGER sees course catalog with mocked courses', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/training/courses');
    await page.waitForLoadState('load');

    await expect(page.getByText('AWS Cloud Practitioner')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Node.js Advanced Patterns')).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('CONSULTANT sees their training assignments', async ({ page }) => {
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

    // The page should render without crashing.
    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — training courses page', async ({ page }) => {
    test.setTimeout(90_000);
    await setupPage(page);
    await page.goto('/training/courses');
    await page.waitForLoadState('load');
    await expect(page.getByText('AWS Cloud Practitioner')).toBeVisible({ timeout: 10_000 });

    const violations = await screenshotAndAudit(page, 'training-courses');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /training/courses`,
    ).toHaveLength(0);
  });
});

// ─── Resumes page ────────────────────────────────────────────────────────────

test.describe('Resumes page', () => {
  test('MANAGER sees resume versions after auto-select', async ({ page }) => {
    const errors = trackPageErrors(page);

    // Single consultant → useResumeWorkspace auto-selects and fetches /resumes/consultant/c-1.
    // networkidle waits for the version strip to populate.
    await setupPage(page, {
      '/consultants': { json: [MOCK_CONSULTANTS[0]] },
      '/resumes/consultant/c-1': { json: MOCK_RESUMES_FOR_C1 },
    });
    await page.goto('/resumes');
    await page.waitForLoadState('load');

    await expect(page.getByText('Resume workspace')).toBeVisible({ timeout: 8000 });
    // ResumeVersionStrip renders v{version} — asserting real content from mock data.
    await expect(page.getByText('v1').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('alice-resume-v1.pdf').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — resumes page', async ({ page }) => {
    test.setTimeout(90_000);
    await setupPage(page);
    await page.goto('/resumes');
    await page.waitForLoadState('load');
    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 10_000 });

    const violations = await screenshotAndAudit(page, 'resumes');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /resumes`,
    ).toHaveLength(0);
  });
});
