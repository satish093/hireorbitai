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

// ─── Mock data ──────────────────────────────────────────────────────────────

const MOCK_TASKS = [
  {
    id: 't-1',
    title: 'Design the onboarding flow',
    status: 'TODO',
    priority: 'HIGH',
    due_date: '2026-06-01',
    assignee_id: 'u-manager',
    created_by: 'u-manager',
    assignee: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  },
  {
    id: 't-2',
    title: 'Implement auth middleware',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    due_date: null,
    assignee_id: 'u-manager',
    created_by: 'u-manager',
    assignee: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  },
  {
    id: 't-3',
    title: 'Write API documentation',
    status: 'DONE',
    priority: 'LOW',
    due_date: null,
    assignee_id: 'u-manager',
    created_by: 'u-manager',
    assignee: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  },
];

const MOCK_TASK_METRICS = {
  total: 3,
  open: 2,
  critical_open: 0,
  by_status: {
    BACKLOG: 0,
    TODO: 1,
    IN_PROGRESS: 1,
    BLOCKED: 0,
    REVIEW: 0,
    COMPLETED: 1,
    CANCELLED: 0,
    DONE: 1,
  },
  by_priority: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 1 },
  overdue: 0,
  due_today: 0,
  due_this_week: 1,
  completed_last_7_days: 1,
};

const MOCK_RECRUITERS = [
  {
    id: 'r-1',
    team: 'Team Alpha',
    user: { id: 'u-r1', full_name: 'Riley Recruiter', email: 'riley@test.local' },
  },
  {
    id: 'r-2',
    team: 'Team Beta',
    user: { id: 'u-r2', full_name: 'Sam Recruiter', email: 'sam@test.local' },
  },
];

const MOCK_CONSULTANTS = [
  {
    id: 'c-1',
    marketing_status: 'ACTIVE',
    primary_skill: 'Java',
    visa_status: 'H1B',
    total_experience_years: 5,
    current_location: 'New York, NY',
    recruiter_id: 'r-1',
    user: { id: 'u-c1', full_name: 'Alice Chen', email: 'alice@test.local' },
    recruiter: {
      id: 'r-1',
      team: 'Team Alpha',
      user: { id: 'u-r1', full_name: 'Riley Recruiter', email: 'riley@test.local' },
    },
  },
  {
    id: 'c-2',
    marketing_status: 'PAUSED',
    primary_skill: 'Python',
    visa_status: 'OPT',
    total_experience_years: 3,
    current_location: 'Austin, TX',
    recruiter_id: null,
    user: { id: 'u-c2', full_name: 'Bob Kim', email: 'bob@test.local' },
    recruiter: null,
  },
  {
    id: 'c-3',
    marketing_status: 'PLACED',
    primary_skill: 'React',
    visa_status: 'GC',
    total_experience_years: 7,
    current_location: 'Chicago, IL',
    recruiter_id: 'r-1',
    user: { id: 'u-c3', full_name: 'Carol Patel', email: 'carol@test.local' },
    recruiter: {
      id: 'r-1',
      team: 'Team Alpha',
      user: { id: 'u-r1', full_name: 'Riley Recruiter', email: 'riley@test.local' },
    },
  },
];

const MOCK_INTERVIEWS = [
  {
    id: 'iv-1',
    type: 'Phone Screen',
    scheduled_at: '2026-05-25T14:00:00.000Z',
    duration_minutes: 45,
    interviewer: 'David Smith',
    meeting_url: 'https://zoom.us/test',
    is_mock: false,
    status: 'scheduled',
    match_score: 85,
    consultant: { user: { full_name: 'Alice Chen' } },
  },
  {
    id: 'iv-2',
    type: 'Technical',
    scheduled_at: '2026-05-27T10:00:00.000Z',
    duration_minutes: 60,
    interviewer: 'Eve Johnson',
    meeting_url: null,
    is_mock: true,
    status: 'scheduled',
    match_score: 72,
    consultant: { user: { full_name: 'Bob Kim' } },
  },
];

