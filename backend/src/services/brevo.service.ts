import { env } from '../config/env';
import { logger } from '../config/logger';
import type { InvoiceRow } from './invoicePdf.service';

// ---------------------------------------------------------------------------
// Brevo (formerly Sendinblue) transactional email client.
//
// We call the v3 REST API directly via native fetch — no SDK dependency.
// Endpoint: POST https://api.brevo.com/v3/smtp/email
// Docs:     https://developers.brevo.com/reference/sendtransacemail
//
// Every auth email in the app routes through this module — no third-party auth
// emails are used.
// ---------------------------------------------------------------------------

interface SendArgs {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text?: string;
  /** Optional Brevo "tag" used for grouping in the Brevo dashboard. */
  tag?: string;
  /** Optional file attachments. `content` is the raw bytes — base64-encoded for
   *  the Brevo v3 `attachment[]` field at send time. */
  attachment?: Array<{ name: string; content: Buffer }>;
}

async function sendViaBrevo(args: SendArgs): Promise<void> {
  if (env.email.brevoMock) {
    logger.info(
      { to: args.to.email, subject: args.subject, tag: args.tag },
      '[BREVO_MOCK] email suppressed — would have sent',
    );
    return;
  }
  if (!env.email.brevoKey || !env.email.brevoKey.startsWith('xkeysib-')) {
    throw new Error('BREVO_API_KEY is not configured (expected to start with "xkeysib-")');
  }
  const payload = {
    sender: { email: env.email.brevoSenderEmail, name: env.email.brevoSenderName },
    to: [args.to],
    subject: args.subject,
    htmlContent: args.html,
    ...(args.text ? { textContent: args.text } : {}),
    ...(args.tag ? { tags: [args.tag] } : {}),
    ...(args.attachment && args.attachment.length
      ? {
          attachment: args.attachment.map((a) => ({
            name: a.name,
            content: a.content.toString('base64'),
          })),
        }
      : {}),
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': env.email.brevoKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = await res.text().catch(() => '');
    }
    // Don't include the API key in the thrown error — pino redaction protects logs,
    // but we keep the message domain-specific too.
    throw new Error(`Brevo send failed (HTTP ${res.status}): ${detail}`);
  }
  logger.info({ to: args.to.email, subject: args.subject, tag: args.tag }, 'brevo email sent');
}

// ---------------------------------------------------------------------------
// Templates — branded HTML + plain-text fallbacks
//
// Layout: centered 600px card on a slate background. Mobile-responsive via
// max-width: 100% on inner blocks. Inline styles only (Gmail strips <style>).
// ---------------------------------------------------------------------------

interface Branding {
  productName: string;
  primaryColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  bgColor: string;
  supportEmail: string;
  websiteUrl: string;
}

const brand: Branding = {
  productName: 'HireOrbit AI',
  primaryColor: '#4f46e5', // indigo-600
  textColor: '#0f172a', // slate-900
  mutedColor: '#64748b', // slate-500
  borderColor: '#e2e8f0', // slate-200
  bgColor: '#f8fafc', // slate-50
  supportEmail: 'support@hireorbitai.com',
  websiteUrl: env.frontendUrl,
};

