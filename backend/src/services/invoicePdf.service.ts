import PDFDocument from 'pdfkit';

export interface InvoicePartySnapshot {
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  tax_id?: string | null;
}

export interface InvoiceLineItem {
  id?: string;
  invoice_id?: string;
  description: string;
  service_period?: string | null;
  quantity: number | string;
  unit: string;
  unit_rate: number | string;
  amount: number | string;
  position: number;
}

export interface InvoiceStatusHistory {
  id: string;
  from_status?: string | null;
  to_status: string;
  changed_by?: string | null;
  changed_at: string | Date;
  note?: string | null;
}

export interface InvoiceRow {
  id: string;
  invoice_number?: string | null;
  consultant_name?: string | null;
  vendor_name?: string | null;
  billing_month?: string | null;
  pay_rate?: number | string | null;
  invoice_amount?: number | string | null;
  invoice_date?: string | Date | null;
  due_date?: string | Date | null;
  net_terms_days?: number | null;
  status?: string | null;
  display_status?: string | null;
  bill_to_email?: string | null;
  notes?: string | null;
  created_at?: string | Date | null;
  company_group_id?: string | null;
  issuer_snapshot?: InvoicePartySnapshot | null;
  bill_to_snapshot?: InvoicePartySnapshot | null;
  currency?: string | null;
  discount_amount?: number | string | null;
  tax_percent?: number | string | null;
  subtotal?: number | string | null;
  tax_amount?: number | string | null;
  total_amount?: number | string | null;
  archived_at?: string | Date | null;
  line_items?: InvoiceLineItem[];
  status_history?: InvoiceStatusHistory[];
  permitted_actions?: Record<string, boolean>;
}

