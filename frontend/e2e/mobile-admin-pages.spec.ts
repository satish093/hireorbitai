/**
 * Mobile-viewport admin / management page screenshot + layout tests.
 *
 * This is the mobile companion to admin-pages.spec.ts. For each of the ten
 * admin/management pages it:
 *   1. Seeds a session with the minimum role required.
 *   2. Mocks every API endpoint the page touches.
 *   3. Waits for networkidle so all async fetches resolve.
 *   4. Asserts no horizontal overflow (scrollWidth ≤ clientWidth).
 *   5. Captures a full-page screenshot → e2e-results/mobile-admin-<page>.png.
 *   6. Runs axe and logs (but does not hard-fail on) a11y violations —
 *      same soft-audit pattern as mobile-audit.spec.ts.
 *   7. Asserts zero uncaught JS exceptions via trackPageErrors.
 *
 * Pages covered:
 *   /recruiters, /vendors, /clients, /invitations,
 *   /admin/features, /admin/groups, /admin/deactivated,
 *   /ai-email, /ai-usage, /users/u-manager
 *
 * No real backend or Postgres needed — all API calls are intercepted.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, mockApi, MANAGER, trackPageErrors } from './_helpers';
import { ALL_FLAGS, BASE_HANDLERS, MOCK_RECRUITERS, MOCK_CONSULTANTS } from './_mock-data';

// ─── Device emulation — iPhone 12 form factor on Chromium ────────────────────
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
});

// ─── Mock fixtures (mirrored from admin-pages.spec.ts) ────────────────────────

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

// Shape matches the current AIUsage page: top-level totals plus `paid`
// (Anthropic) and `free` (Groq + Gemini) sub-objects driving the two tabs.
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
  paid: {
    totals: {
      calls: 10,
      input_tokens: 40000,
      output_tokens: 6000,
      cache_tokens: 1000,
      cost_usd: '0.2340',
    },
    by_call: [
      {
        call_name: 'resume-score',
        provider: 'anthropic',
        calls: 10,
        input_tokens: 40000,
        output_tokens: 6000,
        cost_usd: '0.2340',
      },
    ],
  },
  free: {
    totals: { calls: 32, input_tokens: 45000, output_tokens: 6000, cost_usd: '0.0000' },
    by_call: [
      {
        call_name: 'vendor-email',
        provider: 'groq',
        calls: 20,
        input_tokens: 30000,
        output_tokens: 4000,
        cost_usd: '0',
      },
      {
        call_name: 'job-match',
        provider: 'gemini',
        calls: 12,
        input_tokens: 15000,
        output_tokens: 2000,
        cost_usd: '0',
      },
    ],
    by_model: [
      { model: 'llama-3.3-70b', provider: 'groq', calls: 20, total_tokens: 34000, cost_usd: '0' },
      {
        model: 'gemini-2.5-flash',
        provider: 'gemini',
        calls: 12,
        total_tokens: 17000,
        cost_usd: '0',
      },
    ],
  },
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

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Returns true if the document body overflows horizontally at the current viewport. */
async function hasHorizontalOverflow(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth);
}

/**
 * Captures a full-page screenshot and runs axe.
 * Logs critical/serious violations but does NOT hard-fail — layout regressions
 * are caught by the overflow assertion; a11y is a soft signal here.
 */
async function screenshotAndAudit(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.screenshot({ path: `e2e-results/mobile-admin-${name}.png`, fullPage: true });
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
      .join('\n');
    console.warn(`Mobile a11y violations on ${name}:\n${summary}`);
  }
}

/** Standard setup: MANAGER session + all feature flags on + base handlers. */
async function managerSetup(
  page: import('@playwright/test').Page,
  extraHandlers: Record<string, { json: unknown; status?: number }> = {},
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

// ─── /recruiters ─────────────────────────────────────────────────────────────

test.describe('Mobile — Recruiters page', () => {
  test('renders recruiter list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, { '/recruiters': { json: MOCK_RECRUITERS } });
    await page.goto('/recruiters');
    await page.waitForLoadState('networkidle');

    // Name appears in both the mobile card and the (hidden) desktop table, which
    // is last in the DOM — scope to the visible (mobile) occurrence.
    await expect(page.getByText('Riley Recruiter').filter({ visible: true }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Sam Recruiter').filter({ visible: true }).first()).toBeVisible({
      timeout: 8000,
    });
    // 'team' column is hideOnMobile:true — only in desktop table, not in mobile card

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'recruiters');
    expect(errors).toHaveLength(0);
  });
});

// ─── /vendors ────────────────────────────────────────────────────────────────