function shell(args: {
  preheader: string; // hidden inbox-preview text
  heading: string;
  body: string; // raw HTML — block-level allowed
  cta?: { label: string; href: string };
  footerNote?: string;
  /** Optional company branding for the header (invoice emails). When a logoUrl
   *  is given the header shows the company logo image; else the company name;
   *  else the default product wordmark. */
  headerBrand?: { logoUrl?: string | null; name?: string | null };
}): string {
  const { preheader, heading, body, cta, footerNote } = args;
  const hb = args.headerBrand;
  const headerInner = hb?.logoUrl
    ? `<img src="${hb.logoUrl}" alt="${escapeHtml(hb.name || 'Company')}" style="max-height:36px;max-width:220px;vertical-align:middle;" />`
    : `<span style="font-weight:700;letter-spacing:-0.01em;font-size:16px;color:${brand.textColor};">${escapeHtml(hb?.name || brand.productName)}</span>`;
  const ctaHtml = cta
    ? `<tr><td style="padding: 8px 0 24px 0;"><a href="${cta.href}"
         style="display:inline-block;background:${brand.primaryColor};color:#ffffff;text-decoration:none;
         font-weight:600;padding:12px 22px;border-radius:10px;font-family:Inter,Arial,sans-serif;font-size:14px;
         line-height:1;">${cta.label}</a></td></tr>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${brand.bgColor};font-family:Inter,Arial,sans-serif;color:${brand.textColor};">
<!-- Preheader -->
<div style="display:none;font-size:1px;color:${brand.bgColor};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.bgColor};padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${brand.borderColor};border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:24px 28px 16px 28px;border-bottom:1px solid ${brand.borderColor};">
          ${headerInner}
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <h1 style="margin:0 0 8px 0;font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:${brand.textColor};">${escapeHtml(heading)}</h1>
          <div style="font-size:14px;line-height:1.55;color:${brand.textColor};">${body}</div>
          <table role="presentation" cellpadding="0" cellspacing="0">${ctaHtml}</table>
          ${footerNote ? `<p style="margin:8px 0 0 0;font-size:12px;color:${brand.mutedColor};">${footerNote}</p>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px;border-top:1px solid ${brand.borderColor};background:${brand.bgColor};">
          <p style="margin:0;font-size:12px;color:${brand.mutedColor};line-height:1.5;">
            You received this email from ${escapeHtml(brand.productName)} because this address is associated with an account.
            Questions? Reach us at <a href="mailto:${brand.supportEmail}" style="color:${brand.primaryColor};text-decoration:none;">${brand.supportEmail}</a>.
          </p>
          <p style="margin:8px 0 0 0;font-size:11px;color:${brand.mutedColor};">
            <a href="${brand.websiteUrl}" style="color:${brand.mutedColor};text-decoration:underline;">${brand.websiteUrl.replace(/^https?:\/\//, '')}</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Public mailer API
// ---------------------------------------------------------------------------

export async function sendWelcomeWithTempPassword(args: {
  to: { email: string; name?: string };
  tempPassword: string;
  expiresInHours: number;
}): Promise<void> {
  const loginUrl = `${env.frontendUrl}/login`;
  const expiry = args.expiresInHours;
  const body = `
    <p>Hi ${escapeHtml(args.to.name ?? 'there')},</p>
    <p>Your ${escapeHtml(brand.productName)} account is ready. Sign in with the temporary password below — you'll be asked to set a new one right after.</p>
    <div style="margin:16px 0 20px 0;padding:14px 16px;background:${brand.bgColor};border:1px solid ${brand.borderColor};border-radius:10px;">
      <div style="font-size:11px;font-weight:600;color:${brand.mutedColor};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Email</div>
      <div style="font-family:'SF Mono','Menlo','Consolas',monospace;font-size:14px;">${escapeHtml(args.to.email)}</div>
      <div style="font-size:11px;font-weight:600;color:${brand.mutedColor};letter-spacing:0.08em;text-transform:uppercase;margin:12px 0 4px 0;">Temporary password</div>
      <div style="font-family:'SF Mono','Menlo','Consolas',monospace;font-size:14px;word-break:break-all;">${escapeHtml(args.tempPassword)}</div>
    </div>
    <p style="margin:0 0 4px 0;font-size:13px;color:${brand.mutedColor};">
      This password expires in ${expiry} hour${expiry === 1 ? '' : 's'}. For your security, never share it.
    </p>
  `;
  await sendViaBrevo({
    to: args.to,
    subject: `Welcome to ${brand.productName} — your account is ready`,
    html: shell({
      preheader: `Your temporary password is inside. Expires in ${expiry}h.`,
      heading: `Welcome to ${brand.productName}`,
      body,
      cta: { label: 'Sign in', href: loginUrl },
      footerNote: 'For your security, change this temporary password the first time you sign in.',
    }),
    text: `Welcome to ${brand.productName}.
Sign in: ${loginUrl}
Email: ${args.to.email}
Temporary password: ${args.tempPassword}
This password expires in ${expiry} hours. You will be asked to set a new password on first sign-in.`,
    tag: 'welcome',
  });
}

export async function sendInvitationLink(args: {
  to: { email: string; name?: string };
  role: string;
  inviteUrl: string;
  expiresInHours: number;
  invitedByName?: string;
}): Promise<void> {
  const exp = args.expiresInHours;
  const roleLabel = args.role
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const inviter = args.invitedByName ? escapeHtml(args.invitedByName) : 'A teammate';
  const body = `
    <p>Hi${args.to.name ? ` ${escapeHtml(args.to.name)}` : ''},</p>
    <p>${inviter} invited you to join <strong>${escapeHtml(brand.productName)}</strong> as a <strong>${escapeHtml(roleLabel)}</strong>. Click the button below to set your password and finish creating your account.</p>
    <p style="margin:0 0 4px 0;font-size:13px;color:${brand.mutedColor};">
      This invitation expires in ${exp} hour${exp === 1 ? '' : 's'}. If it lapses, ask the person who invited you to send a new one.
    </p>
  `;
  await sendViaBrevo({
    to: args.to,
    subject: `You're invited to join ${brand.productName}`,
    html: shell({
      preheader: `Set up your ${brand.productName} account — invitation expires in ${exp}h.`,
      heading: `You're invited to ${brand.productName}`,
      body,
      cta: { label: 'Accept invitation', href: args.inviteUrl },
      footerNote: `If the button doesn't work, paste this URL into your browser:<br/><span style="word-break:break-all;color:${brand.textColor};">${escapeHtml(args.inviteUrl)}</span>`,
    }),
    text: `${inviter.replace(/<[^>]+>/g, '')} invited you to join ${brand.productName} as a ${roleLabel}.
Accept your invitation:
${args.inviteUrl}
This link expires in ${exp} hours.`,
    tag: 'invitation',
  });
}

export async function sendPasswordResetLink(args: {
  to: { email: string; name?: string };
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<void> {
  const exp = args.expiresInMinutes;
  const body = `
    <p>Hi ${escapeHtml(args.to.name ?? 'there')},</p>
    <p>We received a request to reset the password for your ${escapeHtml(brand.productName)} account. Use the button below to choose a new one — the link is valid for <strong>${exp} minute${exp === 1 ? '' : 's'}</strong>.</p>
    <p style="margin:14px 0 6px 0;font-size:13px;color:${brand.mutedColor};">
      If you didn't request this, you can safely ignore this email — your password won't change.
    </p>
  `;
  await sendViaBrevo({
    to: args.to,
    subject: `Reset your ${brand.productName} password`,
    html: shell({
      preheader: `Password reset link — valid for ${exp} minutes.`,
      heading: 'Reset your password',
      body,
      cta: { label: 'Reset password', href: args.resetUrl },
      footerNote: `If the button doesn't work, paste this URL into your browser:<br/><span style="word-break:break-all;color:${brand.textColor};">${escapeHtml(args.resetUrl)}</span>`,
    }),
    text: `Reset your ${brand.productName} password.
Open this link (valid for ${exp} minutes):
${args.resetUrl}
If you didn't request this, ignore this email.`,
    tag: 'password-reset',
  });
}

export async function sendPasswordChangedNotice(args: {
  to: { email: string; name?: string };
  when: Date;
  ipAddress?: string | null;
}): Promise<void> {
  const whenStr = args.when.toUTCString();
  const ip = args.ipAddress ?? 'unknown';
  const body = `
    <p>Hi ${escapeHtml(args.to.name ?? 'there')},</p>
    <p>Your ${escapeHtml(brand.productName)} password was just changed.</p>
    <div style="margin:16px 0 4px 0;padding:14px 16px;background:${brand.bgColor};border:1px solid ${brand.borderColor};border-radius:10px;font-size:13px;color:${brand.textColor};">
      <div><span style="color:${brand.mutedColor};">When:</span> ${escapeHtml(whenStr)}</div>
      <div><span style="color:${brand.mutedColor};">IP:</span> ${escapeHtml(ip)}</div>
    </div>
    <p style="margin:14px 0 0 0;font-size:13px;color:${brand.mutedColor};">
      If this wasn't you, reset your password immediately and contact <a href="mailto:${brand.supportEmail}" style="color:${brand.primaryColor};">${brand.supportEmail}</a>.
    </p>
  `;
  await sendViaBrevo({
    to: args.to,
    subject: `Your ${brand.productName} password was changed`,
    html: shell({
      preheader: 'A password change happened on your account.',
      heading: 'Password changed',
      body,
    }),
    text: `Your ${brand.productName} password was just changed.
When: ${whenStr}
IP: ${ip}
If this wasn't you, reset immediately and email ${brand.supportEmail}.`,
    tag: 'password-changed',
  });
}

// ---------------------------------------------------------------------------
// Invoice email — sends the generated invoice PDF as an attachment.
//
// Triggered from POST /invoices/:id/send when the user flips the "Email this
// invoice" toggle on. The PDF buffer is rendered by invoicePdf.service and
// passed in; this just wraps it in the branded shell + attaches it.
// ---------------------------------------------------------------------------
export async function sendInvoiceEmail(args: {
  to: { email: string; name?: string };
  invoice: InvoiceRow;
  pdf: Buffer;
  fileName: string;
  /** Issuing company branding — its logo + name head the email (not "HireOrbit AI"). */
  company?: { name?: string | null; logoUrl?: string | null };
}): Promise<void> {
  const inv = args.invoice;
  // The issuing company brands the email; fall back to the platform name only
  // when the invoice isn't linked to a company.
  const companyName = args.company?.name?.trim() || brand.productName;
  const number = inv.invoice_number ? `#${inv.invoice_number}` : '';
  const amount =
    inv.invoice_amount != null && inv.invoice_amount !== ''
      ? Number(inv.invoice_amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      : null;
  // `due_date` arrives as a JS Date from the DB shim (pg parsers) — coerce to a
  // friendly string; passing a Date through escapeHtml would throw.
  const dueStr = inv.due_date
    ? inv.due_date instanceof Date
      ? inv.due_date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : String(inv.due_date)
    : '';
  const detailRows: Array<[string, string]> = [];
  if (inv.consultant_name) detailRows.push(['Consultant', inv.consultant_name]);
  if (inv.vendor_name) detailRows.push(['Vendor', inv.vendor_name]);
  if (amount) detailRows.push(['Amount', amount]);
  if (dueStr) detailRows.push(['Due date', dueStr]);
  const detailHtml = detailRows
    .map(
      ([k, v]) =>
        `<div><span style="color:${brand.mutedColor};">${escapeHtml(k)}:</span> ${escapeHtml(v)}</div>`,
    )
    .join('');
  const body = `
    <p>Hi${args.to.name ? ` ${escapeHtml(args.to.name)}` : ''},</p>
    <p>Please find attached the invoice ${escapeHtml(number)} from ${escapeHtml(companyName)}. The full document is attached to this email as a PDF.</p>
    <div style="margin:16px 0 4px 0;padding:14px 16px;background:${brand.bgColor};border:1px solid ${brand.borderColor};border-radius:10px;font-size:13px;color:${brand.textColor};">
      ${detailHtml || `<div style="color:${brand.mutedColor};">See the attached PDF for details.</div>`}
    </div>
  `;
  await sendViaBrevo({
    to: args.to,
    subject: `Invoice ${number ? number + ' ' : ''}from ${companyName}`.replace(/\s+/g, ' ').trim(),
    html: shell({
      preheader: `Invoice ${number} attached.`.trim(),
      heading: `Invoice ${number}`.trim(),
      body,
      headerBrand: { logoUrl: args.company?.logoUrl, name: args.company?.name },
    }),
    text: `Please find attached the invoice ${number} from ${companyName}.${amount ? `\nAmount: ${amount}` : ''}${dueStr ? `\nDue date: ${dueStr}` : ''}\nThe invoice PDF is attached to this email.`,
    tag: 'invoice',
    attachment: [{ name: args.fileName, content: args.pdf }],
  });
}

// ---------------------------------------------------------------------------
// Daily match digest — top-N AI-matched jobs from the last 24 h.
//
// Rendered as a card list inside the same brand shell as the other
// transactional emails. Each match shows title, company, score, optional
// reason snippet, and a "View role" CTA that deeplinks into /jobs?focus=<id>.
// ---------------------------------------------------------------------------
export interface DigestMatch {
  jobId: string;
  title: string;
  company: string;
  matchScore: number; // 0-100
  reason?: string; // 1-line "why this matched" from the AI
  location?: string;
  source?: string; // 'greenhouse' | 'lever' | ...
}

export async function sendDailyMatchDigest(args: {
  to: { email: string; name?: string };
  matches: DigestMatch[];
  windowHours: number;
}): Promise<void> {
  if (args.matches.length === 0) return; // never send an empty digest

  const dashboardUrl = `${env.frontendUrl}/jobs`;

  const rows = args.matches
    .map((m) => {
      const dot =
        m.matchScore >= 85
          ? '#10b981' /* emerald-500 */
          : m.matchScore >= 70
            ? '#0ea5e9' /* sky-500 */
            : m.matchScore >= 50
              ? '#f59e0b' /* amber-500 */
              : '#f43f5e'; /* rose-500 */
      const focusUrl = `${env.frontendUrl}/jobs?focus=${encodeURIComponent(m.jobId)}`;
      const meta = [m.company, m.location, m.source]
        .filter(Boolean)
        .map((x) => escapeHtml(String(x)))
        .join(' · ');
      return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid ${brand.borderColor};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="vertical-align:top;">
                  <a href="${focusUrl}" style="color:${brand.textColor};text-decoration:none;font-weight:600;font-size:15px;line-height:1.35;">
                    ${escapeHtml(m.title)}
                  </a>
                  <div style="margin-top:2px;font-size:12px;color:${brand.mutedColor};">${meta}</div>
                  ${
                    m.reason
                      ? `<div style="margin-top:6px;font-size:12.5px;color:${brand.textColor};line-height:1.45;">${escapeHtml(m.reason)}</div>`
                      : ''
                  }
                </td>
                <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
                  <span style="display:inline-flex;align-items:center;gap:6px;background:${dot}1A;color:${dot};font-weight:600;font-size:12px;padding:4px 8px;border-radius:999px;">
                    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dot};"></span>
                    ${Math.round(m.matchScore)}% match
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    })
    .join('');

  const body = `
    <p style="margin:0 0 8px 0;">Hi ${escapeHtml(args.to.name ?? 'there')},</p>
    <p style="margin:0 0 16px 0;">
      Here are your top ${args.matches.length} matched roles from the last ${args.windowHours} hours.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-collapse:collapse;border-top:1px solid ${brand.borderColor};">
      ${rows}
    </table>
    <p style="margin:18px 0 0 0;font-size:12.5px;color:${brand.mutedColor};">
      You're receiving this because you're an active consultant in ${escapeHtml(brand.productName)}.
      Manage notifications from your profile.
    </p>
  `;

  await sendViaBrevo({
    to: args.to,
    subject: `Your daily job matches — ${args.matches.length} new role${args.matches.length === 1 ? '' : 's'}`,
    html: shell({
      preheader: `${args.matches.length} fresh match${args.matches.length === 1 ? '' : 'es'} for you today.`,
      heading: 'Your daily matches',
      body,
      cta: { label: 'Browse all jobs', href: dashboardUrl },
    }),
    text:
      `Your daily matches\n\n` +
      args.matches
        .map(
          (m) =>
            `${Math.round(m.matchScore)}% · ${m.title} — ${m.company}${m.location ? ' (' + m.location + ')' : ''}\n${env.frontendUrl}/jobs?focus=${m.jobId}`,
        )
        .join('\n\n') +
      `\n\nBrowse all jobs: ${dashboardUrl}`,
    tag: 'daily-digest',
  });
}

// ---------------------------------------------------------------------------
// Invoice overdue / payment reminder.
//
// Sent by the daily invoice-overdue job and the manual "Send reminder" button.
// Two audiences share one template with different tone:
//   - 'client'  → the bill-to party: a polite nudge to settle the balance.
//   - 'manager' → the company's HR/Manager group leads: an internal heads-up
//                 with a deeplink into the Invoices workspace.
// ---------------------------------------------------------------------------
export async function sendInvoiceOverdueNotice(args: {
  to: { email: string; name?: string };
  audience: 'client' | 'manager';
  invoiceNumber?: string | null;
  companyName?: string | null;
  billToName?: string | null;
  amountDue: number;
  currency: string;
  dueDate?: string | null;
  daysOverdue: number;
}): Promise<void> {
  const number = args.invoiceNumber ? `#${args.invoiceNumber}` : '';
  const companyName = args.companyName?.trim() || brand.productName;
  let amount: string;
  try {
    amount = args.amountDue.toLocaleString('en-US', { style: 'currency', currency: args.currency });
  } catch {
    amount = `${args.currency} ${args.amountDue.toFixed(2)}`;
  }
  const dueStr = args.dueDate ? String(args.dueDate).slice(0, 10) : '';
  const overdue = args.daysOverdue > 0;
  const dayLabel = `${args.daysOverdue} day${args.daysOverdue === 1 ? '' : 's'}`;

  const statusLine = overdue
    ? `Overdue by <strong style="color:#dc2626;">${dayLabel}</strong>`
    : 'Payment reminder';
  const detail = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
      <tr><td style="padding:14px 16px;background:${brand.bgColor};border:1px solid ${brand.borderColor};border-radius:10px;font-size:13px;color:${brand.textColor};">
        <div><span style="color:${brand.mutedColor};">Invoice:</span> ${escapeHtml(number || '—')}</div>
        <div><span style="color:${brand.mutedColor};">Balance due:</span> <strong>${escapeHtml(amount)}</strong></div>
        ${dueStr ? `<div><span style="color:${brand.mutedColor};">Due date:</span> ${escapeHtml(dueStr)}</div>` : ''}
        <div style="margin-top:4px;color:${overdue ? '#dc2626' : brand.mutedColor};">${statusLine}</div>
      </td></tr>
    </table>`;

  let subject: string;
  let heading: string;
  let body: string;
  let cta: { label: string; href: string } | undefined;

  if (args.audience === 'manager') {
    const who = args.billToName?.trim() ? escapeHtml(args.billToName.trim()) : 'a client';
    subject = overdue
      ? `Overdue invoice ${number} — ${amount} outstanding`.replace(/\s+/g, ' ').trim()
      : `Invoice ${number} due — ${amount} outstanding`.replace(/\s+/g, ' ').trim();
    heading = overdue ? 'Overdue invoice needs attention' : 'Invoice payment due';
    body = `
      <p>Hi ${escapeHtml(args.to.name ?? 'there')},</p>
      <p>Invoice ${escapeHtml(number)} to <strong>${who}</strong> ${overdue ? `is <strong>overdue by ${dayLabel}</strong>` : 'is awaiting payment'}. This is an internal reminder for your group.</p>
      ${detail}
      <p style="font-size:13px;color:${brand.mutedColor};">Open the Invoices workspace to follow up or record a payment.</p>`;
    cta = { label: 'Open invoices', href: `${env.frontendUrl}/invoices` };
  } else {
    subject = overdue
      ? `Reminder: invoice ${number} from ${companyName} is overdue`.replace(/\s+/g, ' ').trim()
      : `Reminder: invoice ${number} from ${companyName} is due`.replace(/\s+/g, ' ').trim();
    heading = overdue
      ? `Invoice ${number} is overdue`.trim()
      : `Invoice ${number} payment reminder`.trim();
    body = `
      <p>Hi ${escapeHtml(args.to.name ?? 'there')},</p>
      <p>This is a friendly reminder that invoice ${escapeHtml(number)} from <strong>${escapeHtml(companyName)}</strong> ${overdue ? `is now <strong>overdue by ${dayLabel}</strong>` : 'is awaiting payment'}.</p>
      ${detail}
      <p style="font-size:13px;color:${brand.mutedColor};">If you've already sent this payment, please disregard this message. Questions? Reply to this email to reach ${escapeHtml(companyName)}.</p>`;
  }

  await sendViaBrevo({
    to: args.to,
    subject,
    html: shell({
      preheader: `${number ? number + ' · ' : ''}${amount} ${overdue ? 'overdue' : 'due'}.`.trim(),
      heading,
      body,
      ...(cta ? { cta } : {}),
    }),
    text:
      `${heading}\n\n` +
      `Invoice: ${number || '—'}\nBalance due: ${amount}${dueStr ? `\nDue date: ${dueStr}` : ''}\n` +
      `${overdue ? `Overdue by ${dayLabel}` : 'Payment reminder'}` +
      `${args.audience === 'manager' ? `\n\nOpen invoices: ${env.frontendUrl}/invoices` : ''}`,
    tag: args.audience === 'manager' ? 'invoice-overdue-manager' : 'invoice-overdue',
  });
}

export async function sendWorkAuthExpiryAlert(args: {
  to: { email: string; name?: string };
  consultantName: string;
  docType: string;
  label: string | null;
  expiryDate: string;
  daysUntilExpiry: number;
}): Promise<void> {
  const { consultantName, docType, label, expiryDate, daysUntilExpiry } = args;
  const docDesc = label ? `${docType} — ${label}` : docType;
  const urgency = daysUntilExpiry <= 7 ? 'urgent' : daysUntilExpiry <= 30 ? 'soon' : 'upcoming';
  const body = `
    <p>Hi ${escapeHtml(args.to.name ?? 'there')},</p>
    <p>A work authorization document for <strong>${escapeHtml(consultantName)}</strong> is expiring ${urgency === 'urgent' ? '<strong>very soon</strong>' : urgency === 'soon' ? 'soon' : 'in the next 60 days'}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
      <tr><td style="padding:14px 16px;background:${brand.bgColor};border:1px solid ${brand.borderColor};border-radius:10px;">
        <div style="font-size:13px;color:${brand.mutedColor};font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Document</div>
        <div style="font-size:15px;font-weight:600;">${escapeHtml(docDesc)}</div>
        <div style="font-size:13px;color:${daysUntilExpiry <= 7 ? '#dc2626' : daysUntilExpiry <= 30 ? '#d97706' : brand.mutedColor};margin-top:6px;">
          Expires <strong>${escapeHtml(expiryDate)}</strong> · ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} remaining
        </div>
      </td></tr>
    </table>
    <p>Please ensure a renewed document is uploaded before the expiry date to avoid compliance gaps.</p>
  `;
  const dashboardUrl = `${env.frontendUrl}/dashboard`;
  await sendViaBrevo({
    to: args.to,
    subject: `Action required: ${escapeHtml(consultantName)}'s ${escapeHtml(docType)} expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`,
    html: shell({
      preheader: `${consultantName}'s ${docType} expires ${daysUntilExpiry <= 7 ? 'in ' + daysUntilExpiry + ' days' : 'soon'} — please renew.`,
      heading: 'Work authorization expiry notice',
      body,
      cta: { label: 'Open portal', href: dashboardUrl },
    }),
    text: `Work authorization expiry notice\n\nConsultant: ${consultantName}\nDocument: ${docDesc}\nExpiry date: ${expiryDate}\nDays remaining: ${daysUntilExpiry}\n\n${dashboardUrl}`,
    tag: 'work-auth-expiry',
  });
}

export async function sendAccountLockedNotice(args: {
  to: { email: string; name?: string };
  unlocksAt: Date;
}): Promise<void> {
  const body = `
    <p>Hi ${escapeHtml(args.to.name ?? 'there')},</p>
    <p>Your ${escapeHtml(brand.productName)} account has been temporarily locked after too many failed sign-in attempts. This is an automatic protection.</p>
    <p>Try again after <strong>${escapeHtml(args.unlocksAt.toUTCString())}</strong>, or reset your password.</p>
  `;
  await sendViaBrevo({
    to: args.to,
    subject: `${brand.productName}: account temporarily locked`,
    html: shell({
      preheader: 'Too many failed sign-in attempts — temporary lockout.',
      heading: 'Account temporarily locked',
      body,
      cta: { label: 'Reset password', href: `${env.frontendUrl}/forgot-password` },
    }),
    text: `Your ${brand.productName} account has been temporarily locked.
You can try again after ${args.unlocksAt.toUTCString()} or reset your password at:
${env.frontendUrl}/forgot-password`,
    tag: 'account-locked',
  });
}
