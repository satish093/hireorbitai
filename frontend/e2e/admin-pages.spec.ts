/**
 * Admin / management page smoke tests.
 *
 * Each test:
 *   1. Seeds a session with the minimum role required to reach the page.
 *   2. Mocks every API endpoint the page touches (unmocked calls fall back
 *      to [] / {} via the catch-all in _helpers, but richer mocks ensure
 *      the page renders real content rather than an empty-state).
 *   3. Asserts visible content so we know the page actually rendered.
 *   4. Captures a screenshot → e2e-results/audit-<page>.png.
 *   5. Asserts there are no uncaught JS exceptions.
 *
 * Pages covered:
 *   /recruiters, /vendors, /clients, /invitations,
 *   /admin/features, /admin/groups, /admin/deactivated,
 *   /ai-email, /ai-usage, /users/:id
 *
 * No real backend or Postgres needed — all API calls are intercepted.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, trackPageErrors } from './_helpers';
import { ALL_FLAGS, BASE_HANDLERS, MOCK_RECRUITERS, MOCK_CONSULTANTS } from './_mock-data';

// ---------------------------------------------------------------------------
// Mock fixtures shared by multiple tests
// ---------------------------------------------------------------------------

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

const MOCK_INVITATIONS = [
  {
    id: 'inv-1',
    email: 'newuser@example.com',
    role: 'CONSULTANT',
    status: 'PENDING',
    expires_at: '2026-06-30T00:00:00.000Z',
    invite_url: 'https://hireorbit.ai/invite/accept?token=abc123',
  },
  {
    id: 'inv-2',
    email: 'another@example.com',
    role: 'RECRUITER',
    status: 'ACCEPTED',
    expires_at: '2026-06-15T00:00:00.000Z',
    invite_url: null,
  },
];

const MOCK_FEATURE_FLAGS = [
  {
    key: 'tasks',
    enabled: true,
    description: 'Task management module',
    updated_at: '2026-05-01T00:00:00.000Z',
    updated_by: 'u-admin',
  },
  {
    key: 'messages',
    enabled: true,
    description: 'Internal messaging',
    updated_at: '2026-05-01T00:00:00.000Z',
    updated_by: 'u-admin',
  },
  {
    key: 'ai_email',
    enabled: false,
    description: 'AI vendor email generator',
    updated_at: '2026-05-01T00:00:00.000Z',
    updated_by: null,
  },
];

const MOCK_USER_GROUPS = [
  {
    id: 'g-1',
    name: 'Cloudfen',
    slug: 'cloudfen',
    description: 'Cloudfen consulting group',
    is_active: true,
    member_count: 3,
    color: '#6366F1',
  },
  {
    id: 'g-2',
    name: 'Zangle IT',
    slug: 'zangle-it',
    description: null,
    is_active: true,
    member_count: 1,
    color: '#10B981',
  },
];

const MOCK_DEACTIVATED_USERS = [
  {
    id: 'u-deact-1',
    email: 'deact1@example.com',
    full_name: 'Deactivated User',
    role: 'CONSULTANT',
    is_active: false,
    status: 'inactive',
    status_reason: null,
    status_changed_at: '2026-05-10T00:00:00.000Z',
    last_seen_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-10T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    group_id: null,
  },
  {
    id: 'u-deact-2',
    email: 'suspended@example.com',
    full_name: 'Suspended User',
    role: 'RECRUITER',
    is_active: false,
    status: 'suspended',
    status_reason: 'Policy violation',
    status_changed_at: '2026-05-12T00:00:00.000Z',
    last_seen_at: '2026-04-28T00:00:00.000Z',
    updated_at: '2026-05-12T00:00:00.000Z',
    created_at: '2026-02-01T00:00:00.000Z',
    group_id: null,
  },
];

const MOCK_AI_SUMMARY = {
  days: 30,
  totals: {
    calls: 42,
    input_tokens: 85000,
    output_tokens: 12000,
    cache_tokens: 3000,
    cost_usd: '0.2340',
  },
  by_call: [
    {
      call_name: 'vendor-email',
      calls: 30,
      input_tokens: 60000,
      output_tokens: 8000,
      cost_usd: '0.1500',
    },
    {
      call_name: 'resume-score',
      calls: 12,
      input_tokens: 25000,
      output_tokens: 4000,
      cost_usd: '0.0840',
    },
  ],
  by_model: [{ model: 'claude-sonnet-4-5', calls: 42, total_tokens: 100000, cost_usd: '0.2340' }],
};

const MOCK_AI_LOGS = [
  {
    id: 'log-1',
    call_name: 'vendor-email',
    model: 'claude-sonnet-4-5',
    input_tokens: 2000,
    output_tokens: 400,
    cache_read_tokens: 0,
    cost_usd: '0.0080',
    created_at: '2026-05-20T14:32:00.000Z',
  },
];

const MOCK_USER_PROFILE = {
  id: 'u-manager',
  email: 'manager@test.local',
  full_name: 'Morgan Manager',
  first_name: 'Morgan',
  last_name: 'Manager',
  phone: '+1 555-0100',
  role: 'MANAGER',
  avatar_url: null,
  is_active: true,
  last_seen_at: '2026-05-24T10:00:00.000Z',
  group_id: null,
  reports_to: null,
  address_line1: '100 Main St',
  address_line2: null,
  city: 'Chicago',
  state: 'IL',
  postal_code: '60601',
  country: 'US',
  timezone: 'America/Chicago',
  linkedin_url: null,
  context: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard setup: MANAGER session + all feature flags on. */
