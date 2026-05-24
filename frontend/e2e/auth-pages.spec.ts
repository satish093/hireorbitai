/**
 * Auth + onboarding pages smoke suite.
 *
 * Covers every auth/utility/onboarding page that full-ui-audit.spec.ts does NOT
 * touch:
 *
 *   /login              — email+password form; "Forgot password?" link; submit disabled when empty
 *   /forgot-password    — email field, submit button, anti-enumeration success state
 *   /reset-password     — valid token → form renders; missing token → error state
 *   /unauthorized       — "You don't have access" heading; dashboard link; sign-out button
 *   /change-password    — MANAGER with must_change_password=true; forced mode copy and fields
 *   /onboarding/consultant — CONSULTANT without consultant_id; form fields visible
 *   /onboarding/recruiter  — RECRUITER without recruiter_id; form fields visible
 *
 * All API calls are intercepted; no real backend needed.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, CONSULTANT, RECRUITER, trackPageErrors } from './_helpers';
import type { MockProfile } from './_helpers';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** MANAGER with must_change_password=true so /change-password shows forced mode. */
const MANAGER_FORCE_CHANGE: MockProfile = {
  ...MANAGER,
  must_change_password: true,
};

/** CONSULTANT without consultant_id so onboarding gate is active. */
const CONSULTANT_NO_PROFILE: MockProfile = {
  ...CONSULTANT,
  consultant_id: null,
};

/** RECRUITER without recruiter_id so onboarding gate is active. */
const RECRUITER_NO_PROFILE: MockProfile = {
  ...RECRUITER,
  recruiter_id: null,
};

// ─── /login ──────────────────────────────────────────────────────────────────

