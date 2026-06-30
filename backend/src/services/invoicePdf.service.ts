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
  amount_paid?: number | string | null;
  amount_due?: number | string | null;
  archived_at?: string | Date | null;
  last_emailed_at?: string | Date | null;
  last_overdue_alert_at?: string | Date | null;
  line_items?: InvoiceLineItem[];
  status_history?: InvoiceStatusHistory[];
  payments?: InvoicePayment[];
  permitted_actions?: Record<string, boolean>;
}

export interface InvoicePayment {
  id: string;
  invoice_id?: string;
  amount: number | string;
  paid_on: string | Date;
  method: string;
  reference?: string | null;
  note?: string | null;
  recorded_by?: string | null;
  created_at?: string | Date | null;
}

export interface InvoiceBrand {
  name?: string | null;
  email?: string | null;
  color?: string | null;
  logo?: Buffer | null;
  logoUrl?: string | null;
  /** Logo is predominantly near-white → render it on a dark panel so a
   *  white-on-transparent wordmark doesn't vanish on the white header. */
  logoIsLight?: boolean;
}

type Doc = InstanceType<typeof PDFDocument>;

// The supplied reference invoice is US Letter (612 × 792), not A4.
const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 22;
const RIGHT = PAGE_W - 22;
const WIDTH = RIGHT - LEFT;
const BLUE = '#0b84bd';
const INK = '#111111';
const MUTED = '#7c8790';
const LINE = '#d9dde0';
const LIGHT = '#f1f1f1';
const HEX = /^#[0-9a-f]{6}$/i;

const COL = {
  item: { x: 22, width: 270 },
  quantity: { x: 292, width: 95 },
  price: { x: 387, width: 95 },
  amount: { x: 482, width: 108 },
};