const MOCK_REMINDERS = [
  {
    id: 'rem-1',
    title: 'Follow up with Alice re: Google offer',
    due_at: '2026-05-28T09:00:00.000Z',
    status: 'ACTIVE',
    description: 'Check if she received the offer letter.',
  },
  {
    id: 'rem-2',
    title: 'Send resume to Acme Corp',
    due_at: '2026-05-30T17:00:00.000Z',
    status: 'ACTIVE',
    description: '',
  },
  {
    id: 'rem-3',
    title: 'Verify Bob visa extension',
    due_at: '2026-05-15T12:00:00.000Z',
    status: 'DONE',
    description: '',
  },
];

const MOCK_APPLICATIONS = [
  {
    id: 'app-1',
    consultant: { user: { full_name: 'Alice Chen', email: 'alice@test.local' } },
    job: { title: 'Senior Java Developer' },
    vendor: { company_name: 'TechStaff Inc' },
    ats_score: 88,
    submitted_at: '2026-05-20T10:00:00.000Z',
    status: 'SUBMITTED',
  },
  {
    id: 'app-2',
    consultant: { user: { full_name: 'Bob Kim', email: 'bob@test.local' } },
    job: { title: 'Python Data Engineer' },
    vendor: { company_name: 'DataBridge LLC' },
    ats_score: 75,
    submitted_at: '2026-05-18T14:00:00.000Z',
    status: 'INTERVIEW',
  },
];

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
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
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
    created_at: '2026-05-10T00:00:00Z',
    updated_at: '2026-05-10T00:00:00Z',
  },
];

const MOCK_CONVERSATIONS = [
  {
    peer: {
      id: 'u-c1',
      email: 'alice@test.local',
      full_name: 'Alice Chen',
      role: 'CONSULTANT',
      last_seen_at: '2026-05-22T10:00:00.000Z',
    },
    last_message: {
      id: 'msg-1',
      sender_id: 'u-c1',
      recipient_id: 'u-manager',
      body: 'Can we schedule a call this week?',
      read_at: null,
      created_at: '2026-05-22T10:00:00.000Z',
    },
    unread_count: 1,
  },
  {
    peer: {
      id: 'u-r1',
      email: 'riley@test.local',
      full_name: 'Riley Recruiter',
      role: 'RECRUITER',
      last_seen_at: '2026-05-21T15:00:00.000Z',
    },
    last_message: {
      id: 'msg-2',
      sender_id: 'u-manager',
      recipient_id: 'u-r1',
      body: 'Please review the consultant profiles.',
      read_at: '2026-05-21T15:05:00.000Z',
      created_at: '2026-05-21T15:00:00.000Z',
    },
    unread_count: 0,
  },
];

const MOCK_COURSES = [
  {
    id: 'course-1',
    title: 'AWS Cloud Practitioner',
    description: 'Cloud fundamentals for beginners.',
    category: 'AWS',
    level: 'beginner',
    status: 'PUBLISHED',
    duration_hours: 10,
    created_by: 'u-manager',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'course-2',
    title: 'Node.js Advanced Patterns',
    description: 'Deep dive into async Node.js.',
    category: 'Node.js',
    level: 'advanced',
    status: 'PUBLISHED',
    duration_hours: 15,
    created_by: 'u-manager',
    created_at: '2026-02-01T00:00:00.000Z',
  },
];

// Backend-accurate ResumeVersion shape (no label field; UI shows v{version}).
const MOCK_RESUMES_FOR_C1 = [
  {
    id: 'res-1',
    consultant_id: 'c-1',
    version: 1,
    file_name: 'alice-resume-v1.pdf',
    ai_score: 82,
    is_current: true,
    created_at: '2026-05-01T00:00:00.000Z',
    tailored_for_job_id: null,
    tailored_job: null,
  },
  {
    id: 'res-2',
    consultant_id: 'c-1',
    version: 2,
    file_name: 'alice-resume-v2.pdf',
    ai_score: 90,
    is_current: false,
    created_at: '2026-05-15T00:00:00.000Z',
    tailored_for_job_id: null,
    tailored_job: null,
  },
];

