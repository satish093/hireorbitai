/**
 * Full-interaction spec — opens every major modal, fills every form, submits,
 * and takes before/after screenshots on iPhone 12 (390×844).
 *
 * All write endpoints are mocked to return success — no real backend needed.
 * Run with:  npm --prefix frontend run test:e2e -- full-interaction
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { seedSession, mockApi, trackPageErrors, MANAGER } from './_helpers';

// ─── output dir ──────────────────────────────────────────────────────────────
const OUT = path.resolve('e2e-results/full-interaction');

// ─── helpers ─────────────────────────────────────────────────────────────────
type AnyPage = Parameters<typeof mockApi>[0];

async function snap(page: AnyPage, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await (page as any).screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

async function assertNoCrash(page: AnyPage) {
  await expect((page as any).getByText('Something went wrong')).not.toBeVisible();
}

// ─── shared mock data ─────────────────────────────────────────────────────────
const NOW = Date.now();
const iso = (ms: number) => new Date(NOW + ms).toISOString();

const HANDLERS: Record<string, { status?: number; json?: unknown; body?: string }> = {
  // ── Tasks ─────────────────────────────────────────────────────────────────
  '/tasks': {
    json: [
      {
        id: 't-1',
        title: 'Review candidate profile for Senior Engineer role',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        due_at: iso(86400_000),
        assignee_id: 'u-manager',
        assignee: { id: 'u-manager', email: 'morgan@test.local', full_name: 'Morgan Manager' },
        created_at: iso(-172800_000),
        updated_at: iso(-3600_000),
        comment_count: 2,
        tags: ['hiring'],
      },
      {
        id: 't-2',
        title: 'Send offer letter to Casey Consultant',
        status: 'TODO',
        priority: 'CRITICAL',
        due_at: iso(43200_000),
        assignee_id: 'u-manager',
        assignee: { id: 'u-manager', email: 'morgan@test.local', full_name: 'Morgan Manager' },
        created_at: iso(-86400_000),
        updated_at: iso(-1800_000),
        comment_count: 0,
        tags: ['offers'],
      },
    ],
  },
  '/tasks/metrics': {
    json: {
      total: 2,
      by_status: {
        BACKLOG: 0,
        TODO: 1,
        IN_PROGRESS: 1,
        BLOCKED: 0,
        REVIEW: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      },
      by_priority: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 1 },
    },
  },
  'POST /tasks': {
    json: {
      id: 't-new',
      title: 'E2E test task',
      status: 'TODO',
      priority: 'MEDIUM',
      due_at: null,
      assignee_id: null,
      assignee: null,
      created_at: iso(0),
      updated_at: iso(0),
      comment_count: 0,
      tags: [],
    },
  },
  '/users': {
    json: [
      { id: 'u-manager', email: 'morgan@test.local', full_name: 'Morgan Manager', role: 'MANAGER' },
    ],
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  '/reports/manager-summary': {
    json: {
      consultants_by_status: { ACTIVE: 8, PAUSED: 2, PLACED: 2 },
      recruiters_count: 3,
      active_jobs: 12,
      recent_applications: 24,
      applications_by_status: { SUBMITTED: 10, REVIEWING: 8, REJECTED: 4, OFFER: 2 },
      interviews_this_week: 5,
    },
  },

  // ── Jobs ──────────────────────────────────────────────────────────────────
  '/jobs': {
    json: [
      {
        id: 'j-1',
        title: 'Senior Full-Stack Engineer',
        company_name: 'Acme Corp',
        location: 'Austin, TX',
        remote: true,
        job_type: 'CONTRACT',
        level: 'SENIOR',
        rate_min: 85,
        rate_max: 110,
        description: 'Senior engineer role.',
        required_skills: ['React', 'Node.js'],
        posted_at: iso(-86400_000),
        created_at: iso(-86400_000),
        is_active: true,
        match_score: 92,
        source: 'greenhouse',
        external_id: 'gh-001',
      },
      {
        id: 'j-2',
        title: 'React Native Developer',
        company_name: 'TechStart',
        location: 'Remote',
        remote: true,
        job_type: 'FULLTIME',
        level: 'MID',
        rate_min: 70,
        rate_max: 90,
        description: 'Mobile app dev role.',
        required_skills: ['React Native', 'TypeScript'],
        posted_at: iso(-172800_000),
        created_at: iso(-172800_000),
        is_active: true,
        match_score: 78,
        source: 'remoteok',
        external_id: 'ro-002',
      },
    ],
  },
  '/jobs/recommended': {
    json: {
      rows: [
        {
          id: 'j-1',
          title: 'Senior Full-Stack Engineer',
          company_name: 'Acme Corp',
          location: 'Austin, TX',
          remote: true,
          job_type: 'CONTRACT',
          level: 'SENIOR',
          rate_min: 85,
          rate_max: 110,
          description: 'Senior engineer role.',
          required_skills: ['React', 'Node.js'],
          posted_at: iso(-86400_000),
          created_at: iso(-86400_000),
          is_active: true,
          match_score: 92,
          match_reasons: ['React expert'],
          source: 'greenhouse',
          external_id: 'gh-001',
        },
      ],
      page: 1,
      per_page: 40,
      total: 1,
      total_pages: 1,
    },
  },
  '/job-sources': {
    json: [{ id: 'src-1', name: 'Greenhouse', source_type: 'greenhouse', is_active: true }],
  },

  // ── Calendar / Reminders ──────────────────────────────────────────────────
  '/calendar/events': {
    json: [
      {
        id: 'ev-1',
        title: 'Interview with Acme Corp',
        start: iso(3600_000),
        end: iso(7200_000),
        kind: 'interview',
        tone: 'info',
        durationMin: 60,
        calendar: 'interviews',
        meetingUrl: 'https://zoom.us/j/123456',
      },
    ],
  },
  '/reminders': {
    json: [
      {
        id: 'r-1',
        title: 'Follow up with Acme Corp',
        due_at: iso(86400_000),
        status: 'PENDING',
        description: null,
      },
    ],
  },
  'POST /reminders': {
    json: {
      id: 'r-new',
      title: 'E2E test reminder',
      due_at: iso(86400_000),
      status: 'PENDING',
      description: null,
    },
  },

  // ── Interviews ────────────────────────────────────────────────────────────
  '/interviews': {
    json: [
      {
        id: 'i-1',
        consultant_id: 'c-1',
        job_id: 'j-1',
        scheduled_at: iso(3600_000),
        status: 'SCHEDULED',
        interview_type: 'VIDEO',
        notes: null,
        consultant: { id: 'c-1', full_name: 'Casey Consultant' },
        job: { id: 'j-1', title: 'Senior Full-Stack Engineer', company_name: 'Acme Corp' },
      },
    ],
  },
  'POST /interviews': {
    json: {
      id: 'i-new',
      consultant_id: 'c-1',
      job_id: null,
      scheduled_at: iso(86400_000),
      status: 'SCHEDULED',
      interview_type: 'PHONE',
      notes: null,
    },
  },

  // ── Applications ──────────────────────────────────────────────────────────
  '/applications': {
    json: [
      {
        id: 'app-1',
        consultant_id: 'c-1',
        job_id: 'j-1',
        status: 'REVIEWING',
        applied_at: iso(-86400_000),
        consultant: { id: 'c-1', full_name: 'Casey Consultant' },
        job: { id: 'j-1', title: 'Senior Full-Stack Engineer', company_name: 'Acme Corp' },
        vendor: null,
        ats_link: null,
      },
    ],
  },
  'POST /applications': {
    json: {
      id: 'app-new',
      consultant_id: 'c-1',
      job_id: 'j-1',
      status: 'SUBMITTED',
      applied_at: iso(0),
      consultant: { id: 'c-1', full_name: 'Casey Consultant' },
      job: { id: 'j-1', title: 'Senior Full-Stack Engineer', company_name: 'Acme Corp' },
      vendor: null,
    },
  },

  // ── Consultants ───────────────────────────────────────────────────────────
  '/consultants': {
    json: [
      {
        id: 'c-1',
        marketing_status: 'ACTIVE',
        primary_skill: 'React / TypeScript',
        visa_status: 'H1B',
        total_experience_years: 7,
        current_location: 'Austin, TX',
        recruiter_id: 'rec-1',
        user: {
          id: 'u-c1',
          full_name: 'Casey Consultant',
          email: 'casey@test.local',
          group_id: null,
        },
        recruiter: {
          id: 'rec-1',
          team: 'West',
          user: { full_name: 'Bob Smith', email: 'bob@test.local' },
        },
      },
      {
        id: 'c-2',
        marketing_status: 'ACTIVE',
        primary_skill: 'React Native',
        visa_status: 'GC',
        total_experience_years: 4,
        current_location: 'Remote',
        recruiter_id: null,
        user: { id: 'u-c2', full_name: 'Jordan Dev', email: 'jordan@test.local', group_id: null },
        recruiter: null,
      },
    ],
  },
  'POST /consultants/c-1/assign-recruiter': {
    json: { ok: true },
  },
  'POST /consultants/c-2/assign-recruiter': {
    json: { ok: true },
  },

  // ── Recruiters ────────────────────────────────────────────────────────────
  '/recruiters': {
    json: [
      {
        id: 'rec-1',
        team: 'West',
        user: { id: 'u-r1', full_name: 'Bob Smith', email: 'bob@test.local' },
      },
      {
        id: 'rec-2',
        team: 'East',
        user: { id: 'u-r2', full_name: 'Alice Recruiter', email: 'alice@test.local' },
      },
    ],
  },

  // ── Resumes ───────────────────────────────────────────────────────────────
  '/resumes': { json: [] },

  // ── Clients ───────────────────────────────────────────────────────────────
  '/clients': { json: [] },
  'POST /clients': {
    json: {
      id: 'cl-new',
      company_name: 'Test Client Inc',
      industry: '',
      contact_name: '',
      contact_email: '',
      location: '',
    },
  },

  // ── Vendors ───────────────────────────────────────────────────────────────
  '/vendors': { json: [] },
  'POST /vendors': {
    json: {
      id: 'v-new',
      company_name: 'Test Vendor LLC',
      contact_name: '',
      contact_email: '',
      contact_phone: '',
      website: '',
      tier: '',
    },
  },

  // ── Invitations ───────────────────────────────────────────────────────────
  '/invitations': { json: [] },
  'POST /invitations': {
    json: { id: 'inv-new', email: 'test@example.com', role: 'CONSULTANT', email_sent: true },
  },
  '/user-groups': { json: [] },

  // ── Messages ─────────────────────────────────────────────────────────────
  '/messages/conversations': {
    json: [
      {
        peer: { id: 'u-2', email: 'bob@test.local', full_name: 'Bob Smith', role: 'RECRUITER' },
        last_message: {
          id: 'm-1',
          sender_id: 'u-2',
          recipient_id: 'u-manager',
          body: 'Hey, available for a call today?',
          read_at: null,
          created_at: iso(-600_000),
        },
        unread_count: 2,
      },
    ],
  },
  '/messages/directory': { json: [] },
  '/messages/thread/u-2': {
    json: [
      {
        id: 'm-1',
        sender_id: 'u-2',
        recipient_id: 'u-manager',
        body: 'Hey, available for a call today?',
        read_at: null,
        created_at: iso(-600_000),
      },
    ],
  },
  'POST /messages': {
    json: {
      id: 'm-new',
      sender_id: 'u-manager',
      recipient_id: 'u-2',
      body: 'Hello from E2E test!',
      read_at: null,
      created_at: iso(0),
    },
  },

  // ── Training ─────────────────────────────────────────────────────────────
  '/training/my-training': { json: [] },
  '/training/catalog': {
    json: [
      {
        id: 'course-3',
        title: 'System Design Fundamentals',
        category: 'Engineering',
        tags: ['Architecture'],
        estimated_duration_hours: 8,
        compliance_category: null,
        difficulty: 'INTERMEDIATE',
        rating: 4.9,
        rating_count: 201,
        enrolled: 512,
        enrolled_by_me: false,
      },
    ],
  },
  '/training/continue': { body: 'null' },
  '/training/compliance': { json: { items: [], due_soon: 0 } },
  '/training/activity': { json: { series: [], streak: 0, best: 0 } },
  '/training/achievements': { json: [] },
  '/training/plans/active': { body: 'null' },
  '/training/courses': { json: [] },
  'POST /training/enroll': { json: { ok: true } },

  // ── Reports ───────────────────────────────────────────────────────────────
  '/reports/summary': {
    json: {
      total_consultants: 12,
      active_jobs: 12,
      applications_this_month: 24,
      interviews_this_week: 5,
    },
  },
  '/reports/pipeline': { status: 404, json: { error: 'not built' } },
  '/reports/recruiters': { status: 404, json: { error: 'not built' } },
  '/reports/consultants': { status: 404, json: { error: 'not built' } },
  '/reports/placements': { status: 404, json: { error: 'not built' } },
  '/reports/sources': { status: 404, json: { error: 'not built' } },
  '/reports/ai': { status: 404, json: { error: 'not built' } },
};

// ─── viewport: iPhone 12 ──────────────────────────────────────────────────────
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
});

// ─── setup helper ─────────────────────────────────────────────────────────────
async function setup(page: AnyPage) {
  await seedSession(page as any, MANAGER);
  await mockApi(page as any, {
    profile: MANAGER,
    flags: { training: true, ai_match: true },
    handlers: HANDLERS,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// TASKS — create new task
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Tasks', () => {
  test('open New-task modal, fill, submit', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');
    await snap(page, '01-tasks-list');
    await assertNoCrash(page);

    // Open the create modal
    await page.getByRole('button', { name: 'New task' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await snap(page, '02-tasks-modal-open');

    // Fill title (required)
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill('E2E test task');
    await snap(page, '03-tasks-modal-filled');

    // Submit
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await page.waitForLoadState('networkidle');
    await snap(page, '04-tasks-after-submit');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDAR — add reminder
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Calendar', () => {
  test('open Add-reminder modal, fill, submit', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');
    await snap(page, '05-calendar-loaded');
    await assertNoCrash(page);

    // Click the "Add" button in the header (planner mode)
    await page.getByRole('button', { name: 'Add' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, '06-calendar-add-reminder-open');

    // Fill title
    await dialog.locator('input[type="text"], input:not([type])').first().fill('E2E reminder');
    // Pick a quick-preset date so DateTimePicker has a valid value
    const preset = dialog.getByText('Tomorrow 9 AM');
    if (await preset.isVisible()) await preset.click();
    await snap(page, '07-calendar-reminder-filled');

    // Submit
    await dialog.getByRole('button', { name: 'Add' }).click();
    await page.waitForLoadState('networkidle');
    await snap(page, '08-calendar-after-add');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTERVIEWS — schedule interview
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Interviews', () => {
  test('open Schedule modal, fill, submit', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/interviews');
    await page.waitForLoadState('networkidle');
    await snap(page, '09-interviews-loaded');
    await assertNoCrash(page);

    // Open Schedule modal
    await page.getByRole('button', { name: 'Schedule' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, '10-interviews-schedule-open');

    // Select a consultant (first option in the consultant select)
    const consultantSelect = dialog.locator('select').first();
    await consultantSelect.selectOption({ index: 1 }); // index 0 is the placeholder

    // Set date via preset
    const preset = dialog.getByText('Tomorrow 9 AM');
    if (await preset.isVisible()) await preset.click();
    await snap(page, '11-interviews-schedule-filled');

    // Submit
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.waitForLoadState('networkidle');
    await snap(page, '12-interviews-after-schedule');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// APPLICATIONS — new submission
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Applications', () => {
  test('open New-submission modal, fill, submit', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/applications');
    await page.waitForLoadState('networkidle');
    await snap(page, '13-applications-loaded');
    await assertNoCrash(page);

    // Open the create modal
    await page.getByRole('button', { name: /new submission/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, '14-applications-modal-open');

    // Select consultant (first available option)
    const selects = dialog.locator('select');
    await selects.nth(0).selectOption({ index: 1 }); // Consultant
    await selects.nth(1).selectOption({ index: 1 }); // Job
    await snap(page, '15-applications-modal-filled');

    // Submit
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await page.waitForLoadState('networkidle');
    await snap(page, '16-applications-after-submit');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONSULTANTS — assign recruiter
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Consultants', () => {
  test('click Assign, pick recruiter, save', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/consultants');
    await page.waitForLoadState('networkidle');
    await snap(page, '17-consultants-loaded');
    await assertNoCrash(page);

    // Click first "Assign" or "Reassign" button in the table
    const assignBtn = page.getByRole('button', { name: /assign|reassign/i }).first();
    await assignBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, '18-consultants-assign-open');

    // Select a different recruiter (index 2 = rec-2, since index 1 = rec-1 which is
    // already assigned to c-1 and would leave the save button disabled)
    await dialog.locator('select').first().selectOption({ index: 2 });
    await snap(page, '19-consultants-assign-filled');

    // Save
    await dialog.getByRole('button', { name: /save/i }).click();
    await page.waitForLoadState('networkidle');
    await snap(page, '20-consultants-after-assign');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTS — new client
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Clients', () => {
  test('open New-client modal, fill, submit', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    await snap(page, '21-clients-loaded');
    await assertNoCrash(page);

    // Open modal
    await page.getByRole('button', { name: /new client/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, '22-clients-modal-open');

    // Fill required Company field
    await dialog
      .locator('input[type="text"], input:not([type="email"]):not([type="date"])')
      .first()
      .fill('Test Client Inc');
    await snap(page, '23-clients-modal-filled');

    // Submit
    await dialog.getByRole('button', { name: /save client/i }).click();
    await page.waitForLoadState('networkidle');
    await snap(page, '24-clients-after-submit');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// VENDORS — new vendor
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Vendors', () => {
  test('open New-vendor modal, fill, submit', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/vendors');
    await page.waitForLoadState('networkidle');
    await snap(page, '25-vendors-loaded');
    await assertNoCrash(page);

    // Open modal
    await page.getByRole('button', { name: /new vendor/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, '26-vendors-modal-open');

    // Fill required Company name field
    await dialog
      .locator('input[type="text"], input:not([type="email"])')
      .first()
      .fill('Test Vendor LLC');
    await snap(page, '27-vendors-modal-filled');

    // Submit
    await dialog.getByRole('button', { name: /save vendor/i }).click();
    await page.waitForLoadState('networkidle');
    await snap(page, '28-vendors-after-submit');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INVITATIONS — invite user
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Invitations', () => {
  test('open Invite-user modal, fill email, send', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/invitations');
    await page.waitForLoadState('networkidle');
    await snap(page, '29-invitations-loaded');
    await assertNoCrash(page);

    // Open modal
    await page.getByRole('button', { name: /invite user/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, '30-invitations-modal-open');

    // Fill email
    await dialog.locator('input[type="email"]').fill('newhire@example.com');
    await snap(page, '31-invitations-modal-filled');

    // Send invite
    await dialog.getByRole('button', { name: /send invite/i }).click();
    await page.waitForLoadState('networkidle');
    await snap(page, '32-invitations-after-send');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MESSAGES — open conversation, send message
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Messages', () => {
  test('open conversation, type message, send', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/messages');
    await page.waitForLoadState('networkidle');
    await snap(page, '33-messages-loaded');
    await assertNoCrash(page);

    // Click the first conversation in the sidebar
    await page.locator('text=Bob Smith').first().click();
    await page.waitForLoadState('networkidle');
    await snap(page, '34-messages-thread-open');

    // Type a message in the composer
    const composer = page.locator('textarea').last();
    if (await composer.isVisible()) {
      await composer.fill('Hello from E2E test!');
      await snap(page, '35-messages-composed');

      // Send with the send button (icon button)
      const sendBtn = page.getByRole('button', { name: /send/i }).last();
      if (await sendBtn.isVisible()) {
        await sendBtn.click();
        await page.waitForLoadState('networkidle');
      }
    }
    await snap(page, '36-messages-after-send');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TRAINING — enroll in a course
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Training', () => {
  test('click Enroll on a catalog course', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/training');
    await page.waitForLoadState('networkidle');
    await snap(page, '37-training-loaded');
    await assertNoCrash(page);

    // Find the catalog tab / Enroll button
    const catalogTab = page.getByRole('button', { name: /catalog/i });
    if (await catalogTab.isVisible()) await catalogTab.click();
    await page.waitForLoadState('networkidle');
    await snap(page, '38-training-catalog');

    // Click Enroll on the first un-enrolled course
    const enrollBtn = page.getByRole('button', { name: /enroll/i }).first();
    if (await enrollBtn.isVisible()) {
      await enrollBtn.click();
      await page.waitForLoadState('networkidle');
    }
    await snap(page, '39-training-after-enroll');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// REMINDERS — quick smoke (list + add from reminders page)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Reminders', () => {
  test('reminders page loads with data', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/reminders');
    await page.waitForLoadState('networkidle');
    await snap(page, '40-reminders-loaded');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// REPORTS — smoke (all tabs render without crashing)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('Reports', () => {
  test('reports page loads and tabs render', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);

    await page.goto('/reports');
    await page.waitForLoadState('networkidle');
    await snap(page, '41-reports-loaded');
    await assertNoCrash(page);

    // Click through a couple report tabs
    for (const tab of ['Pipeline', 'Recruiters']) {
      const btn = page.getByRole('button', { name: tab });
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForLoadState('networkidle');
      }
    }
    await snap(page, '42-reports-pipeline-tab');
    await assertNoCrash(page);

    expect(errors).toHaveLength(0);
  });
});