function money(value: unknown, currency = 'USD'): string {
  const amount = Number(value ?? 0);
  try {
    return amount.toLocaleString('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function decimal(value: unknown): string {
  return Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function date(value?: string | Date | null, long = false): string {
  if (!value) return '—';
  const parsed =
    value instanceof Date
      ? value
      : new Date(String(value).includes('T') ? String(value) : `${String(value)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-US', {
    month: long ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function servicePeriod(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return value || '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const monthName = first.toLocaleDateString('en-US', { month: 'long' });
  return `${monthName} 1 - ${monthName} ${last.getDate()}, ${year}`;
}

function partyLines(party?: InvoicePartySnapshot | null): string[] {
  if (!party) return [];
  return [
    ...(party.address?.split(/\r?\n/).map((line) => line.trim()) ?? []),
    party.country,
    party.phone,
    party.website,
  ].filter((value): value is string => !!value);
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

export function invoiceFileBase(invoice: InvoiceRow): string {
  const raw = invoice.invoice_number?.trim() || invoice.id;
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `invoice-${safe || invoice.id}`;
}

function drawLogo(doc: Doc, issuer: InvoicePartySnapshot, brand: InvoiceBrand | undefined) {
  if (brand?.logo) {
    try {
      // Compute the fitted draw size from the logo's natural dimensions so a
      // light-logo backdrop can be sized to hug it.
      const maxW = 200;
      const maxH = 72;
      const top = 25;
      // openImage exists at runtime but isn't in @types/pdfkit.
      const img = (
        doc as unknown as { openImage(src: Buffer): { width: number; height: number } }
      ).openImage(brand.logo);
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      // A near-white logo (e.g. a white wordmark on transparency) is invisible
      // on the white header — drop it onto a dark rounded panel so it reads.
      if (brand.logoIsLight) {
        const padX = 12;
        const padY = 9;
        doc.roundedRect(LEFT - padX, top - padY, dw + padX * 2, dh + padY * 2, 6).fill('#0f172a');
      }
      doc.image(brand.logo, LEFT, top, { width: dw, height: dh });
      return;
    } catch {
      // Corrupt or unsupported logos use the branded fallback below.
    }
  }
  const color = brand?.color && HEX.test(brand.color) ? brand.color : BLUE;
  doc.roundedRect(LEFT, 28, 62, 62, 3).fill(color);
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor('#ffffff')
    .text(initials(issuer.name), LEFT, 48, { width: 62, align: 'center' });
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor(INK)
    .text(issuer.name, LEFT + 76, 46, {
      width: 210,
    });
}

function drawFirstPageHeader(
  doc: Doc,
  invoice: InvoiceRow,
  brand: InvoiceBrand | undefined,
): number {
  const issuer = invoice.issuer_snapshot ?? {
    name: brand?.name || 'HireOrbit AI',
    email: brand?.email,
  };
  drawLogo(doc, issuer, brand);

  doc
    .font('Helvetica')
    .fontSize(30)
    .fillColor(INK)
    .text('INVOICE', 350, 27, { width: 240, align: 'right' });

  const issuerDetails = partyLines(issuer);
  doc.font('Helvetica-Bold').fontSize(10).text(issuer.name, 350, 75, {
    width: 240,
    align: 'right',
  });
  if (issuerDetails.length) {
    doc.font('Helvetica').fontSize(9).text(issuerDetails.join('\n'), 350, 90, {
      width: 240,
      align: 'right',
      lineGap: 1,
    });
  }

  const issuerBottom =
    90 +
    doc.heightOfString(issuerDetails.join('\n') || ' ', {
      width: 240,
      lineGap: 1,
    });
  const dividerY = Math.max(170, issuerBottom + 14);
  doc.moveTo(0, dividerY).lineTo(PAGE_W, dividerY).lineWidth(0.8).strokeColor(LINE).stroke();

  const infoY = dividerY + 13;
  const bill = invoice.bill_to_snapshot;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('BILL TO', LEFT, infoY);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(INK)
    .text(bill?.name || invoice.vendor_name || '—', LEFT, infoY + 14, { width: 260 });
  const billDetails = [
    ...(bill?.address?.split(/\r?\n/).map((line) => line.trim()) ?? []),
    bill?.country,
  ].filter((value): value is string => !!value);
  if (billDetails.length) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(billDetails.join('\n'), LEFT, infoY + 29, { width: 260, lineGap: 1 });
  }
  if (bill?.email || invoice.bill_to_email) {
    const addressHeight = doc.heightOfString(billDetails.join('\n') || ' ', {
      width: 260,
      lineGap: 1,
    });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(bill?.email || invoice.bill_to_email || '', LEFT, infoY + 38 + addressHeight, {
        width: 260,
      });
  }

  const metaLabelX = 365;
  const metaValueX = 485;
  const metaRows = [
    ['Invoice Number:', invoice.invoice_number || '—'],
    ['Invoice Date:', date(invoice.invoice_date, true)],
    ['Payment Due:', date(invoice.due_date, true)],
  ];
  let metaY = infoY;
  for (const [label, value] of metaRows) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(INK)
      .text(label, metaLabelX, metaY, { width: 112, align: 'right' });
    doc.font('Helvetica').text(value, metaValueX, metaY, { width: 105, align: 'left' });
    metaY += 18;
  }
  doc.rect(350, metaY - 3, 240, 21).fill(LIGHT);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(INK)
    .text(`Amount Due (${invoice.currency || 'USD'}):`, 360, metaY + 3, {
      width: 118,
      align: 'right',
    });
  doc.text(
    money(invoice.total_amount ?? invoice.invoice_amount, invoice.currency || 'USD'),
    486,
    metaY + 3,
    {
      width: 94,
      align: 'left',
    },
  );

  const billHeight = doc.heightOfString(billDetails.join('\n') || ' ', { width: 260, lineGap: 1 });
  return Math.max(metaY + 32, infoY + 50 + billHeight);
}

function drawContinuationHeader(doc: Doc, invoice: InvoiceRow) {
  doc
    .font('Helvetica')
    .fontSize(22)
    .fillColor(INK)
    .text('INVOICE', LEFT, 24, { width: WIDTH, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`# ${invoice.invoice_number || '—'} · continued`, LEFT, 55, {
      width: WIDTH,
      align: 'right',
    });
  doc.moveTo(LEFT, 76).lineTo(RIGHT, 76).strokeColor(LINE).stroke();
}

function drawTableHeader(doc: Doc, y: number, color: string): number {
  doc.rect(0, y, PAGE_W, 27).fill(color);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
  doc.text('Items', COL.item.x, y + 9, { width: COL.item.width });
  doc.text('Quantity', COL.quantity.x, y + 9, { width: COL.quantity.width, align: 'center' });
  doc.text('Price', COL.price.x, y + 9, { width: COL.price.width, align: 'right' });
  doc.text('Amount', COL.amount.x, y + 9, { width: COL.amount.width, align: 'right' });
  return y + 27;
}

function drawFooter(doc: Doc, issuerName: string, page: number) {
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#123c8a')
    .text('Powered by HireOrbit AI', LEFT, PAGE_H - 45, {
      width: WIDTH,
      align: 'center',
    });
  if (page > 1) {
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(MUTED)
      .text(`${issuerName} · Page ${page}`, RIGHT - 150, PAGE_H - 22, {
        width: 150,
        align: 'right',
      });
  }
}

export function renderInvoicePdf(invoice: InvoiceRow, brand?: InvoiceBrand): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: true, compress: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const color = brand?.color && HEX.test(brand.color) ? brand.color : BLUE;
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
    let y = drawFirstPageHeader(doc, invoice, brand);
    y = drawTableHeader(doc, y, color);

    const nextPage = () => {
      drawFooter(doc, issuerName, page);
      doc.addPage({ size: 'LETTER', margin: 0 });
      page += 1;
      drawContinuationHeader(doc, invoice);
      y = drawTableHeader(doc, 92, color);
    };

    for (const item of items) {
      doc.font('Helvetica-Bold').fontSize(9);
      const descriptionHeight = doc.heightOfString(item.description, { width: 248 });
      const periodText = servicePeriod(item.service_period);
      doc.font('Helvetica').fontSize(9);
      const periodHeight = periodText ? doc.heightOfString(periodText, { width: 248 }) : 0;
      const rowHeight = Math.max(39, descriptionHeight + periodHeight + 16);
      if (y + rowHeight > PAGE_H - 105) nextPage();

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(INK)
        .text(item.description, COL.item.x, y + 10, { width: 248 });
      if (periodText) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text(periodText, COL.item.x, y + 12 + descriptionHeight, { width: 248 });
      }
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(decimal(item.quantity), COL.quantity.x, y + 10, {
          width: COL.quantity.width,
          align: 'center',
        });
      doc.text(money(item.unit_rate, currency), COL.price.x, y + 10, {
        width: COL.price.width,
        align: 'right',
      });
      doc.text(money(item.amount, currency), COL.amount.x, y + 10, {
        width: COL.amount.width,
        align: 'right',
      });
      y += rowHeight;
      doc.moveTo(0, y).lineTo(PAGE_W, y).lineWidth(1.5).strokeColor(LINE).stroke();
    }

    const hasDiscount = Number(invoice.discount_amount ?? 0) > 0;
    const hasTax = Number(invoice.tax_amount ?? 0) > 0 || Number(invoice.tax_percent ?? 0) > 0;
    // Partial payments: show a "Paid" line and bill the remaining balance, not
    // the full total, so a Partially Paid invoice's PDF doesn't ask for the
    // whole amount again.
    const amountPaid = Number(invoice.amount_paid ?? 0);
    const hasPaid = amountPaid > 0;
    const invoiceTotal = Number(invoice.total_amount ?? invoice.invoice_amount ?? 0);
    const balanceDue = Math.round((invoiceTotal - amountPaid) * 100) / 100;
    const summaryHeight =
      80 +
      (hasDiscount ? 18 : 0) +
      (hasTax ? 18 : 0) +
      (hasPaid ? 18 : 0) +
      (invoice.notes ? 45 : 0);
    if (y + summaryHeight > PAGE_H - 80) nextPage();
    y += 18;

    const totalsLabelX = 405;
    const totalsValueX = 505;
    const totalsWidth = 85;
    const summaryRows: Array<[string, unknown]> = [
      ['Total:', invoice.subtotal ?? invoice.invoice_amount ?? 0],
    ];
    if (hasDiscount) summaryRows.push(['Discount:', -Number(invoice.discount_amount)]);
    if (hasTax)
      summaryRows.push([`Tax (${decimal(invoice.tax_percent)}%):`, invoice.tax_amount ?? 0]);
    if (hasPaid) summaryRows.push(['Paid:', -amountPaid]);

    for (const [label, value] of summaryRows) {
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(INK)
        .text(label, totalsLabelX, y, { width: 92, align: 'right' });
      doc
        .font('Helvetica')
        .text(money(value, currency), totalsValueX, y, { width: totalsWidth, align: 'right' });
      y += 18;
    }
    doc.moveTo(405, y).lineTo(590, y).lineWidth(1.5).strokeColor(LINE).stroke();
    y += 15;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`Amount Due (${currency}):`, 380, y, { width: 117, align: 'right' });
    doc.text(money(balanceDue, currency), totalsValueX, y, {
      width: totalsWidth,
      align: 'right',
    });

    let noteY = y + 35;
    if (invoice.notes) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('NOTES', LEFT, noteY);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(INK)
        .text(invoice.notes, LEFT, noteY + 12, { width: 330 });
      noteY = doc.y + 12;
    }
    if (invoice.net_terms_days != null || invoice.due_date) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('PAYMENT TERMS', LEFT, noteY);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(INK)
        .text(
          invoice.net_terms_days != null
            ? `Payment is due within ${invoice.net_terms_days} days${invoice.due_date ? `, by ${date(invoice.due_date, true)}` : ''}.`
            : `Payment is due by ${date(invoice.due_date, true)}.`,
          LEFT,
          noteY + 12,
          { width: 330 },
        );
    }

    drawFooter(doc, issuerName, page);
    doc.end();
  });
}
