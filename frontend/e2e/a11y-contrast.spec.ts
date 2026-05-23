/**
 * Accessibility and colour-contrast E2E tests.
 *
 * Uses @axe-core/playwright to audit key pages for WCAG violations.
 * Fails only on critical and serious issues (impact: 'critical' | 'serious').
 * Moderate and minor issues are logged but do not block.
 *
 * Pages audited: /dashboard, /tasks, /messages, /job-search.
 * Screenshots of each page are saved to e2e-results/ for visual review.
 *
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, mockApi, MANAGER, trackPageErrors } from './_helpers';

const ALL_FLAGS = {
  tasks: true,
  messages: true,
  training: true,
  interviews: true,
  reminders: true,
  reports: true,
};

// Minimal but valid TaskMetrics shape — prevents the dashboard from crashing
// when /tasks/metrics returns [] (the default mock fallback for unmocked GETs).
const EMPTY_TASK_METRICS = {
  total: 0,
  open: 0,
  critical_open: 0,
  by_status: {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    REVIEW: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  },
  by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  overdue: 0,
  due_today: 0,
  due_this_week: 0,
  completed_last_7_days: 0,
};

const EMPTY_SUMMARY = {
  consultants_by_status: {},
  recruiters_count: 0,
  active_jobs: 0,
  last_7_day_applications: 0,
  applications_by_status: {},
};

const BASE_HANDLERS = {
  '/tasks': { json: [] },
  '/tasks/metrics': { json: EMPTY_TASK_METRICS },
  '/task-views': { json: [] },
  '/messages': { json: [] },
  '/jobs': { json: [] },
  '/job-sources': { json: [] },
  '/consultants': { json: [] },
  '/recruiters': { json: [] },
  '/users': { json: [] },
  '/reminders': { json: [] },
  '/interviews': { json: [] },
  '/activity': { json: [] },
  '/reports/manager-summary': { json: EMPTY_SUMMARY },
  '/reports': { json: {} },
};

const PAGES: { name: string; path: string }[] = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'tasks', path: '/tasks' },
  { name: 'messages', path: '/messages' },
  // /consultants is accessible to MANAGER; /job-search redirects MANAGER to dashboard
  { name: 'consultants', path: '/consultants' },
];

for (const { name, path } of PAGES) {
  test(`${name} page — no critical/serious axe accessibility violations`, async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: ALL_FLAGS,
      handlers: BASE_HANDLERS,
    });

    await page.goto(path);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page }).analyze();

    // Capture screenshot for visual review regardless of pass/fail.
    await page.screenshot({ path: `e2e-results/a11y-${name}.png` });

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    if (blocking.length > 0) {
      const summary = blocking
        .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
        .join('\n');
      console.error(`Accessibility violations on ${path}:\n${summary}`);
    }

    expect(
      blocking,
      `${blocking.length} critical/serious accessibility violation(s) on ${path}`,
    ).toHaveLength(0);

    expect(errors).toHaveLength(0);
  });
}
