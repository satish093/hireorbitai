/**
 * Comprehensive smoke-test coverage pass.
 *
 * Covers the pages and flows listed in the security/QA task:
 *   login, dashboard, inbox (messages), image/PDF attachment click-to-open,
 *   audio call button, consultants, recruiters, managers, jobs, clients, vendors.
 *
 * Each test:
 *   1. Seeds a session.
 *   2. Mocks every API the page touches (unmocked → empty success via catch-all).
 *   3. Asserts the key heading or content landmark is visible.
 *   4. Captures a screenshot to e2e-results/smoke-<page>.png.
 *   5. Asserts zero uncaught JS exceptions.
 *
 * Also tests responsive layout (no horizontal overflow) at mobile / tablet /
 * desktop breakpoints for each page.
 *
 * No real backend required — all API calls are intercepted by mockApi().
 */

import { test, expect, type Page } from '@playwright/test';
import { seedSession, mockApi, MANAGER, RECRUITER, CONSULTANT, trackPageErrors } from './_helpers';
import {
  ALL_FLAGS,
  BASE_HANDLERS,
  MOCK_RECRUITERS,
  MOCK_CONSULTANTS,
  MOCK_CONVERSATIONS,
  MOCK_JOBS,
  MANAGER_SUMMARY,
} from './_mock-data';

// ---------------------------------------------------------------------------
// Shared mock data for smoke tests
// ---------------------------------------------------------------------------

const MOCK_MANAGERS = [
  {
    id: 'u-manager',
    email: 'manager@test.local',
    full_name: 'Morgan Manager',
    role: 'MANAGER',
    status: 'active',
    group_id: null,
    recruiter_count: 2,
    last_login_at: '2026-05-22T08:00:00.000Z',
  },
  {
    id: 'u-hr',
    email: 'hr@test.local',
    full_name: 'Hunter HR',
    role: 'HR_MANAGER',
    status: 'active',
    group_id: null,
    recruiter_count: 1,
    last_login_at: '2026-05-21T12:00:00.000Z',
  },
];

const MOCK_VENDORS = [
  {
    id: 'v-1',
    company_name: 'TechStaff Inc',
    contact_name: 'Jane Doe',
    contact_email: 'jane@techstaff.com',
    tier: 'T1',
    website: 'https://techstaff.com',
  },
  {
    id: 'v-2',
    company_name: 'DataBridge LLC',
    contact_name: 'John Smith',
    contact_email: 'john@databridge.com',
    tier: 'T2',
    website: '',
  },
];

const MOCK_CLIENTS = [
  {
    id: 'cl-1',
    company_name: 'Acme Corp',
    industry: 'Technology',
    contact_name: 'Alice Brown',
    contact_email: 'alice@acme.com',
    location: 'New York, NY',
  },
  {
    id: 'cl-2',
    company_name: 'Beta Inc',
    industry: 'Finance',
    contact_name: 'Bob Green',
    contact_email: 'bob@beta.com',
    location: 'Austin, TX',
  },
];

/** Message thread containing an image and a PDF attachment. */
const MOCK_THREAD_WITH_ATTACHMENTS = [
  {
    id: 'msg-img',
    sender_id: 'u-c1',
    recipient_id: 'u-manager',
    body: 'Here is my profile photo',
    read_at: null,
    created_at: '2026-05-22T10:00:00.000Z',
    attachments: [
      {
        id: 'att-img',
        file_name: 'photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 204800,
        // Self-contained data URI so the thumbnail loads in the sandboxed test
        // (an external URL never loads → the image button collapses to 0px and
        // is "hidden"). 240×180 gray rect.
        download_url:
          'data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27240%27%20height%3D%27180%27%3E%3Crect%20width%3D%27240%27%20height%3D%27180%27%20fill%3D%27%23cbd5e1%27%2F%3E%3C%2Fsvg%3E',
        is_image: true,
      },
    ],
  },
  {
    id: 'msg-pdf',
    sender_id: 'u-c1',
    recipient_id: 'u-manager',
    body: 'And my resume',
    read_at: null,
    created_at: '2026-05-22T10:01:00.000Z',
    attachments: [
      {
        id: 'att-pdf',
        file_name: 'alice-resume.pdf',
        mime_type: 'application/pdf',
        size_bytes: 512000,
        download_url: '/api/files/messages/alice-resume.pdf?token=fake',
        is_image: false,
      },
    ],
  },
];

