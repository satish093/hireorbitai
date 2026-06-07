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
  // `date` / `timestamptz` columns arrive as JS Date objects from the DB shim
  // (pg's default parsers); fmtDate handles both Date and string.
  invoice_date?: string | Date | null;
  due_date?: string | Date | null;
  net_terms_days?: number | null;
  status?: string | null;
  bill_to_email?: string | null;
  notes?: string | null;
  created_at?: string | Date | null;
  company_group_id?: string | null;
}

/** Issuing-company branding for the letterhead. Resolved from the invoice's
 *  company_group_id (the user group / company): its name + uploaded logo bytes.
 *  When `logo` is absent a placeholder mark (the company initials) is drawn. */
export interface InvoiceBrand {
  name?: string | null;
  email?: string | null;
  /** 6-digit hex brand color (from the company / logo analysis) used to theme
   *  the accent bar, Amount Due block, company name, and mark. */
  color?: string | null;
  logo?: Buffer | null;
}

// Palette — mirrors the app brand (indigo-600) + slate scale.
const BRAND = '#4f46e5';
const INK = '#0f172a'; // slate-900
const SUB = '#334155'; // slate-700
const MUTED = '#64748b'; // slate-500
const LINE = '#e2e8f0'; // slate-200
const HEADBG = '#f1f5f9'; // slate-100

// Status pill tones — mirror the frontend <Pill> tones on the Invoices page.
const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  Draft: { bg: '#f1f5f9', text: '#64748b' },
  Submitted: { bg: '#dbeafe', text: '#1d4ed8' },
  Approved: { bg: '#ede9fe', text: '#6d28d9' },
  Paid: { bg: '#dcfce7', text: '#15803d' },
  Overdue: { bg: '#fee2e2', text: '#b91c1c' },
  Cancelled: { bg: '#e2e8f0', text: '#475569' },
};

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const LEFT = 50;
const RIGHT = 545;
const CW = RIGHT - LEFT; // 495
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

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

function fmtDate(value?: string | Date | null): string {
  if (!value) return '—';
  // The DB shim returns `date` / `timestamptz` columns as JS Date objects (pg's
  // default type parsers), but callers may also pass ISO strings. Handle both —
  // calling .includes() on a Date is what produced a 500 in production.
  const d =
    value instanceof Date
      ? value
      : String(value).includes('T')
        ? new Date(String(value))
        : new Date(`${String(value)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtMonth(value?: string | null): string {
  if (!value) return '—';
  const s = String(value);
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime())
    ? s
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

/** A brand-tinted rounded square with the company initials — the fallback mark
 *  when a company has no uploaded logo (logos render at natural aspect instead). */
function drawCompanyMark(
  doc: Doc,
  name: string,
  color: string,
  x: number,
  y: number,
  s: number,
): void {
  doc.save();
  doc.roundedRect(x, y, s, s, 8).fillOpacity(0.12).fill(color);
  doc.restore();
  doc
    .fillColor(color)
    .fillOpacity(1)
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
    // The issuing company (a user group) brands the invoice. No fake platform
    // issuer: when no company is linked, the letterhead/From are simply omitted.
    const themeColor = brand?.color && HEX_RE.test(brand.color) ? brand.color : BRAND;
    const brandName = brand?.name?.trim() || '';
    const brandEmail = brand?.email?.trim() || '';
    const brandLogo = brand?.logo ?? null;
    const hasBrand = !!(brandName || brandLogo);

    // --- Top accent bar (full bleed, themed) -------------------------------
    doc.rect(0, 0, PAGE_W, 5).fill(themeColor);

    // --- Letterhead (left) -------------------------------------------------
    if (hasBrand) {
      if (brandLogo) {
        // A company logo is usually a wordmark that already contains the name —
        // render it at its natural aspect ratio (not squished into a tiny square)
        // and DON'T repeat the name as text. The company name + email still
        // appear in the FROM block on the right.
        try {
          // With `fit`, the image scales to fit the box anchored at (x, y) top-left.
          doc.image(brandLogo, LEFT, 48, { fit: [200, 58] });
        } catch {
          // Corrupt/unsupported image bytes → fall back to the initials mark + name.
          drawCompanyMark(doc, brandName || 'Company', themeColor, LEFT, 50, 46);
          if (brandName) {
            doc
              .fillColor(themeColor)
              .font('Helvetica-Bold')
              .fontSize(17)
              .text(brandName, LEFT + 58, 55, { width: 270 });
          }
        }
      } else {
        // No logo → brand-tinted initials mark + the company name + email.
        const markS = 46;
        const markY = 50;
        drawCompanyMark(doc, brandName || 'Company', themeColor, LEFT, markY, markS);
        const txtX = LEFT + markS + 12;
        if (brandName) {
          doc
            .fillColor(themeColor)
            .font('Helvetica-Bold')
            .fontSize(17)
            .text(brandName, txtX, markY + 5, { width: 270 });
        }
        if (brandEmail) {
          doc
            .fillColor(MUTED)
            .font('Helvetica')
            .fontSize(9)
            .text(brandEmail, txtX, markY + 28, { width: 270 });
        }
      }
    }

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

    if (hasBrand && brandName) {
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
      if (brandEmail) {
        doc
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(9.5)
          .text(brandEmail, fromX, partyY + 31, { width: CW / 2, align: 'right' });
      }
    }

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
    doc.roundedRect(dueX, y, dueW, dueH, 8).fill(themeColor);
    doc.save();
    doc
      .fillColor('#ffffff')
      .fillOpacity(0.85)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('AMOUNT DUE', dueX + 16, y + 11, { characterSpacing: 0.6 });
    doc.restore();
    doc
      .fillColor('#ffffff')
      .fillOpacity(1)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(amount, dueX + 16, y + 9, { width: dueW - 32, align: 'right' });
    if (invoice.due_date) {
      doc.save();
      doc
        .fillColor('#ffffff')
        .fillOpacity(0.75)
        .font('Helvetica')
        .fontSize(7.5)
        .text(`Due ${fmtDate(invoice.due_date)}`, dueX + 16, y + 30, {
          width: dueW - 32,
          align: 'right',
        });
      doc.restore();
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

    // --- Footer ------------------------------------------------------------
    // Pinned ABOVE the A4 bottom margin (PAGE_H − 50 ≈ 792). Drawing at/below
    // that boundary makes pdfkit auto-add blank pages — the prior 4-page bug.
    const footY = PAGE_H - 94; // ≈ 748; lowest line (footY+13) ends ~771
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
    const footerBrand = [brandName, brandEmail].filter(Boolean).join(' · ');
    if (footerBrand) {
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8)
        .text(footerBrand, LEFT, footY + 13, { width: CW / 2 });
    }
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
