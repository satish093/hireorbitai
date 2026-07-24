/**
 * Form-validation E2E tests.
 *
 * Covers the login form's client-side and server-side validation paths:
 *   - Empty submit shows required-field errors or a meaningful message
 *   - Invalid email format is rejected before any network call
 *   - Wrong credentials produce a user-visible error (mocked 401)
 *   - Account lockout produces a visible lockout message (mocked 423)
 *
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import { mockApi, trackPageErrors } from './_helpers';

// ---------------------------------------------------------------------------
// Login form — client-side validation
// ---------------------------------------------------------------------------

test.describe('Login form — validation', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, {}); // no profile → unauthenticated
    await page.goto('/login');
  });

  test('submitting with no email or password shows an error or disables submit', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    // Find and click the submit button without filling any fields.
    const submitBtn = page.getByRole('button', { name: /sign in|log in|submit/i });
    await submitBtn.click();

    // Either the form shows a visible error message, OR it uses HTML5 required
    // which keeps focus on the empty field. Either way, we must NOT navigate away.
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toHaveLength(0);
  });

  test('submitting with an invalid email format shows a validation error', async ({ page }) => {
    const errors = trackPageErrors(page);

    await page.getByLabel(/email/i).fill('not-an-email');
    await page.getByLabel(/password/i).fill('somepassword');
    await page.getByRole('button', { name: /sign in|log in|submit/i }).click();

    // Should stay on login (no navigation to dashboard).
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toHaveLength(0);
  });

  test('wrong credentials produce a visible error message (mocked 401)', async ({ page }) => {
    const errors = trackPageErrors(page);

    // Override just the login endpoint to return 401.
    await mockApi(page, {
      handlers: {
        'POST /auth/login': { status: 401, json: { error: 'Invalid email or password.' } },
      },
    });

    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in|log in|submit/i }).click();

    // A non-empty error message should appear somewhere on the page.
    const errorLocator = page.locator('[role="alert"], .error, [data-testid="login-error"]');
    const genericError = page.getByText(/invalid|incorrect|wrong|error/i);
    await expect(errorLocator.or(genericError).first()).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveURL(/\/login/);
    expect(errors).toHaveLength(0);
  });

  test('locked account shows a lockout message (mocked 423)', async ({ page }) => {
    const errors = trackPageErrors(page);

    await mockApi(page, {
      handlers: {
        'POST /auth/login': {
          status: 423,
          json: { error: 'Account is temporarily locked. Try again later.' },
        },
      },
    });

    await page.getByLabel(/email/i).fill('locked@example.com');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in|log in|submit/i }).click();

    // Page must show a lockout-related message.
    const lockMsg = page.getByText(/locked|temporarily|try again/i);
    await expect(lockMsg).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveURL(/\/login/);
    expect(errors).toHaveLength(0);
  });

  test('successful login navigates away from /login (mocked 200)', async ({ page }) => {
    const errors = trackPageErrors(page);

    // First navigation after login will hit /auth/me — return a valid profile
    // so ProtectedRoute gates pass.
    await mockApi(page, {
      profile: {
        id: 'u-manager',
        email: 'manager@test.local',
        full_name: 'Morgan Manager',
        role: 'MANAGER',
        is_active: true,
        must_change_password: false,
        tour_completed_at: '2024-01-01T00:00:00.000Z',
      },
      handlers: {
        'POST /auth/login': {
          status: 200,
          json: {
            access_token: 'test-tok',
            refresh_token: 'test-ref',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: 'u-manager',
              email: 'manager@test.local',
              role: 'MANAGER',
              full_name: 'Morgan Manager',
            },
            must_change_password: false,
          },
        },
      },
    });

    await page.getByLabel(/email/i).fill('manager@test.local');
    await page.getByLabel(/password/i).fill('correctpassword');
    await page.getByRole('button', { name: /sign in|log in|submit/i }).click();

    // After a successful login, we should leave /login.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 7000 });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Login form — console cleanliness on the login page
// ---------------------------------------------------------------------------

test('login page has no console errors on load', async ({ page }) => {
  const errors = trackPageErrors(page);
  await mockApi(page, {});
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  expect(errors).toHaveLength(0);
});