test.describe('Mobile — Vendors page', () => {
  test('renders vendor list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, { '/vendors': { json: MOCK_VENDORS } });
    await page.goto('/vendors');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('TechStaff Inc').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('DataBridge LLC').last()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'vendors');
    expect(errors).toHaveLength(0);
  });
});

// ─── /clients ────────────────────────────────────────────────────────────────

test.describe('Mobile — Clients page', () => {
  test('renders client list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, { '/clients': { json: MOCK_CLIENTS } });
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Acme Corp').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Beta Inc').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Technology').last()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'clients');
    expect(errors).toHaveLength(0);
  });
});

// ─── /invitations ─────────────────────────────────────────────────────────────

test.describe('Mobile — Invitations page', () => {
  test('renders invitation list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/invitations': { json: MOCK_INVITATIONS },
      '/user-groups': { json: MOCK_USER_GROUPS },
    });
    await page.goto('/invitations');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('newuser@example.com').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('another@example.com').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /revoke/i }).first()).toBeVisible({
      timeout: 8000,
    });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'invitations');
    expect(errors).toHaveLength(0);
  });
});

// ─── /admin/features  (SUPER_ADMIN only) ─────────────────────────────────────

test.describe('Mobile — Feature Flags page', () => {
  const SUPER_ADMIN = { ...MANAGER, role: 'SUPER_ADMIN' as const };

  test('renders feature flag toggles with no horizontal overflow', async ({ page }) => {
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
    await expect(page.locator('.font-mono', { hasText: 'tasks' }).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('.font-mono', { hasText: 'messages' }).first()).toBeVisible({
      timeout: 8000,
    });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'features');
    expect(errors).toHaveLength(0);
  });
});

// ─── /admin/groups ────────────────────────────────────────────────────────────

test.describe('Mobile — User Groups page', () => {
  // /admin/groups is ADMIN_TIER (CTO+); a MANAGER session would be
  // redirected to /unauthorized. Mirrors the desktop admin-pages fix.
  const CTO = { ...MANAGER, role: 'CTO' as const };

  test('renders groups list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, CTO);
    await mockApi(page, {
      profile: CTO,
      flags: ALL_FLAGS,
      handlers: {
        ...BASE_HANDLERS,
        '/user-groups': { json: MOCK_USER_GROUPS },
        '/consultants': { json: MOCK_CONSULTANTS },
        '/recruiters': { json: MOCK_RECRUITERS },
      },
    });
    await page.goto('/admin/groups');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'User groups' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'Cloudfen' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'Zangle IT' })).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'groups');
    expect(errors).toHaveLength(0);
  });
});

// ─── /admin/deactivated  (ADMIN_TIER: CTO+) ──────────────────────────────────

test.describe('Mobile — Deactivated Accounts page', () => {
  const CTO = { ...MANAGER, role: 'CTO' as const };

  test('renders deactivated user list with no horizontal overflow', async ({ page }) => {
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
    await expect(page.getByText('Deactivated User').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Suspended User').last()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /reactivate/i }).first()).toBeVisible({
      timeout: 8000,
    });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'deactivated');
    expect(errors).toHaveLength(0);
  });
});

// ─── /ai-email  (OPERATOR_TIER + ai_email flag) ───────────────────────────────

test.describe('Mobile — AI Email page', () => {
  test('renders composer form with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/ai/vendor-email': { json: { subject: 'Test Subject', body: 'Test body text.' } },
    });
    await page.goto('/ai-email');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('AI vendor email generator')).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel('Consultant name *')).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel('Job title *')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /generate email/i })).toBeVisible({
      timeout: 8000,
    });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'ai-email');
    expect(errors).toHaveLength(0);
  });
});

// ─── /ai-usage  (MANAGER_TIER) ────────────────────────────────────────────────

test.describe('Mobile — AI Usage page', () => {
  test('renders KPI cards with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await managerSetup(page, {
      '/ai-usage/summary': { json: MOCK_AI_SUMMARY },
      '/ai-usage/logs': { json: MOCK_AI_LOGS },
    });
    await page.goto('/ai-usage');
    await page.waitForLoadState('networkidle');

    // Page lands on the Free Models tab.
    await expect(page.getByRole('heading', { name: 'AI Usage' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Free Calls', { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Total Tokens')).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'ai-usage');
    expect(errors).toHaveLength(0);
  });
});

// ─── /users/:id ───────────────────────────────────────────────────────────────

test.describe('Mobile — User Profile page', () => {
  test('renders user profile with contact details and no horizontal overflow', async ({ page }) => {
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
    await expect(page.getByText('+1 555-0100')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Chicago', { exact: true })).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'user-profile');
    expect(errors).toHaveLength(0);
  });
});