async function managerSetup(
  page: import('@playwright/test').Page,
  extraHandlers: Record<string, { json: unknown }> = {},
) {
  await seedSession(page, MANAGER);
  await mockApi(page, {
    profile: MANAGER,
    flags: ALL_FLAGS,
    handlers: {
      ...BASE_HANDLERS,
      '/user-groups': { json: MOCK_USER_GROUPS },
      ...extraHandlers,
    },
  });
}

// ---------------------------------------------------------------------------
// /recruiters
// ---------------------------------------------------------------------------

test.describe('Recruiters page', () => {
  test('renders recruiter list with team names', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/recruiters': { json: MOCK_RECRUITERS },
    });
    await page.goto('/recruiters');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Riley Recruiter').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Sam Recruiter').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Team Alpha').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Team Beta').first()).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-recruiters.png' });
    expect(errors).toHaveLength(0);
  });

  test('Manage supervisors button opens modal', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/recruiters': { json: MOCK_RECRUITERS },
    });
    await page.goto('/recruiters');
    await page.waitForLoadState('networkidle');

    const manageBtn = page.getByRole('button', { name: /manage supervisors/i }).first();
    await manageBtn.waitFor({ timeout: 8000 });
    await manageBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /vendors
// ---------------------------------------------------------------------------

test.describe('Vendors page', () => {
  test('renders vendor list with company names', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/vendors': { json: MOCK_VENDORS },
    });
    await page.goto('/vendors');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('TechStaff Inc').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('DataBridge LLC').first()).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-vendors.png' });
    expect(errors).toHaveLength(0);
  });

  test('New vendor button opens modal; Cancel closes it', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/vendors': { json: MOCK_VENDORS },
    });
    await page.goto('/vendors');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('dialog').getByText('New vendor')).toBeVisible();

    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /clients
// ---------------------------------------------------------------------------

test.describe('Clients page', () => {
  test('renders client list with company names', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/clients': { json: MOCK_CLIENTS },
    });
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Acme Corp').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Beta Inc').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Technology').first()).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-clients.png' });
    expect(errors).toHaveLength(0);
  });

  test('New client button opens modal; Escape closes it', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/clients': { json: MOCK_CLIENTS },
    });
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /new client/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /invitations
// ---------------------------------------------------------------------------

test.describe('Invitations page', () => {
  test('renders pending invitations list', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/invitations': { json: MOCK_INVITATIONS },
      '/user-groups': { json: MOCK_USER_GROUPS },
    });
    await page.goto('/invitations');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('newuser@example.com').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('another@example.com').first()).toBeVisible({ timeout: 8000 });
    // Pending invite should show Revoke button
    await expect(page.getByRole('button', { name: /revoke/i }).first()).toBeVisible({
      timeout: 8000,
    });

    await page.screenshot({ path: 'e2e-results/audit-invitations.png' });
    expect(errors).toHaveLength(0);
  });

  test('Invite user button opens modal; Cancel closes it', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/invitations': { json: MOCK_INVITATIONS },
      '/user-groups': { json: MOCK_USER_GROUPS },
    });
    await page.goto('/invitations');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /invite user/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('dialog').getByText('Invite user')).toBeVisible();

    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /admin/features  (OWNER_TIER: SUPER_ADMIN)
// ---------------------------------------------------------------------------

test.describe('Feature Flags page', () => {
  const SUPER_ADMIN = { ...MANAGER, role: 'SUPER_ADMIN' as const };

  test('renders feature flag toggles', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, SUPER_ADMIN);
    await mockApi(page, {
      profile: SUPER_ADMIN,
      flags: ALL_FLAGS,
      handlers: {
        ...BASE_HANDLERS,
        '/user-groups': { json: MOCK_USER_GROUPS },
        '/feature-flags': { json: MOCK_FEATURE_FLAGS },
        '/feature-flags/overrides': { json: [] },
      },
    });
    await page.goto('/admin/features');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Feature flags' })).toBeVisible({
      timeout: 8000,
    });
    // The feature flag key is shown as font-mono text under each row.
    // Use exact match to avoid collision with the sidebar nav link "Tasks".
    await expect(page.locator('.font-mono', { hasText: 'tasks' }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('.font-mono', { hasText: 'messages' }).first()).toBeVisible({
      timeout: 8000,
    });

    await page.screenshot({ path: 'e2e-results/audit-feature-flags.png' });
    expect(errors).toHaveLength(0);
  });

  test('MANAGER is redirected away from /admin/features (OWNER only)', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page);
    await page.goto('/admin/features');
    await page.waitForLoadState('load');

    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 8000 });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /admin/groups