test.describe('/login', () => {
  test('renders sign-in form with all expected elements and no console errors', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    // Public page — no session needed; mock API so /auth/me returns 401.
    await mockApi(page, { profile: null });
    await page.goto('/login');
    await page.waitForLoadState('load');

    // Heading
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 8000 });

    // Email and password inputs via label
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    // Submit button
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // Forgot-password link
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-login.png' });
    expect(errors).toHaveLength(0);
  });

  test('successful login redirects to /dashboard', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, {
      profile: MANAGER,
      handlers: {
        'POST /auth/login': {
          json: {
            access_token: 'test-access',
            refresh_token: 'test-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            must_change_password: false,
            user: { id: MANAGER.id, email: MANAGER.email, role: MANAGER.role },
          },
        },
        '/reports/manager-summary': { body: 'null' },
        '/tasks/metrics': { body: 'null' },
        '/activity': { json: [] },
      },
    });
    await page.goto('/login');
    await page.waitForLoadState('load');

    await page.getByLabel('Email').fill('manager@test.local');
    await page.getByLabel('Password').fill('hunter2');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10000 });
    expect(errors).toHaveLength(0);
  });

  test('login failure shows error toast and stays on /login', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, {
      profile: null,
      handlers: {
        'POST /auth/login': {
          status: 401,
          json: { error: 'Invalid email or password' },
        },
      },
    });
    await page.goto('/login');
    await page.waitForLoadState('load');

    await page.getByLabel('Email').fill('wrong@test.local');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Toast with the backend error message
    await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 6000 });
    // Still on /login
    await expect(page).toHaveURL(/\/login/, { timeout: 3000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── /forgot-password ────────────────────────────────────────────────────────

test.describe('/forgot-password', () => {
  test('renders email field and submit button, no console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, { profile: null });
    await page.goto('/forgot-password');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
    await expect(page.getByRole('link', { name: /back to sign in/i })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-forgot-password.png' });
    expect(errors).toHaveLength(0);
  });

  test('submitting shows anti-enumeration success state', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, {
      profile: null,
      handlers: {
        'POST /auth/forgot-password': { json: { ok: true } },
      },
    });
    await page.goto('/forgot-password');
    await page.waitForLoadState('load');

    await page.getByLabel('Email').fill('anyone@test.local');
    await page.getByRole('button', { name: 'Send reset link' }).click();

    // Always shows the success state regardless of whether the email exists
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-forgot-password-sent.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── /reset-password ─────────────────────────────────────────────────────────

test.describe('/reset-password', () => {
  test('with valid token renders new-password form, no console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, { profile: null });
    await page.goto('/reset-password?token=test-token-abc123');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible({
      timeout: 8000,
    });
    // PasswordField wraps input + "Show password" button inside a <label>, so
    // the accessible name becomes "New password Show password" vs "Confirm new
    // password Show password". Use exact:true so the shorter name doesn't
    // substring-match the longer one.
    await expect(
      page.getByRole('textbox', { name: 'New password Show password', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Confirm new password Show password', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set new password' })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-reset-password.png' });
    expect(errors).toHaveLength(0);
  });

  test('without token renders "Invalid reset link" error state', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, { profile: null });
    await page.goto('/reset-password');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'Invalid reset link' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-reset-password-no-token.png' });
    expect(errors).toHaveLength(0);
  });

  test('mismatched passwords shows inline error without calling the API', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, { profile: null });
    await page.goto('/reset-password?token=test-token-abc123');
    await page.waitForLoadState('load');

    await page
      .getByRole('textbox', { name: 'New password Show password', exact: true })
      .fill('MyStrongPass123!');
    await page
      .getByRole('textbox', { name: 'Confirm new password Show password', exact: true })
      .fill('DifferentPass456!');
    await page.getByRole('button', { name: 'Set new password' }).click();

    await expect(page.getByText("Passwords don't match.")).toBeVisible({ timeout: 5000 });
    // Should stay on the reset page
    await expect(page).toHaveURL(/reset-password/, { timeout: 3000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── /unauthorized ───────────────────────────────────────────────────────────

test.describe('/unauthorized', () => {
  test('renders access-denied page with dashboard link and sign-out button, no console errors', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    // Seed a session so profile is available (the component reads it to display
    // the user's role in the description).
    await seedSession(page, MANAGER);
    await mockApi(page, { profile: MANAGER });
    await page.goto('/unauthorized');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible({
      timeout: 8000,
    });

    // Should show the user's role in the descriptive text
    await expect(page.getByText('MANAGER')).toBeVisible();

    // Navigation action
    await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-unauthorized.png' });
    expect(errors).toHaveLength(0);
  });

  test('unauthenticated visit renders fallback copy without crashing', async ({ page }) => {
    const errors = trackPageErrors(page);

    // No session — profile will be null; the component has a fallback branch for this.
    await mockApi(page, { profile: null });
    await page.goto('/unauthorized');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible({
      timeout: 8000,
    });
    // Fallback copy branch
    await expect(page.getByText("This page requires a role you don't have.")).toBeVisible();

    expect(errors).toHaveLength(0);
  });
});

// ─── /change-password ────────────────────────────────────────────────────────

test.describe('/change-password', () => {
  test('forced mode: renders "Set a new password" heading and temporary-password label', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    // must_change_password=true → "Set a new password" forced-mode copy.
    // bypassPasswordChange on the route means ProtectedRoute lets us through.
    await seedSession(page, MANAGER_FORCE_CHANGE);
    await mockApi(page, { profile: MANAGER_FORCE_CHANGE });
    await page.goto('/change-password');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible({
      timeout: 8000,
    });
    // Forced copy — temporary-password label instead of "Current password"
    await expect(page.getByLabel('Temporary password')).toBeVisible();
    // PasswordField embeds a "Show password" toggle inside the label, so the
    // accessible name becomes "New password Show password". Use exact:true so the
    // shorter name doesn't substring-match "Confirm new password Show password".
    await expect(
      page.getByRole('textbox', { name: 'New password Show password', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Confirm new password Show password', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
    // "Sign out instead" button in forced mode
    await expect(page.getByRole('button', { name: 'Sign out instead' })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-change-password-forced.png' });
    expect(errors).toHaveLength(0);
  });

  test('voluntary mode (must_change_password=false): renders "Change your password"', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, { profile: MANAGER });
    await page.goto('/change-password');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible({
      timeout: 8000,
    });
    // Voluntary mode — "Current password" label
    await expect(page.getByLabel('Current password')).toBeVisible();
    // No "Sign out instead" button in voluntary mode
    await expect(page.getByRole('button', { name: 'Sign out instead' })).not.toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-change-password-voluntary.png' });
    expect(errors).toHaveLength(0);
  });

  test('mismatched new passwords shows inline error without submitting', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, { profile: MANAGER });
    await page.goto('/change-password');
    await page.waitForLoadState('load');

    await page.getByLabel('Current password').fill('OldPass123!');
    await page
      .getByRole('textbox', { name: 'New password Show password', exact: true })
      .fill('NewPass123456!');
    await page
      .getByRole('textbox', { name: 'Confirm new password Show password', exact: true })
      .fill('MismatchedPass!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText("New passwords don't match.")).toBeVisible({ timeout: 5000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── /onboarding/consultant ──────────────────────────────────────────────────

test.describe('/onboarding/consultant', () => {
  test('renders onboarding form with key fields and no console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    // CONSULTANT without consultant_id — ProtectedRoute (bypassOnboarding) lets through.
    await seedSession(page, CONSULTANT_NO_PROFILE);
    await mockApi(page, {
      profile: CONSULTANT_NO_PROFILE,
      handlers: {
        'POST /consultants/onboard': { json: { ok: true } },
      },
    });
    await page.goto('/onboarding/consultant');
    await page.waitForLoadState('load');

    // Page heading
    await expect(
      page.getByRole('heading', { name: 'Welcome — tell us about your profile' }),
    ).toBeVisible({ timeout: 8000 });

    // Form fields
    await expect(page.getByLabel('Visa status')).toBeVisible();
    await expect(page.getByLabel('Current location')).toBeVisible();
    await expect(page.getByLabel('Primary skill')).toBeVisible();
    await expect(page.getByLabel('Total experience (years)')).toBeVisible();
    await expect(page.getByLabel('LinkedIn URL')).toBeVisible();

    // Submit button
    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-onboarding-consultant.png' });
    expect(errors).toHaveLength(0);
  });

  test('desired positions chip buttons are interactive', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, CONSULTANT_NO_PROFILE);
    await mockApi(page, { profile: CONSULTANT_NO_PROFILE });
    await page.goto('/onboarding/consultant');
    await page.waitForLoadState('load');

    // Full-Time starts selected (primary variant) — the chip renders "✓ Full-Time".
    // Use getByText to target chip buttons since the accessible name includes the
    // checkmark character and varies depending on selected state.
    const desiredSection = page.locator('text=Desired positions').locator('..');
    await desiredSection.waitFor({ timeout: 8000 });

    // The "Full-Time" chip is present (selected by default)
    await expect(page.getByRole('button', { name: /full.time/i })).toBeVisible({ timeout: 8000 });

    // Click "W2" chip to select it (currently unselected → text is just "W2")
    const w2Btn = page.getByRole('button', { name: /\bw2\b/i });
    await w2Btn.waitFor({ timeout: 8000 });
    await w2Btn.click();
    // After click, the button re-renders with checkmark prefix "✓ W2" — it's still visible
    await expect(page.getByRole('button', { name: /\bw2\b/i })).toBeVisible();

    expect(errors).toHaveLength(0);
  });
});

// ─── /onboarding/recruiter ───────────────────────────────────────────────────

test.describe('/onboarding/recruiter', () => {
  test('renders onboarding form with key fields and no console errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    const RECRUITER_PROFILE: MockProfile = {
      ...RECRUITER_NO_PROFILE,
      // RecruiterOnboarding reads profile.email and profile.full_name for defaults
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
    await page.waitForLoadState('load');

    // Page heading
    await expect(
      page.getByRole('heading', { name: "Welcome — let's finish your profile" }),
    ).toBeVisible({ timeout: 8000 });

    // Form fields
    await expect(page.getByLabel('Full name')).toBeVisible();
    await expect(page.getByLabel('Phone')).toBeVisible();
    await expect(page.getByLabel('Team / Pod')).toBeVisible();
    await expect(page.getByLabel('Weekly submission target')).toBeVisible();

    // The email field is disabled (set at invite time)
    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toBeDisabled();

    // Submit button
    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible();

    await page.screenshot({ path: 'e2e-results/auth-onboarding-recruiter.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Route guard: unauthenticated → /login ───────────────────────────────────

test.describe('Route guard — unauthenticated redirect', () => {
  test('accessing /dashboard without a session redirects to /login', async ({ page }) => {
    const errors = trackPageErrors(page);

    // No seedSession call — no token in localStorage.
    await mockApi(page, { profile: null });
    await page.goto('/dashboard');
    await page.waitForLoadState('load');

    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
    expect(errors).toHaveLength(0);
  });

  test('accessing /change-password without a session redirects to /login', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, { profile: null });
    await page.goto('/change-password');
    await page.waitForLoadState('load');

    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── Route guard: must_change_password → /change-password ────────────────────

test.describe('Route guard — forced password change', () => {
  test('session with must_change_password=true redirects /dashboard to /change-password', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER_FORCE_CHANGE);
    await mockApi(page, { profile: MANAGER_FORCE_CHANGE });
    await page.goto('/dashboard');
    await page.waitForLoadState('load');

    await expect(page).toHaveURL(/\/change-password/, { timeout: 8000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── Route guard: RBAC → /unauthorized ───────────────────────────────────────

test.describe('Route guard — RBAC', () => {
  test('CONSULTANT accessing /consultants (OPERATOR_TIER route) redirects to /unauthorized', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, CONSULTANT);
    await mockApi(page, { profile: CONSULTANT });
    await page.goto('/consultants');
    await page.waitForLoadState('load');

    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 8000 });
    expect(errors).toHaveLength(0);
  });
});