export interface InvoiceBrand {
  name?: string | null;
  email?: string | null;
  color?: string | null;
  logo?: Buffer | null;
  logoUrl?: string | null;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const LEFT = 46;
const RIGHT = PAGE_W - 46;
const WIDTH = RIGHT - LEFT;
const INK = '#0f172a';
const SUB = '#334155';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const HEAD = '#f1f5f9';
const BRAND = '#4f46e5';
const HEX = /^#[0-9a-f]{6}$/i;
type Doc = InstanceType<typeof PDFDocument>;

function money(value: unknown, currency = 'USD'): string {
  const number = Number(value ?? 0);
  try {
    return number.toLocaleString('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${number.toFixed(2)}`;
  }
}

function number(value: unknown): string {
  const n = Number(value ?? 0);
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function date(value?: string | Date | null): string {
  if (!value) return '—';
  const parsed =
    value instanceof Date
      ? value
      : new Date(String(value).includes('T') ? String(value) : `${String(value)}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function period(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return value || '—';
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'CO'
  );
}

function partyLines(party?: InvoicePartySnapshot | null): string[] {
  if (!party) return [];
  return [
    party.name,
    ...(party.address?.split(/\r?\n/).map((line) => line.trim()) ?? []),
    party.country,
    party.email,
    party.phone,
    party.website,
    party.tax_id ? `Tax ID: ${party.tax_id}` : null,
  ].filter((value): value is string => !!value);
}

export function invoiceFileBase(invoice: InvoiceRow): string {
  const raw = invoice.invoice_number?.trim() || invoice.id;
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `invoice-${safe || invoice.id}`;
}

function footer(doc: Doc, issuerName: string, page: number) {
  const y = PAGE_H - 54;
  doc
    .moveTo(LEFT, y - 12)
    .lineTo(RIGHT, y - 12)
    .lineWidth(0.7)
    .strokeColor(LINE)
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(SUB)
    .text('Thank you for your business.', LEFT, y, { width: 220 });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(issuerName, LEFT, y + 13);
  doc.text(`Page ${page}`, RIGHT - 60, y + 6, { width: 60, align: 'right' });
}

function continuationHeader(doc: Doc, invoice: InvoiceRow, color: string) {
  doc.rect(0, 0, PAGE_W, 5).fill(color);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(INK)
    .text(invoice.issuer_snapshot?.name || 'Invoice', LEFT, 34, { width: 300 });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text(`Invoice #${invoice.invoice_number || '—'} · continued`, LEFT, 57);
  doc.moveTo(LEFT, 78).lineTo(RIGHT, 78).strokeColor(LINE).stroke();
}

function tableHeader(doc: Doc, y: number) {
  doc.rect(LEFT, y, WIDTH, 24).fill(HEAD);
  const headers = [
    ['DESCRIPTION', LEFT + 10, 224, undefined],
    ['PERIOD', 280, 70, undefined],
    ['QTY / UNIT', 350, 70, 'right'],
    ['RATE', 420, 72, 'right'],
    ['AMOUNT', 492, 57, 'right'],
  ] as const;
  doc.font('Helvetica-Bold').fontSize(7.2).fillColor(SUB);
  for (const [label, x, width, align] of headers) {
    doc.text(label, x, y + 8, { width, align, characterSpacing: 0.25 });
  }
  return y + 24;
}

function firstPageHeader(
  doc: Doc,
  invoice: InvoiceRow,
  brand: InvoiceBrand | undefined,
  color: string,
) {
  doc.rect(0, 0, PAGE_W, 5).fill(color);
  const issuer = invoice.issuer_snapshot ?? {
    name: brand?.name || 'HireOrbit AI',
    email: brand?.email,
  };
  if (brand?.logo) {
    try {
      doc.image(brand.logo, LEFT, 35, { fit: [120, 52], valign: 'center' });
    } catch {
      // Invalid image bytes fall through to the text mark.
    }
  }
  if (!brand?.logo) {
    doc.roundedRect(LEFT, 38, 42, 42, 8).fill(`${color}1f`);
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(color)
      .text(initials(issuer.name), LEFT, 52, { width: 42, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(color)
      .text(issuer.name, LEFT + 54, 43, {
        width: 250,
      });
    if (issuer.email) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(issuer.email, LEFT + 54, 66);
    }
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(28)
    .fillColor(INK)
    .text('INVOICE', LEFT, 36, { width: WIDTH, align: 'right', characterSpacing: 0.8 });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text(`# ${invoice.invoice_number || '—'}`, LEFT, 73, { width: WIDTH, align: 'right' });
  const status = (invoice.display_status || invoice.status || 'Draft').toUpperCase();
  doc.roundedRect(RIGHT - 88, 92, 88, 18, 9).fill(status === 'OVERDUE' ? '#fee2e2' : '#dbeafe');
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(status === 'OVERDUE' ? '#b91c1c' : '#1d4ed8')
    .text(status, RIGHT - 88, 98, { width: 88, align: 'center', characterSpacing: 0.35 });
  doc.moveTo(LEFT, 126).lineTo(RIGHT, 126).strokeColor(LINE).stroke();

  const meta = [
    ['INVOICE DATE', date(invoice.invoice_date)],
    ['DUE DATE', date(invoice.due_date)],
    ['NET TERMS', invoice.net_terms_days == null ? '—' : `${invoice.net_terms_days} days`],
    ['CURRENCY', invoice.currency || 'USD'],
  ];
  const mw = WIDTH / 4;
  for (let i = 0; i < meta.length; i++) {
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(MUTED)
      .text(meta[i]![0], LEFT + i * mw, 143);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(INK)
      .text(meta[i]![1], LEFT + i * mw, 157);
  }

  const bill = partyLines(invoice.bill_to_snapshot);
  const from = partyLines(issuer);
  const partyY = 197;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text('BILL TO', LEFT, partyY);
  doc.text('FROM', LEFT + WIDTH / 2, partyY, { width: WIDTH / 2, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
  doc.text(bill[0] || invoice.vendor_name || '—', LEFT, partyY + 14, { width: WIDTH / 2 - 14 });
  doc.text(from[0] || '—', LEFT + WIDTH / 2, partyY + 14, {
    width: WIDTH / 2,
    align: 'right',
  });
  const billDetail = bill.slice(1).join('\n');
  const fromDetail = from.slice(1).join('\n');
  doc.font('Helvetica').fontSize(8.2).fillColor(MUTED);
  doc.text(billDetail, LEFT, partyY + 31, {
    width: WIDTH / 2 - 14,
    lineGap: 1,
  });
  doc.text(fromDetail, LEFT + WIDTH / 2, partyY + 31, {
    width: WIDTH / 2,
    align: 'right',
    lineGap: 1,
  });
  const partyHeight = Math.max(
    doc.heightOfString(billDetail || ' ', { width: WIDTH / 2 - 14, lineGap: 1 }),
    doc.heightOfString(fromDetail || ' ', { width: WIDTH / 2, lineGap: 1 }),
    20,
  );
  return Math.max(270, partyY + 34 + partyHeight);
}

export function renderInvoicePdf(invoice: InvoiceRow, brand?: InvoiceBrand): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, compress: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const color = brand?.color && HEX.test(brand.color) ? brand.color : BRAND;
    const issuerName = invoice.issuer_snapshot?.name || brand?.name || 'HireOrbit AI';
    const currency = invoice.currency || 'USD';
    const items = invoice.line_items?.length
      ? invoice.line_items
      : [
          {
            description: invoice.consultant_name || 'Professional consulting services',
            service_period: invoice.billing_month,
            quantity: 1,
            unit: 'service',
            unit_rate: invoice.pay_rate ?? invoice.invoice_amount ?? 0,
            amount: invoice.invoice_amount ?? 0,
            position: 0,
          },
        ];
    let page = 1;
    let y = firstPageHeader(doc, invoice, brand, color);
    if (y > PAGE_H - 150) {
      footer(doc, issuerName, page);
      doc.addPage();
      page += 1;
      continuationHeader(doc, invoice, color);
      y = 96;
    }
    y = tableHeader(doc, y);

    const newPage = () => {
      footer(doc, issuerName, page);
      doc.addPage();
      page += 1;
      continuationHeader(doc, invoice, color);
      y = tableHeader(doc, 96);
    };

    for (const item of items) {
      doc.font('Helvetica-Bold').fontSize(9.5);
      const descriptionHeight = doc.heightOfString(item.description, { width: 210 });
      const rowHeight = Math.max(36, descriptionHeight + 18);
      if (y + rowHeight > PAGE_H - 105) newPage();
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(INK)
        .text(item.description, LEFT + 10, y + 8, {
          width: 210,
        });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(MUTED)
        .text(period(item.service_period), 280, y + 10, { width: 70 });
      doc
        .fillColor(SUB)
        .text(`${number(item.quantity)} ${item.unit}`, 350, y + 10, { width: 70, align: 'right' });
      doc.text(money(item.unit_rate, currency), 420, y + 10, { width: 72, align: 'right' });
      doc
        .font('Helvetica-Bold')
        .fillColor(INK)
        .text(money(item.amount, currency), 492, y + 10, { width: 57, align: 'right' });
      y += rowHeight;
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.6).strokeColor(LINE).stroke();
    }

    const summaryHeight = invoice.notes ? 185 : 145;
    if (y + summaryHeight > PAGE_H - 90) newPage();
    y += 16;
    const sumX = 334;
    const labelW = 100;
    const valueW = 115;
    const summaryRows: Array<[string, unknown, boolean]> = [
      ['Subtotal', invoice.subtotal ?? invoice.invoice_amount ?? 0, false],
    ];
    if (Number(invoice.discount_amount ?? 0) > 0) {
      summaryRows.push(['Discount', -Number(invoice.discount_amount), false]);
    }
    if (Number(invoice.tax_amount ?? 0) > 0 || Number(invoice.tax_percent ?? 0) > 0) {
      summaryRows.push([`Tax (${number(invoice.tax_percent)}%)`, invoice.tax_amount ?? 0, false]);
    }
    summaryRows.push(['Amount due', invoice.total_amount ?? invoice.invoice_amount ?? 0, true]);
    for (const [label, value, strong] of summaryRows) {
      if (strong) doc.roundedRect(sumX - 10, y - 4, RIGHT - sumX + 10, 30, 7).fill(color);
      doc
        .font(strong ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(strong ? 10 : 9)
        .fillColor(strong ? '#ffffff' : SUB)
        .text(label, sumX, y + 5, { width: labelW });
      doc
        .font(strong ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(strong ? 13 : 9)
        .fillColor(strong ? '#ffffff' : INK)
        .text(money(value, currency), sumX + labelW, y + (strong ? 2 : 5), {
          width: valueW,
          align: 'right',
        });
      y += strong ? 38 : 22;
    }

    if (invoice.notes) {
      y += 8;
      doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text('NOTES', LEFT, y);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(SUB)
        .text(invoice.notes, LEFT, y + 13, {
          width: WIDTH,
        });
      y = doc.y + 10;
    }
    if (invoice.net_terms_days != null || invoice.due_date) {
      doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text('PAYMENT TERMS', LEFT, y);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(SUB)
        .text(
          invoice.net_terms_days != null
            ? `Payment is due within ${invoice.net_terms_days} days${invoice.due_date ? `, by ${date(invoice.due_date)}` : ''}.`
            : `Payment is due by ${date(invoice.due_date)}.`,
          LEFT,
          y + 13,
          { width: WIDTH },
        );
    }

    footer(doc, issuerName, page);
    doc.end();
  });
}
