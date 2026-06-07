/**
 * Invoice document generation + email-toggle coverage.
 *
 *   - create: bill_to_email is allowlisted (and normalized ''→null); the
 *     `.strict()` schema still rejects server-controlled keys.
 *   - GET /invoices/:id/document streams a real PDF (%PDF- magic bytes) with the
 *     right Content-Type + attachment filename.
 *   - POST /invoices/:id/send: 400 when no recipient resolvable; success path
 *     renders the PDF, calls Brevo with the attachment, stamps last_emailed_at,
 *     and audits 'invoice_emailed'.
 *
 * DB mocked at module load (vi.hoisted + vi.mock) per the canonical pattern in
 * applications.create.test.ts. Brevo + audit are mocked; invoicePdf runs for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  invoiceRow: null as Record<string, unknown> | null,
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
}));

vi.mock('../config/db', () => {
  function builder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      insert(payload: Record<string, unknown>) {
        mock.inserted = payload;
        return b;
      },
      update(payload: Record<string, unknown>) {
        mock.updated = payload;
        return b;
      },
      delete: () => b,
      single: () => Promise.resolve({ data: mock.invoiceRow ?? { id: 'inv-1' }, error: null }),
      maybeSingle: () => Promise.resolve({ data: mock.invoiceRow, error: null }),
      // `update(...).eq(...)` is awaited directly in send() → resolve cleanly.
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: () => builder() }, pool: {} };
});

vi.mock('../services/brevo.service', () => ({
  sendInvoiceEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { create, document, send } from './invoices.controller';
import { renderInvoicePdf } from '../services/invoicePdf.service';
import { sendInvoiceEmail } from '../services/brevo.service';
import { audit } from '../services/audit.service';

const USER = { id: 'u-mgr', role: 'MANAGER', email: 'm@x.test' };

function mkRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined,
    sent: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
    send(b: unknown) {
      this.sent = b;
      return this;
    },
  };
  return res;
}

async function callCreate(body: unknown): Promise<{ status?: number } | null> {
  try {
    await (create as any)({ body, user: USER }, mkRes(), vi.fn());
    return null;
  } catch (e) {
    return e as { status?: number };
  }
}

beforeEach(() => {
  mock.invoiceRow = null;
  mock.inserted = null;
  mock.updated = null;
  vi.clearAllMocks();
});

describe('invoices.create — bill_to_email allowlist', () => {
  it('accepts bill_to_email and normalizes an empty string to null', async () => {
    const err = await callCreate({
      consultant_name: 'Jane',
      vendor_name: 'Acme',
      bill_to_email: '',
    });
    expect(err).toBeNull();
    expect(mock.inserted).toMatchObject({ consultant_name: 'Jane', vendor_name: 'Acme' });
    expect(mock.inserted?.bill_to_email).toBeNull();
  });

  it('stores a valid bill_to_email', async () => {
    const err = await callCreate({
      consultant_name: 'Jane',
      vendor_name: 'Acme',
      bill_to_email: 'vendor@acme.test',
    });
    expect(err).toBeNull();
    expect(mock.inserted?.bill_to_email).toBe('vendor@acme.test');
  });

  it('rejects an invalid bill_to_email', async () => {
    const err = await callCreate({
      consultant_name: 'Jane',
      vendor_name: 'Acme',
      bill_to_email: 'not-an-email',
    });
    expect(err?.status).toBe(400);
    expect(mock.inserted).toBeNull();
  });

  it('rejects the server-controlled last_emailed_at (strict schema)', async () => {
    const err = await callCreate({
      consultant_name: 'Jane',
      vendor_name: 'Acme',
      last_emailed_at: '2030-01-01T00:00:00Z',
    });
    expect(err?.status).toBe(400);
    expect(mock.inserted).toBeNull();
  });
});

describe('renderInvoicePdf — company branding', () => {
  it('renders a valid PDF with a company brand name and no logo (placeholder mark)', async () => {
    const buf = await renderInvoicePdf(
      { id: 'x', invoice_number: 'ZT-1', vendor_name: 'Acme', invoice_amount: 500 },
      { name: 'Zangle Technologies', email: 'billing@zangletech.com', logo: null },
    );
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(800);
  });
});

describe('invoices.document — PDF download', () => {
  it('streams a PDF with attachment headers', async () => {
    mock.invoiceRow = {
      id: 'inv-1',
      invoice_number: 'INV-9',
      consultant_name: 'Jane',
      vendor_name: 'Acme',
      invoice_amount: 1040,
      status: 'Submitted',
    };
    const res = mkRes();
    await (document as any)({ params: { id: 'inv-1' }, user: USER }, res, vi.fn());
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toContain('invoice-INV-9.pdf');
    const buf = res.sent as Buffer;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('404s when the invoice is missing', async () => {
    mock.invoiceRow = null;
    let err: { status?: number } | null = null;
    try {
      await (document as any)({ params: { id: 'nope' }, user: USER }, mkRes(), vi.fn());
    } catch (e) {
      err = e as { status?: number };
    }
    expect(err?.status).toBe(404);
  });
});

describe('invoices.send — email toggle', () => {
  it('400s when no recipient is resolvable', async () => {
    mock.invoiceRow = { id: 'inv-1', vendor_name: 'Acme' }; // no bill_to_email
    let err: { status?: number } | null = null;
    try {
      await (send as any)({ params: { id: 'inv-1' }, body: {}, user: USER }, mkRes(), vi.fn());
    } catch (e) {
      err = e as { status?: number };
    }
    expect(err?.status).toBe(400);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('emails the PDF, stamps last_emailed_at, and audits', async () => {
    mock.invoiceRow = {
      id: 'inv-1',
      invoice_number: 'INV-9',
      vendor_name: 'Acme',
      bill_to_email: 'vendor@acme.test',
      invoice_amount: 1040,
    };
    const res = mkRes();
    await (send as any)({ params: { id: 'inv-1' }, body: {}, user: USER }, res, vi.fn());

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    const arg = (sendInvoiceEmail as any).mock.calls[0][0];
    expect(arg.to.email).toBe('vendor@acme.test');
    expect(Buffer.isBuffer(arg.pdf)).toBe(true);
    expect(arg.fileName).toBe('invoice-INV-9.pdf');

    expect(mock.updated).toHaveProperty('last_emailed_at');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'invoice_emailed' }));
    expect(res.body).toMatchObject({ ok: true, emailed_to: 'vendor@acme.test' });
  });

  it('honors an explicit recipient_email override', async () => {
    mock.invoiceRow = { id: 'inv-1', vendor_name: 'Acme', bill_to_email: 'stored@acme.test' };
    const res = mkRes();
    await (send as any)(
      { params: { id: 'inv-1' }, body: { recipient_email: 'override@acme.test' }, user: USER },
      res,
      vi.fn(),
    );
    const arg = (sendInvoiceEmail as any).mock.calls[0][0];
    expect(arg.to.email).toBe('override@acme.test');
    expect(res.body.emailed_to).toBe('override@acme.test');
  });
});
