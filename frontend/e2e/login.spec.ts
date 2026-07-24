import { test, expect } from '@playwright/test';
import { mockApi, MANAGER } from './_helpers';

test.describe('Login flow', () => {
  test('renders the sign-in form with accessible fields', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('empty submit surfaces client-side required validation', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');

    await page.getByRole('button', { name: 'Sign in' }).click();
    // react-hook-form sets the "Required" message on both fields.
    await expect(page.getByText('Required').first()).toBeVisible();
  });

  test('invalid credentials show an error toast and stay on /login', async ({ page }) => {
    await mockApi(page, {
      handlers: {
        'POST /auth/login': { status: 401, json: { error: 'Invalid email or password' } },
      },
    });
    await page.goto('/login');

    await page.getByLabel('Email').fill('nobody@test.local');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('successful login redirects to the dashboard', async ({ page }) => {
    await mockApi(page, {
      profile: MANAGER,
      flags: {},
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
        // Dashboard widgets — keep null-safe so the shell renders cleanly.
        '/reports/manager-summary': { body: 'null' },
        '/tasks/metrics': { body: 'null' },
        '/jobs': { json: [] },
      },
    });
    await page.goto('/login');

    await page.getByLabel('Email').fill(MANAGER.email);
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  });

  test('a temp-password account is routed to /change-password', async ({ page }) => {
    await mockApi(page, {
      profile: { ...MANAGER, must_change_password: true },
      flags: {},
      handlers: {
        'POST /auth/login': {
          json: {
            access_token: 'test-access',
            refresh_token: 'test-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            must_change_password: true,
            user: { id: MANAGER.id, email: MANAGER.email, role: MANAGER.role },
          },
        },
      },
    });
    await page.goto('/login');

    await page.getByLabel('Email').fill(MANAGER.email);
    await page.getByLabel('Password').fill('temp-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/change-password$/);
  });
});