/** Standard manager setup used by most tests. */
async function setup(
  page: Page,
  extra: Record<string, { json?: unknown; status?: number; body?: string }> = {},
) {
  await seedSession(page, MANAGER);
  await mockApi(page, {
    profile: MANAGER,
    flags: ALL_FLAGS,
    handlers: {
      ...BASE_HANDLERS,
      '/managers': { json: MOCK_MANAGERS },
      '/vendors': { json: MOCK_VENDORS },
      '/clients': { json: MOCK_CLIENTS },
      '/user-groups': { json: [] },
      ...extra,
    },
  });
}

// ---------------------------------------------------------------------------
// Login page
// ---------------------------------------------------------------------------

test.describe('Login page', () => {
  test('renders email + password form and submit button', async ({ page }) => {
    const errors = trackPageErrors(page);
    await mockApi(page, {});
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /sign in|log in|welcome/i }).first(),
    ).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign in|log in|continue/i }).first(),
    ).toBeVisible();

    await page.screenshot({ path: 'e2e-results/smoke-login.png' });
    expect(errors).toHaveLength(0);
  });

  test('shows error toast on invalid credentials', async ({ page }) => {
    const errors = trackPageErrors(page);
    await mockApi(page, {
      handlers: {
        'POST /auth/login': { status: 401, json: { error: 'Invalid email or password' } },
      },
    });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.locator('input[type="email"], input[name="email"]').first().fill('bad@example.com');
    await page.locator('input[type="password"]').first().fill('wrongpassword');
    await page
      .getByRole('button', { name: /sign in|log in|continue/i })
      .first()
      .click();

    // Toast or inline error message should appear
    await expect(page.getByText(/invalid|incorrect|wrong|error/i).first()).toBeVisible({
      timeout: 6000,
    });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

test.describe('Dashboard', () => {
  test('manager dashboard renders KPI strip and task metrics', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, {
      '/reports/manager-summary': { json: MANAGER_SUMMARY },
    });
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // The page should not be the login page
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible({
      timeout: 8000,
    });

    await page.screenshot({ path: 'e2e-results/smoke-dashboard.png' });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Inbox / Messages
// ---------------------------------------------------------------------------

test.describe('Messages / inbox', () => {
  test('renders conversation list and chat pane', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, {
      '/messages/conversations': { json: MOCK_CONVERSATIONS },
      '/messages/directory': { json: [] },
    });
    await page.goto('/messages');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Alice Chen').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Can we schedule a call').first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e-results/smoke-messages.png' });
    expect(errors).toHaveLength(0);
  });

  test('image attachment chip is rendered for messages with attachments', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, {
      '/messages/conversations': { json: MOCK_CONVERSATIONS },
      '/messages/directory': { json: [] },
      '/messages/with/u-c1': { json: MOCK_THREAD_WITH_ATTACHMENTS },
    });
    await page.goto('/messages');
    await page.waitForLoadState('networkidle');

    // Open the conversation with Alice
    await page.getByText('Alice Chen').first().click();
    // Wait for thread to load
    await page.waitForTimeout(1000);

    // Should show the attachment chip for the image
    await expect(page.getByText(/photo\.jpg|alice-resume|resume/i).first()).toBeVisible({
      timeout: 8000,
    });

    await page.screenshot({ path: 'e2e-results/smoke-messages-attachment.png' });
    expect(errors).toHaveLength(0);
  });

  test('voice call button is present in active chat pane', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, {
      '/messages/conversations': { json: MOCK_CONVERSATIONS },
      '/messages/directory': { json: [] },
      '/calls/token': { json: { token: 'fake-ice-token', ttl: 3600 } },
    });
    await page.goto('/messages');
    await page.waitForLoadState('networkidle');

    // Open the first conversation
    await page.getByText('Alice Chen').first().click();
    await page.waitForTimeout(800);

    // The phone/call button should be visible in the chat header
    const callBtn = page.getByRole('button', { name: /voice call|call/i }).first();
    await expect(callBtn).toBeVisible({ timeout: 8000 });
    // It should be enabled (idle call status)
    await expect(callBtn).not.toBeDisabled();

    await page.screenshot({ path: 'e2e-results/smoke-call-button.png' });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PDF viewer (lazy-loaded MediaViewerModal — iframe-based, no pdfjs-dist)
// ---------------------------------------------------------------------------

test.describe('PDF / image attachment viewer', () => {
  test('clicking PDF attachment opens the iframe-based viewer modal', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, {
      '/messages/conversations': { json: MOCK_CONVERSATIONS },
      '/messages/directory': { json: [] },
      '/messages/with/u-c1': { json: MOCK_THREAD_WITH_ATTACHMENTS },
    });
    // Intercept the file URL so the iframe src doesn't 404 in the test browser
    await page.route('**/api/files/**', (route) =>
      route.fulfill({
        contentType: 'application/pdf',
        body: '%PDF-1.4 fake-pdf-content',
        status: 200,
      }),
    );

    await page.goto('/messages');
    await page.waitForLoadState('networkidle');
    await page.getByText('Alice Chen').first().click();
    await page.waitForTimeout(800);

    // Click the PDF attachment chip / button
    const pdfChip = page
      .getByRole('button', { name: /alice-resume\.pdf|resume\.pdf|\.pdf/i })
      .first();
    await pdfChip.waitFor({ timeout: 8000 });
    await pdfChip.click();

    // The lazy-loaded MediaViewerModal should mount and show the iframe viewer
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
    // Should show the PDF filename in the title bar
    await expect(page.getByText(/alice-resume\.pdf/i).first()).toBeVisible({ timeout: 5000 });
    // Should show "Open in new tab" link
    await expect(page.getByRole('link', { name: /open in new tab/i }).first()).toBeVisible({
      timeout: 5000,
    });
    // Should NOT have any pdfjs-dist Worker element (confirming iframe replacement)
    const workerEl = page.locator('[data-pdf-worker], canvas.react-pdf__Page__canvas');
    await expect(workerEl).not.toBeVisible();

    await page.screenshot({ path: 'e2e-results/smoke-pdf-viewer.png' });
    // Close the viewer. The PDF iframe can hold keyboard focus (Escape would go
    // to the iframe, not the modal), so use the explicit Close control.
    await page.getByRole('button', { name: /close viewer/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });

  test('clicking image attachment opens the lightbox', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, {
      '/messages/conversations': { json: MOCK_CONVERSATIONS },
      '/messages/directory': { json: [] },
      '/messages/with/u-c1': { json: MOCK_THREAD_WITH_ATTACHMENTS },
    });
    await page.goto('/messages');
    await page.waitForLoadState('networkidle');
    await page.getByText('Alice Chen').first().click();
    await page.waitForTimeout(800);

    const imgChip = page.getByRole('button', { name: /photo\.jpg|\.jpg|image/i }).first();
    await imgChip.waitFor({ timeout: 8000 });
    await imgChip.click();

    // Lightbox should open
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/smoke-image-lightbox.png' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Consultants
// ---------------------------------------------------------------------------

test.describe('Consultants page', () => {
  test('renders consultant list with names and skills', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, {
      '/consultants': { json: MOCK_CONSULTANTS },
    });
    await page.goto('/consultants');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /consultants/i }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Alice Chen').first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('Bob Kim').first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e-results/smoke-consultants.png' });
    expect(errors).toHaveLength(0);
  });

  test('consultant row links to detail page', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, { '/consultants': { json: MOCK_CONSULTANTS } });
    await page.goto('/consultants');
    await page.waitForLoadState('networkidle');

    // Each consultant name should be a link to /users/:id
    const link = page.getByRole('link', { name: /Alice Chen/i }).first();
    await expect(link).toBeVisible({ timeout: 8000 });
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/users\/u-c1/);

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Recruiters
// ---------------------------------------------------------------------------

