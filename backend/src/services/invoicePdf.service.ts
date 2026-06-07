import PDFDocument from 'pdfkit';

// ---------------------------------------------------------------------------
// Invoice PDF renderer.
//
// Produces a single-page A4 invoice document from an invoices row using pdfkit
// (pure JS, no headless browser — see the plan: Playwright is present but
// launching Chromium per invoice is too heavy for the single VPS). Only the 14
// standard PDF fonts (Helvetica*) are used, so there is no font-file dependency.
//
// The same buffer backs both paths: GET /invoices/:id/document streams it for
// download, and POST /invoices/:id/send attaches it to the Brevo email. The PDF
// is generated on demand — never persisted — so it always reflects current data.
//
// Layout (top → bottom): accent bar → letterhead + INVOICE title + status pill →
// meta strip (dates / terms) → Bill-to + From → line-items table → Amount Due
// block → notes / payment terms → footer.
// ---------------------------------------------------------------------------

export interface InvoiceRow {
  id: string;
  invoice_number?: string | null;
  consultant_name?: string | null;
  vendor_name?: string | null;
  billing_month?: string | null;
  pay_rate?: number | string | null;
  invoice_amount?: number | string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  net_terms_days?: number | null;
  status?: string | null;
  bill_to_email?: string | null;
  notes?: string | null;
  created_at?: string | null;
  company_group_id?: string | null;
}

/** Issuing-company branding for the letterhead. Resolved from the invoice's
 *  company_group_id (the user group / company): its name + uploaded logo bytes.
 *  When `logo` is absent a placeholder mark (the company initials) is drawn. */
export interface InvoiceBrand {
  name?: string | null;
  email?: string | null;
  logo?: Buffer | null;
}

// Palette — mirrors the app brand (indigo-600) + slate scale.
const BRAND = '#4f46e5';
const INK = '#0f172a'; // slate-900
const SUB = '#334155'; // slate-700
const MUTED = '#64748b'; // slate-500
const LINE = '#e2e8f0'; // slate-200
const HEADBG = '#f1f5f9'; // slate-100
const SOFT = '#f8fafc'; // slate-50

// Status pill tones — mirror the frontend <Pill> tones on the Invoices page.
const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  Submitted: { bg: '#dbeafe', text: '#1d4ed8' },
  Approved: { bg: '#ede9fe', text: '#6d28d9' },
  Paid: { bg: '#dcfce7', text: '#15803d' },
  Overdue: { bg: '#fee2e2', text: '#b91c1c' },
  Cancelled: { bg: '#e2e8f0', text: '#475569' },
};

// Brand "from" details surfaced on the letterhead.
const COMPANY = {
  name: 'HireOrbit AI',
  tagline: 'Consultant invoicing',
  email: 'support@hireorbitai.com',
  site: 'hireorbitai.com',
};

const PAGE_W = 595.28; // A4
const LEFT = 50;
const RIGHT = 545;
const CW = RIGHT - LEFT; // 495

function fmtMoney(value?: number | string | null): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtMonth(value?: string | null): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** A safe, filesystem-friendly base name for the downloaded file (no extension). */
export function invoiceFileBase(invoice: InvoiceRow): string {
  const raw = invoice.invoice_number?.trim() || invoice.id;
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `invoice-${safe || invoice.id}`;
}

type Doc = InstanceType<typeof PDFDocument>;

/** A small labelled value block (uppercase label over a value). Returns nothing;
 *  positions are absolute. */
function metaCell(doc: Doc, label: string, value: string, x: number, y: number, w: number): void {
  doc
    .fillColor(MUTED)
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text(label.toUpperCase(), x, y, { width: w, characterSpacing: 0.4 });
  doc
    .fillColor(INK)
    .font('Helvetica')
    .fontSize(10.5)
    .text(value, x, y + 12, { width: w });
}

/** Right-aligned status pill. Returns the pill's left x so callers can stack. */
function statusPill(doc: Doc, status: string, rightX: number, y: number): void {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.Submitted;
  const label = (status || 'Submitted').toUpperCase();
  doc.font('Helvetica-Bold').fontSize(8.5);
  const tw = doc.widthOfString(label, { characterSpacing: 0.5 });
  const padX = 10;
  const h = 18;
  const w = tw + padX * 2;
  const x = rightX - w;
  doc.roundedRect(x, y, w, h, 9).fill(tone.bg);
  doc
    .fillColor(tone.text)
    .text(label, x + padX, y + 5, { lineBreak: false, characterSpacing: 0.5 });
}

