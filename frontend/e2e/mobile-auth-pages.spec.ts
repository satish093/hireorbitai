/**
 * Mobile viewport smoke suite for auth + onboarding pages.
 *
 * Mirrors `auth-pages.spec.ts` but runs at a 390×844 iPhone 12 viewport.
 * For every page this suite:
 *   1. Loads the page with the same mocked API as the desktop counterpart.
 *   2. Waits for networkidle so async-rendered content settles.
 *   3. Asserts no horizontal overflow (scrollWidth ≤ clientWidth).
 *   4. Captures a full-page screenshot to e2e-results/mobile-auth-<name>.png.
 *   5. Runs axe and logs (but does NOT hard-fail on) critical/serious violations
 *      so regressions surface in CI output without blocking.
 *   6. Asserts trackPageErrors is empty (no uncaught JS exceptions).
 *
 * Pages: /login, /forgot-password, /reset-password, /unauthorized,
 *        /change-password, /onboarding/consultant, /onboarding/recruiter.
 *
 * All API calls are intercepted; no real backend needed.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, mockApi, MANAGER, CONSULTANT, RECRUITER, trackPageErrors } from './_helpers';
import type { MockProfile } from './_helpers';

// ─── Device emulation — iPhone 12 form factor ────────────────────────────────

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MANAGER_FORCE_CHANGE: MockProfile = {
  ...MANAGER,
  must_change_password: true,
};

const CONSULTANT_NO_PROFILE: MockProfile = {
  ...CONSULTANT,
  consultant_id: null,
};

const RECRUITER_NO_PROFILE: MockProfile = {
  ...RECRUITER,
  recruiter_id: null,
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function hasHorizontalOverflow(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth);
}

/**
 * Captures a full-page screenshot and runs axe.
 * Logs critical/serious violations to console but does NOT throw — this keeps
 * the spec green for layout/screenshot coverage while still surfacing a11y debt.
 */
async function screenshotAndAudit(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.screenshot({ path: `e2e-results/mobile-auth-${name}.png`, fullPage: true });
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
      .join('\n');
    console.error(`Mobile a11y violations on mobile-auth-${name}:\n${summary}`);
  }
}

// ─── /login ──────────────────────────────────────────────────────────────────

test.describe('Mobile — /login', () => {
  test('renders sign-in form, no overflow, screenshot + axe', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, { profile: null });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'login');
    expect(errors).toHaveLength(0);
  });
});

// ─── /forgot-password ────────────────────────────────────────────────────────

test.describe('Mobile — /forgot-password', () => {
  test('renders email field and submit button, no overflow, screenshot + axe', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, { profile: null });
    await page.goto('/forgot-password');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
    await expect(page.getByRole('link', { name: /back to sign in/i })).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'forgot');
    expect(errors).toHaveLength(0);
  });
});

// ─── /reset-password ─────────────────────────────────────────────────────────

test.describe('Mobile — /reset-password', () => {
  test('with token renders new-password form, no overflow, screenshot + axe', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, { profile: null });
    await page.goto('/reset-password?token=test');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible({
      timeout: 8000,
    });
    await expect(
      page.getByRole('textbox', { name: 'New password Show password', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Confirm new password Show password', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set new password' })).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'reset');
    expect(errors).toHaveLength(0);
  });
});

// ─── /unauthorized ───────────────────────────────────────────────────────────

test.describe('Mobile — /unauthorized', () => {
  test('renders access-denied page, no overflow, screenshot + axe', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, { profile: MANAGER });
    await page.goto('/unauthorized');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'unauthorized');
    expect(errors).toHaveLength(0);
  });
});

// ─── /change-password ────────────────────────────────────────────────────────

test.describe('Mobile — /change-password', () => {
  test('forced mode renders "Set a new password", no overflow, screenshot + axe', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER_FORCE_CHANGE);
    await mockApi(page, { profile: MANAGER_FORCE_CHANGE });
    await page.goto('/change-password');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByLabel('Temporary password')).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'New password Show password', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Confirm new password Show password', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out instead' })).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'change-password');
    expect(errors).toHaveLength(0);
  });
});

// ─── /onboarding/consultant ──────────────────────────────────────────────────

test.describe('Mobile — /onboarding/consultant', () => {
  test('renders onboarding form fields, no overflow, screenshot + axe', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, CONSULTANT_NO_PROFILE);
    await mockApi(page, {
      profile: CONSULTANT_NO_PROFILE,
      handlers: {
        'POST /consultants/onboard': { json: { ok: true } },
      },
    });
    await page.goto('/onboarding/consultant');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: 'Welcome — tell us about your profile' }),
    ).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel('Visa status')).toBeVisible();
    await expect(page.getByLabel('Current location')).toBeVisible();
    await expect(page.getByLabel('Primary skill')).toBeVisible();
    await expect(page.getByLabel('Total experience (years)')).toBeVisible();
    await expect(page.getByLabel('LinkedIn URL')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'onboarding-consultant');
    expect(errors).toHaveLength(0);
  });
});

// ─── /onboarding/recruiter ───────────────────────────────────────────────────

test.describe('Mobile — /onboarding/recruiter', () => {
  test('renders onboarding form fields, no overflow, screenshot + axe', async ({ page }) => {
    const errors = trackPageErrors(page);

    const RECRUITER_PROFILE: MockProfile = {
      ...RECRUITER_NO_PROFILE,
      full_name: 'Riley Recruiter',
      email: 'recruiter@test.local',
    };

    await seedSession(page, RECRUITER_PROFILE);
    await mockApi(page, {
      profile: RECRUITER_PROFILE,
      handlers: {
        'POST /recruiters/onboard': { json: { ok: true } },
      },
    });
    await page.goto('/onboarding/recruiter');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: "Welcome — let's finish your profile" }),
    ).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel('Full name')).toBeVisible();
    await expect(page.getByLabel('Phone')).toBeVisible();
    await expect(page.getByLabel('Team / Pod')).toBeVisible();
    await expect(page.getByLabel('Weekly submission target')).toBeVisible();

    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toBeDisabled();

    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAudit(page, 'onboarding-recruiter');
    expect(errors).toHaveLength(0);
  });
});