test.describe('Recruiters page', () => {
  test('renders recruiter list with team names', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, { '/recruiters': { json: MOCK_RECRUITERS } });
    await page.goto('/recruiters');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /recruiters/i }).first()).toBeVisible({
      timeout: 8000,
    });
    // Mobile cards (md:hidden) render before the desktop table, so the name
    // appears twice; scope to the visible (desktop) occurrence.
    await expect(page.getByText('Riley Recruiter').filter({ visible: true }).first()).toBeVisible({
      timeout: 6000,
    });
    await expect(page.getByText('Team Alpha').filter({ visible: true }).first()).toBeVisible({
      timeout: 5000,
    });

    await page.screenshot({ path: 'e2e-results/smoke-recruiters.png' });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

test.describe('Managers page', () => {
  test('renders manager list with roles and stats', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, { '/managers': { json: MOCK_MANAGERS } });
    await page.goto('/managers');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /managers/i }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Morgan Manager').first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('Hunter HR').first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e-results/smoke-managers.png' });
    expect(errors).toHaveLength(0);
  });

  test('KPI counters appear in the stats strip', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page, { '/managers': { json: MOCK_MANAGERS } });
    await page.goto('/managers');
    await page.waitForLoadState('networkidle');

    // Labels like "Total leads", "Managers", "HR Managers", "Assigned recruiters"
    await expect(page.getByText(/total leads/i).first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

test.describe('Jobs page', () => {
  test('renders job cards with title and company', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /jobs/i }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Senior Software Engineer').first()).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/smoke-jobs.png' });
    expect(errors).toHaveLength(0);
  });

  test('tab bar renders Recommended / Saved / Applied tabs', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('tab', { name: /recommended/i }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByRole('tab', { name: /saved|liked/i }).first()).toBeVisible({
      timeout: 5000,
    });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

test.describe('Vendors page', () => {
  test('renders vendor list with company names and tiers', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto('/vendors');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /vendors/i }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('TechStaff Inc').first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('T1').first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e-results/smoke-vendors.png' });
    expect(errors).toHaveLength(0);
  });

  test('Edit button appears on each vendor row', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto('/vendors');
    await page.waitForLoadState('networkidle');

    const editBtns = page.getByRole('button', { name: /^edit$/i });
    await expect(editBtns.first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('Edit button opens modal in edit mode', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto('/vendors');
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: /^edit$/i })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /save changes/i }).first()).toBeVisible({
      timeout: 5000,
    });

    await page.keyboard.press('Escape');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

