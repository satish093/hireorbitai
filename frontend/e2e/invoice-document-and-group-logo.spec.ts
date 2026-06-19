import { test, expect } from '@playwright/test';
import { mockApi, seedSession, trackPageErrors, MANAGER } from './_helpers';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const INVOICE = {
  id: 'inv-1',
  company_group_id: 'g1',
  invoice_number: 'INV-9',
  invoice_date: '2026-05-01',
  due_date: '2026-05-31',
  net_terms_days: 30,
  status: 'Submitted',
  display_status: 'Submitted',
  currency: 'USD',
  subtotal: 10400,
  discount_amount: 0,
  tax_percent: 0,
  tax_amount: 0,
  total_amount: 10400,
  issuer_snapshot: { name: 'CloudFen', email: 'billing@cloudfen.test' },
  bill_to_snapshot: { name: 'Acme Corp', email: 'vendor@acme.test' },
  line_items: [
    {
      description: 'Jane Doe consulting services',
      service_period: '2026-05',
      quantity: 160,
      unit: 'hours',
      unit_rate: 65,
      amount: 10400,
      position: 0,
    },
  ],
  permitted_actions: {
    edit: true,
    approve: true,
    cancel: true,
    email: true,
    download: true,
    archive: true,
  },
  last_emailed_at: null,
  created_at: '2026-05-01T00:00:00.000Z',
};

const EMPTY_LIST = {
  items: [],
  total: 0,
  page: 1,
  page_size: 25,
  summary: { outstanding_by_currency: {}, overdue_count: 0, draft_count: 0 },
};

test.describe('Invoice accounting workflow', () => {
  test('detail shows line items, workflow actions, and sends the PDF', async ({ page }) => {
    test.setTimeout(90000);
    const errors = trackPageErrors(page);
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { invoices: true },
      handlers: {
        '/invoices': {
          json: {
            ...EMPTY_LIST,
            items: [INVOICE],
            total: 1,
            summary: {
              outstanding_by_currency: { USD: 10400 },
              overdue_count: 0,
              draft_count: 0,
            },
          },
        },
        '/invoices/companies': {
          json: [{ id: 'g1', name: 'CloudFen', email: 'billing@cloudfen.test' }],
        },
        '/invoices/inv-1': { json: INVOICE },
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
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 60000 });
    await page.getByRole('cell', { name: 'INV-9', exact: true }).click();

    await expect(page.getByText('Jane Doe consulting services')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
    const recipient = page.getByLabel('Recipient email');
    await expect(recipient).toHaveValue('vendor@acme.test');

    const sendRequest = page.waitForRequest(
      (request) =>
        request.url().includes('/api/invoices/inv-1/send') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send invoice' }).click();
    await sendRequest;
    await expect(page.getByText(/emailed to/i)).toBeVisible({ timeout: 8000 });
    expect(errors).toHaveLength(0);
  });

  test('creating a calculated draft opens its workflow detail', async ({ page }) => {
    test.setTimeout(90000);
    const errors = trackPageErrors(page);
    const draft = {
      ...INVOICE,
      id: 'inv-new',
      invoice_number: 'NEW-1',
      status: 'Draft',
      display_status: 'Draft',
      bill_to_snapshot: { name: 'Acme', email: 'pay@acme.test' },
      permitted_actions: { edit: true, submit: true, download: true, delete: true },
    };
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { invoices: true },
      handlers: {
        '/invoices': { json: EMPTY_LIST },
        '/invoices/companies': {
          json: [{ id: 'g1', name: 'CloudFen', email: 'billing@cloudfen.test' }],
        },
        'POST /invoices': { json: draft },
        '/invoices/inv-new': { json: draft },
      },
    });

    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 60000 });
    await page.getByRole('button', { name: '+ New invoice' }).click();
    await page.getByLabel('Invoice number *').fill('NEW-1');
    await page.getByLabel('Name *').nth(1).fill('Acme');
    await page.getByLabel('Email').nth(1).fill('pay@acme.test');
    await page.getByLabel('Quantity').fill('160');
    await page.getByLabel('Unit rate').fill('65');

    const createRequest = page.waitForRequest(
      (request) => request.url().endsWith('/api/invoices') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create draft' }).click();
    await createRequest;

    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
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
    await expect(page.locator(`img[src="${PNG_DATA_URL}"]`).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'Remove logo' })).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
