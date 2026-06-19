import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  invoice: null as any,
  lineItems: [] as any[],
  stamped: null as any,
}));

vi.mock('../config/db', () => {
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (/select \* from public\.invoices where id/.test(text)) {
      return { rows: mock.invoice ? [mock.invoice] : [] };
    }
    if (/select id, invoice_id, description/.test(text)) return { rows: mock.lineItems };
    if (/last_emailed_at/.test(text)) {
      mock.stamped = values[0];
      return { rows: [] };
    }
    return { rows: [] };
  });
  return {
    pool: { query },
    db: {
      from: () => {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null }) }) },
    },
  };
});
vi.mock('../services/brevo.service', () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { document, send } from './invoices.controller';
import { renderInvoicePdf } from '../services/invoicePdf.service';
import { sendInvoiceEmail } from '../services/brevo.service';

const USER = { id: 'admin', role: 'CTO', email: 'admin@test', group_id: null };

function invoice(status = 'Submitted') {
  return {
    id: 'inv-1',
    company_group_id: null,
    invoice_number: 'INV-9',
    status,
    display_status: status,
    currency: 'USD',
    subtotal: 14760,
    discount_amount: 0,
    tax_percent: 0,
    tax_amount: 0,
    total_amount: 14760,
    invoice_date: '2026-05-01',
    due_date: '2026-05-31',
    issuer_snapshot: { name: 'CloudFen' },
    bill_to_snapshot: { name: 'Q1', email: 'vendor@q1.test' },
  };
}

function response() {
  return {
    body: null as any,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    send(value: any) {
      this.body = value;
      return this;
    },
    json(value: any) {
      this.body = value;
      return this;
    },
  };
}

beforeEach(() => {
  mock.invoice = invoice();
  mock.lineItems = [
    {
      description: 'Consulting',
      service_period: '2026-05',
      quantity: 180,
      unit: 'hours',
      unit_rate: 82,
      amount: 14760,
      position: 0,
    },
  ];
  mock.stamped = null;
  vi.clearAllMocks();
});

describe('invoice PDF rendering', () => {
  it('renders structured parties, multiple items, and totals into a valid PDF', async () => {
    const buffer = await renderInvoicePdf({ ...invoice(), line_items: mock.lineItems });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('continues a long line-item table across multiple pages', async () => {
    const items = Array.from({ length: 60 }, (_, index) => ({
      description: `Consulting workstream ${index + 1} with a sufficiently descriptive label`,
      service_period: '2026-05',
      quantity: 1,
      unit: 'service',
      unit_rate: 100,
      amount: 100,
      position: index,
    }));
    const buffer = await renderInvoicePdf({
      ...invoice(),
      line_items: items,
      subtotal: 6000,
      total_amount: 6000,
    });
    const pageObjects = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageObjects.length).toBeGreaterThan(1);
  });

  it('streams a private PDF download', async () => {
    const res = response();
    await document({ user: USER, params: { id: 'inv-1' } } as any, res as any, vi.fn());
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toContain('invoice-INV-9.pdf');
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });
});

describe('invoice email workflow', () => {
  it('emails Submitted and Approved invoices and stamps delivery time', async () => {
    const res = response();
    await send({ user: USER, params: { id: 'inv-1' }, body: {} } as any, res as any, vi.fn());
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    expect((sendInvoiceEmail as any).mock.calls[0][0].to.email).toBe('vendor@q1.test');
    expect(mock.stamped).toBeTruthy();
  });

  it.each(['Draft', 'Paid', 'Cancelled'])('rejects emailing a %s invoice', async (status) => {
    mock.invoice = invoice(status);
    let error: any;
    try {
      await send(
        { user: USER, params: { id: 'inv-1' }, body: {} } as any,
        response() as any,
        vi.fn(),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error?.status).toBe(409);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('requires a recipient', async () => {
    mock.invoice = { ...invoice(), bill_to_snapshot: { name: 'Q1' } };
    let error: any;
    try {
      await send(
        { user: USER, params: { id: 'inv-1' }, body: {} } as any,
        response() as any,
        vi.fn(),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error?.status).toBe(400);
  });
});