// ---------------------------------------------------------------------------

test.describe('User Groups page', () => {
  test('renders groups list with member counts', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/user-groups': { json: MOCK_USER_GROUPS },
      '/consultants': { json: MOCK_CONSULTANTS },
      '/recruiters': { json: MOCK_RECRUITERS },
    });
    await page.goto('/admin/groups');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'User groups' })).toBeVisible({ timeout: 8000 });
    // Group name headings inside the cards
    await expect(page.getByRole('heading', { name: 'Cloudfen' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'Zangle IT' })).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-user-groups.png' });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /admin/deactivated  (ADMIN_TIER: CTO+)
// ---------------------------------------------------------------------------

test.describe('Deactivated Accounts page', () => {
  const CTO = { ...MANAGER, role: 'CTO' as const };

  test('renders deactivated user list with statuses', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, CTO);
    await mockApi(page, {
      profile: CTO,
      flags: ALL_FLAGS,
      handlers: {
        ...BASE_HANDLERS,
        '/user-groups': { json: MOCK_USER_GROUPS },
        '/users/deactivated': { json: MOCK_DEACTIVATED_USERS },
      },
    });
    await page.goto('/admin/deactivated');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Deactivated accounts' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Deactivated User').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Suspended User').first()).toBeVisible({ timeout: 8000 });
    // Each row should have a Reactivate button
    await expect(page.getByRole('button', { name: /reactivate/i }).first()).toBeVisible({
      timeout: 8000,
    });

    await page.screenshot({ path: 'e2e-results/audit-deactivated.png' });
    expect(errors).toHaveLength(0);
  });

  test('MANAGER is redirected away from /admin/deactivated (ADMIN_TIER only)', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page);
    await page.goto('/admin/deactivated');
    await page.waitForLoadState('load');

    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 8000 });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /ai-email  (OPERATOR_TIER + ai_email flag)
// ---------------------------------------------------------------------------

test.describe('AI Email page', () => {
  test('renders composer form and empty output panel', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/ai/vendor-email': { json: { subject: 'Test Subject', body: 'Test body text.' } },
    });
    await page.goto('/ai-email');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('AI vendor email generator')).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel('Consultant name *')).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel('Job title *')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /generate email/i })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/audit-ai-email.png' });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /ai-usage  (MANAGER_TIER)
// ---------------------------------------------------------------------------

test.describe('AI Usage page', () => {
  test('renders KPI cards and usage breakdown', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/ai-usage/summary': { json: MOCK_AI_SUMMARY },
      '/ai-usage/logs': { json: MOCK_AI_LOGS },
    });
    await page.goto('/ai-usage');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('AI Token Usage')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Est. Cost (USD)')).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-ai-usage.png' });
    expect(errors).toHaveLength(0);
  });

  test('period buttons switch the time window', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/ai-usage/summary': { json: MOCK_AI_SUMMARY },
      '/ai-usage/logs': { json: MOCK_AI_LOGS },
    });
    await page.goto('/ai-usage');
    await page.waitForLoadState('networkidle');

    // 7d button should be visible and clickable
    const btn7d = page.getByRole('button', { name: '7d' });
    await btn7d.waitFor({ timeout: 8000 });
    await btn7d.click();
    // After click the page should still be functional
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 5000 });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /users/:id  (any authenticated user)
// ---------------------------------------------------------------------------

test.describe('User Profile page', () => {
  test('renders user profile with name and contact details', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/users/u-manager': { json: MOCK_USER_PROFILE },
    });
    await page.goto('/users/u-manager');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Morgan Manager' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('manager@test.local').first()).toBeVisible({ timeout: 8000 });
    // Contact card should show phone
    await expect(page.getByText('+1 555-0100')).toBeVisible({ timeout: 8000 });
    // Address city — use exact match to avoid matching 'America/Chicago' timezone
    await expect(page.getByText('Chicago', { exact: true })).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-user-profile.png' });
    expect(errors).toHaveLength(0);
  });

  test('Edit button appears and switches to edit mode', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/users/u-manager': { json: MOCK_USER_PROFILE },
    });
    await page.goto('/users/u-manager');
    await page.waitForLoadState('networkidle');

    const editBtn = page.getByRole('button', { name: /^edit$/i });
    await editBtn.waitFor({ timeout: 8000 });
    await editBtn.click();

    // In editing mode, Save and Cancel buttons should be visible
    await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible({ timeout: 5000 });

    // Cancel goes back to view mode
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible({ timeout: 3000 });

    expect(errors).toHaveLength(0);
  });
});
