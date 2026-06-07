import { test, expect } from '@playwright/test';
import { mockApi, seedSession, trackPageErrors, MANAGER } from './_helpers';

/**
 * Smoke coverage for the two new features (mocked backend):
 *
 *   1. Invoices → detail → "Document" section: the email toggle reveals a
 *      recipient field + Send button, and Send POSTs to /invoices/:id/send.
 *   2. /admin/groups: a group with a logo_url renders its company logo image.
 */

// A 1×1 transparent PNG — loads reliably so toBeVisible() passes.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const INVOICE = {
  id: 'inv-1',
  invoice_number: 'INV-9',
  consultant_name: 'Jane Doe',
  vendor_name: 'Acme Corp',
  billing_month: '2026-05',
  pay_rate: 65,
  invoice_amount: 10400,
  invoice_date: '2026-05-01',
  due_date: '2026-05-31',
  net_terms_days: 30,
  status: 'Submitted',
  bill_to_email: 'vendor@acme.test',
  last_emailed_at: null,
  created_at: '2026-05-01T00:00:00.000Z',
};

test.describe('Invoice document + email toggle', () => {
  test('detail shows Document section; toggle reveals Send and posts', async ({ page }) => {
    test.setTimeout(90000); // first lazy chunk compile on a cold Vite server is slow
    const errors = trackPageErrors(page);
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { invoices: true },
      handlers: {
        '/invoices': { json: [INVOICE] },
        'POST /invoices/inv-1/send': {
          json: {
            ok: true,
            emailed_to: 'vendor@acme.test',
            last_emailed_at: '2026-06-07T00:00:00.000Z',
          },
        },
      },
    });

    await page.goto('/invoices');
    // Generous timeout: a cold Vite dev server can take 20s+ to compile this
    // page's chunk on the first navigation (no warmup when run in isolation).
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 60000 });

    // Open the detail modal.
    await page.getByRole('button', { name: 'View' }).first().click();

    // Document section + download button present; email controls hidden until toggled.
    await expect(page.getByText('Document', { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);

    // Flip the toggle — recipient field (prefilled) + Send appear.
    await page.getByRole('switch', { name: 'Email this invoice' }).click();
    const recipient = page.getByLabel('Recipient email');
    await expect(recipient).toBeVisible();
    await expect(recipient).toHaveValue('vendor@acme.test');

    // Send posts to the endpoint.
    const sendReq = page.waitForRequest(
      (r) => r.url().includes('/api/invoices/inv-1/send') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send' }).click();
    await sendReq;
    await expect(page.getByText(/emailed to/i)).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('New-invoice form: "Email on save" creates then sends', async ({ page }) => {
    test.setTimeout(90000);
    const errors = trackPageErrors(page);
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { invoices: true },
      handlers: {
        '/invoices': { json: [] },
        'POST /invoices': {
          json: {
            id: 'inv-new',
            invoice_number: 'NEW-1',
            consultant_name: 'Jane',
            vendor_name: 'Acme',
            bill_to_email: 'pay@acme.test',
          },
        },
        'POST /invoices/inv-new/send': { json: { ok: true, emailed_to: 'pay@acme.test' } },
      },
    });

    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 60000 });

    await page.getByRole('button', { name: '+ New invoice' }).click();
    await page.getByLabel('Consultant name *').fill('Jane');
    await page.getByLabel('Vendor *').fill('Acme');
    await page.getByLabel('Bill-to email').fill('pay@acme.test');
    await page.getByRole('switch', { name: 'Email this invoice on save' }).click();

    const createReq = page.waitForRequest(
      (r) => r.url().endsWith('/api/invoices') && r.method() === 'POST',
    );
    const sendReq = page.waitForRequest(
      (r) => r.url().includes('/api/invoices/inv-new/send') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save invoice' }).click();
    await createReq;
    await sendReq;
    await expect(page.getByText(/emailed to/i)).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });
});

test.describe('Group company logo', () => {
  test('group card renders the uploaded logo image', async ({ page }) => {
    const errors = trackPageErrors(page);
    const CTO = { ...MANAGER, role: 'CTO' as const };
    await seedSession(page, CTO);
    await mockApi(page, {
      profile: CTO,
      flags: { invoices: true },
      handlers: {
        '/user-groups': {
          json: [
            {
              id: 'g1',
              name: 'Cloudfen',
              slug: 'cloudfen',
              color: '#6366F1',
              is_active: true,
              member_count: 0,
              logo_url: PNG_DATA_URL,
            },
          ],
        },
        '/admin/users': { json: { rows: [], total: 0, page: 1, page_size: 200 } },
      },
    });

    await page.goto('/admin/groups');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'User groups' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'Cloudfen' })).toBeVisible({ timeout: 8000 });

    // The company logo <img> is rendered inside the card header.
    await expect(page.locator(`img[src="${PNG_DATA_URL}"]`).first()).toBeVisible({ timeout: 8000 });
    // And a "Remove logo" action appears because the group has a logo.
    await expect(page.getByRole('button', { name: 'Remove logo' })).toBeVisible();

    expect(errors).toHaveLength(0);
  });
});