/** Up-to-two-letter initials from a company name ("Zangle Technologies" → "ZT"). */
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return letters || 'CO';
}

/** The square company mark at the top-left: the uploaded logo (fit into the box)
 *  or, when there's none, an indigo-tinted rounded square with the initials. */
function drawCompanyMark(
  doc: Doc,
  name: string,
  logo: Buffer | null,
  x: number,
  y: number,
  s: number,
): void {
  if (logo) {
    try {
      doc.save();
      doc.roundedRect(x, y, s, s, 8).clip();
      doc.image(logo, x, y, { fit: [s, s], align: 'center', valign: 'center' });
      doc.restore();
      return;
    } catch {
      // Corrupt/unsupported image bytes → fall through to the initials mark.
    }
  }
  doc.roundedRect(x, y, s, s, 8).fill('#eef2ff'); // indigo-50
  doc
    .fillColor(BRAND)
    .font('Helvetica-Bold')
    .fontSize(s * 0.36)
    .text(initialsOf(name), x, y + s / 2 - s * 0.22, { width: s, align: 'center' });
}

export function renderInvoicePdf(invoice: InvoiceRow, brand?: InvoiceBrand): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: LEFT });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const amount = fmtMoney(invoice.invoice_amount);
    // The issuing company brands the letterhead; fall back to the platform brand
    // when the invoice isn't linked to a company/group.
    const brandName = brand?.name?.trim() || COMPANY.name;
    const brandEmail = brand?.email?.trim() || COMPANY.email;
    const brandLogo = brand?.logo ?? null;

    // --- Top accent bar (full bleed) ---------------------------------------
    doc.rect(0, 0, PAGE_W, 5).fill(BRAND);

    // --- Letterhead (left): company mark + name + contact ------------------
    const markS = 46;
    const markY = 50;
    drawCompanyMark(doc, brandName, brandLogo, LEFT, markY, markS);
    const txtX = LEFT + markS + 12;
    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(17)
      .text(brandName, txtX, markY + 2, { width: 270 });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(COMPANY.tagline, txtX, markY + 25, {
        width: 270,
      });
    doc
      .fillColor(MUTED)
      .fontSize(8.5)
      .text(brandEmail, txtX, markY + 37, { width: 270 });

    // --- INVOICE title + number + status (right) ---------------------------
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(30)
      .text('INVOICE', LEFT, 50, { align: 'right', width: CW, characterSpacing: 1 });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(11)
      .text(invoice.invoice_number ? `# ${invoice.invoice_number}` : '# —', LEFT, 86, {
        align: 'right',
        width: CW,
      });
    statusPill(doc, invoice.status || 'Submitted', RIGHT, 104);

    // --- Divider -----------------------------------------------------------
    doc.moveTo(LEFT, 134).lineTo(RIGHT, 134).lineWidth(1).strokeColor(LINE).stroke();

    // --- Meta strip: dates + terms (4 columns) -----------------------------
    const colW = CW / 4;
    const metaY = 148;
    metaCell(doc, 'Invoice date', fmtDate(invoice.invoice_date), LEFT, metaY, colW - 8);
    metaCell(doc, 'Due date', fmtDate(invoice.due_date), LEFT + colW, metaY, colW - 8);
    metaCell(
      doc,
      'Billing period',
      fmtMonth(invoice.billing_month),
      LEFT + colW * 2,
      metaY,
      colW - 8,
    );
    metaCell(
      doc,
      'Net terms',
      invoice.net_terms_days != null ? `${invoice.net_terms_days} days` : '—',
      LEFT + colW * 3,
      metaY,
      colW - 8,
    );

    // --- Bill To (left) + From (right) -------------------------------------
    const partyY = 200;
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('BILL TO', LEFT, partyY, { characterSpacing: 0.4 });
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(12.5)
      .text(invoice.vendor_name || '—', LEFT, partyY + 13, { width: CW / 2 - 10 });
    if (invoice.bill_to_email) {
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(9.5)
        .text(invoice.bill_to_email, LEFT, partyY + 31, { width: CW / 2 - 10 });
    }

    const fromX = LEFT + CW / 2;
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('FROM', fromX, partyY, { width: CW / 2, align: 'right', characterSpacing: 0.4 });
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(12.5)
      .text(brandName, fromX, partyY + 13, { width: CW / 2, align: 'right' });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9.5)
      .text(brandEmail, fromX, partyY + 31, { width: CW / 2, align: 'right' });

    // --- Line-items table --------------------------------------------------
    const cols = {
      desc: { x: LEFT + 12, w: 226 },
      period: { x: 300, w: 70 },
      rate: { x: 360, w: 88 },
      amount: { x: 455, w: 78 },
    };
    let y = 268;

    // Header row
    const headH = 24;
    doc.rect(LEFT, y, CW, headH).fill(HEADBG);
    doc
      .fillColor(SUB)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('DESCRIPTION', cols.desc.x, y + 8, {
        width: cols.desc.w,
        characterSpacing: 0.4,
      });
    doc.text('PERIOD', cols.period.x, y + 8, { width: cols.period.w, characterSpacing: 0.4 });
    doc.text('RATE', cols.rate.x, y + 8, {
      width: cols.rate.w,
      align: 'right',
      characterSpacing: 0.4,
    });
    doc.text('AMOUNT', cols.amount.x, y + 8, {
      width: cols.amount.w,
      align: 'right',
      characterSpacing: 0.4,
    });
    y += headH;

    // Single line item: the consultant's services for the billing period.
    const rowH = 38;
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(invoice.consultant_name || 'Consulting services', cols.desc.x, y + 8, {
        width: cols.desc.w,
      });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8.5)
      .text('Professional consulting services', cols.desc.x, y + 23, { width: cols.desc.w });
    doc
      .fillColor(SUB)
      .font('Helvetica')
      .fontSize(10)
      .text(fmtMonth(invoice.billing_month), cols.period.x, y + 12, { width: cols.period.w });
    doc.text(fmtMoney(invoice.pay_rate), cols.rate.x, y + 12, {
      width: cols.rate.w,
      align: 'right',
    });
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(amount, cols.amount.x, y + 12, { width: cols.amount.w, align: 'right' });
    y += rowH;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.75).strokeColor(LINE).stroke();

    // --- Amount Due block (right) ------------------------------------------
    y += 16;
    const dueW = 250;
    const dueX = RIGHT - dueW;
    const dueH = 44;
    doc.roundedRect(dueX, y, dueW, dueH, 8).fill(BRAND);
    doc
      .fillColor('#e0e7ff')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('AMOUNT DUE', dueX + 16, y + 11, { characterSpacing: 0.6 });
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(amount, dueX + 16, y + 9, { width: dueW - 32, align: 'right' });
    if (invoice.due_date) {
      doc
        .fillColor('#c7d2fe')
        .font('Helvetica')
        .fontSize(7.5)
        .text(`Due ${fmtDate(invoice.due_date)}`, dueX + 16, y + 30, {
          width: dueW - 32,
          align: 'right',
        });
    }
    y += dueH + 26;

    // --- Notes + payment terms (left) --------------------------------------
    const termsText =
      invoice.net_terms_days != null
        ? `Payment due within ${invoice.net_terms_days} day${
            invoice.net_terms_days === 1 ? '' : 's'
          } of the invoice date${invoice.due_date ? ` (by ${fmtDate(invoice.due_date)})` : ''}.`
        : invoice.due_date
          ? `Payment due by ${fmtDate(invoice.due_date)}.`
          : '';

    if (invoice.notes && invoice.notes.trim()) {
      doc
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('NOTES', LEFT, y, { characterSpacing: 0.4 });
      doc
        .fillColor(SUB)
        .font('Helvetica')
        .fontSize(9.5)
        .text(invoice.notes.trim(), LEFT, y + 13, { width: CW });
      y = doc.y + 12;
    }

    if (termsText) {
      doc.rect(LEFT, y, CW, 1).fill(LINE);
      y += 12;
      doc
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('PAYMENT TERMS', LEFT, y, { characterSpacing: 0.4 });
      doc
        .fillColor(SUB)
        .font('Helvetica')
        .fontSize(9.5)
        .text(termsText, LEFT, y + 13, { width: CW });
    }

    // --- Footer (pinned near the bottom) -----------------------------------
    const footY = 792;
    doc.rect(0, footY - 14, PAGE_W, 0.75).fill(SOFT);
    doc
      .moveTo(LEFT, footY - 12)
      .lineTo(RIGHT, footY - 12)
      .lineWidth(0.75)
      .strokeColor(LINE)
      .stroke();
    doc
      .fillColor(SUB)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Thank you for your business.', LEFT, footY, { width: CW / 2 });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(`${brandName} · ${brandEmail}`, LEFT, footY + 13, { width: CW / 2 });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(`Generated ${fmtDate(new Date().toISOString())}`, LEFT, footY + 4, {
        width: CW,
        align: 'right',
      });

    doc.end();
  });
}