test.describe('Clients page', () => {
  test('renders client list with company names and industries', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /clients/i }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Acme Corp').first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('Technology').first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e-results/smoke-clients.png' });
    expect(errors).toHaveLength(0);
  });

  test('Edit button opens modal in edit mode', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: /^edit$/i })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /save changes/i }).first()).toBeVisible({
      timeout: 5000,
    });

    await page.keyboard.press('Escape');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Responsive layout — no horizontal overflow at 3 breakpoints × N pages
// ---------------------------------------------------------------------------

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const PAGES_TO_CHECK = [
  { path: '/dashboard', label: 'dashboard' },
  { path: '/messages', label: 'messages' },
  { path: '/consultants', label: 'consultants' },
  { path: '/recruiters', label: 'recruiters' },
  { path: '/managers', label: 'managers' },
  { path: '/jobs', label: 'jobs' },
  { path: '/vendors', label: 'vendors' },
  { path: '/clients', label: 'clients' },
] as const;

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`Responsive — ${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const pg of PAGES_TO_CHECK) {
      test(`${pg.label} has no horizontal overflow at ${vp.name}`, async ({ page }) => {
        const errors = trackPageErrors(page);
        await setup(page);
        await page.goto(pg.path);
        await page.waitForLoadState('load');

        const clean = await noHorizontalOverflow(page);
        if (!clean) {
          await page.screenshot({ path: `e2e-results/overflow-${pg.label}-${vp.name}.png` });
        }
        expect(clean, `${pg.label} has horizontal overflow at ${vp.name}`).toBe(true);
        expect(errors).toHaveLength(0);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Responsive — login page at all breakpoints
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test.describe(`Responsive — login ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`login has no horizontal overflow at ${vp.name}`, async ({ page }) => {
      const errors = trackPageErrors(page);
      await mockApi(page, {});
      await page.goto('/login');
      await page.waitForLoadState('load');

      const clean = await noHorizontalOverflow(page);
      expect(clean).toBe(true);
      expect(errors).toHaveLength(0);
    });
  });
}