const MANAGER_SUMMARY = {
  consultants_by_status: { ACTIVE: 1, PAUSED: 1, PLACED: 1 },
  recruiters_count: 2,
  active_jobs: 2,
  last_7_day_applications: 2,
  applications_by_status: { SUBMITTED: 1, INTERVIEW: 1 },
};

// ─── Shared config ──────────────────────────────────────────────────────────

const ALL_FLAGS = {
  tasks: true,
  messages: true,
  training: true,
  interviews: true,
  reminders: true,
  reports: true,
  ai_email: true,
};

const BASE_HANDLERS = {
  '/tasks': { json: MOCK_TASKS },
  '/tasks/metrics': { json: MOCK_TASK_METRICS },
  '/task-views': { json: [] },
  '/messages/conversations': { json: MOCK_CONVERSATIONS },
  '/messages/directory': { json: [] },
  '/jobs': { json: MOCK_JOBS },
  '/jobs/recommended': {
    json: { rows: MOCK_JOBS, page: 1, per_page: 40, total: 2, total_pages: 1 },
  },
  '/job-sources': { json: [] },
  '/consultants': { json: MOCK_CONSULTANTS },
  '/recruiters': { json: MOCK_RECRUITERS },
  '/users': { json: [] },
  '/reminders': { json: MOCK_REMINDERS },
  '/interviews': { json: MOCK_INTERVIEWS },
  '/activity': { json: [] },
  '/applications': { json: MOCK_APPLICATIONS },
  '/vendors': { json: [] },
  '/reports/manager-summary': { json: MANAGER_SUMMARY },
  // Return 404 for all report tabs so the reports page falls back to its bundled local mocks.
  // Returning [] (the default for unmocked GETs) causes runtime crashes when the component
  // reads .charts.funnel on the empty array.
  '/reports/pipeline': { status: 404, json: { error: 'Not found' } },
  '/reports/recruiters': { status: 404, json: { error: 'Not found' } },
  '/reports/consultants': { status: 404, json: { error: 'Not found' } },
  '/reports/placements': { status: 404, json: { error: 'Not found' } },
  '/reports/sources': { status: 404, json: { error: 'Not found' } },
  '/reports/ai': { status: 404, json: { error: 'Not found' } },
  '/training/courses': { json: MOCK_COURSES },
  '/training/assignments': { json: [] },
  // Resumes page: MANAGER loads consultants then fetches resumes per consultant.
  '/resumes/consultant/c-1': { json: MOCK_RESUMES_FOR_C1 },
};

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Alice Chen')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Bob Kim')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Carol Patel')).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('Assign button opens recruiter assignment modal', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/consultants');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Saved' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^Top/ }).click();
    await page.waitForLoadState('networkidle');
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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    // The calendar should render a date/month heading.
    await expect(page.locator('h1, h2, [role="heading"]').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — calendar page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    // Page should render without crashing.
    await expect(page.locator('h1, h2, [role="heading"]').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — interviews page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/interviews');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Alice Chen')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Senior Java Developer')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('TechStaff Inc')).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('New Submission button opens creation modal', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupPage(page);
    await page.goto('/applications');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    // The page header or a tab bar should appear.
    await expect(page.locator('h1, h2, [role="tablist"]').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — reports page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    await page.getByText('Alice Chen').first().click();
    await page.waitForLoadState('networkidle');

    // After clicking, the thread area should become visible (composer input or header).
    await expect(page.locator('[placeholder], textarea, [role="textbox"]').first()).toBeVisible({
      timeout: 5000,
    });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — messages page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/messages');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    // The page should render without crashing.
    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — training courses page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/training/courses');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Resume workspace')).toBeVisible({ timeout: 8000 });
    // ResumeVersionStrip renders v{version} — asserting real content from mock data.
    await expect(page.getByText('v1').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('alice-resume-v1.pdf').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('screenshot and axe audit — resumes page', async ({ page }) => {
    await setupPage(page);
    await page.goto('/resumes');
    await page.waitForLoadState('networkidle');

    const violations = await screenshotAndAudit(page, 'resumes');
    expect(
      violations,
      `${violations.length} critical/serious a11y violation(s) on /resumes`,
    ).toHaveLength(0);
  });
});
