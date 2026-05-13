import { Resend } from 'resend';
import { env } from './env';

interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) resend = new Resend(env.email.resendKey);
  return resend;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (env.email.provider === 'resend') {
    if (!env.email.resendKey || env.email.resendKey.startsWith('re_...')) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    const { error } = await getResend().emails.send({
      from: env.email.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) throw new Error(`Resend send failed: ${error.message}`);
    return;
  }

  if (env.email.provider === 'sendgrid') {
    // Lazy-load so '@sendgrid/mail' isn't required unless EMAIL_PROVIDER=sendgrid.
    // The package isn't a hard dep — install it (`npm i @sendgrid/mail`) if you
    // choose SendGrid. Typed as unknown so the typechecker doesn't complain.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('@sendgrid/mail' as string).catch(() => {
      throw new Error('@sendgrid/mail is not installed. Run `npm i @sendgrid/mail` or set EMAIL_PROVIDER=resend.');
    });
    const sgMail = mod.default ?? mod;
    sgMail.setApiKey(env.email.sendgridKey);
    await sgMail.send({
      from: env.email.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text ?? input.subject,
    });
    return;
  }

  if (env.email.provider === 'brevo') {
    await sendViaBrevo(input);
    return;
  }

  throw new Error(`Unsupported EMAIL_PROVIDER: ${env.email.provider}`);
}

// ---------------------------------------------------------------------------
// Brevo (formerly Sendinblue) — uses the v3 REST API directly via fetch so
// we don't need the @getbrevo/brevo SDK as a dependency.
//
//   docs:  https://developers.brevo.com/reference/sendtransacemail
//   key:   Brevo dashboard → SMTP & API → API Keys → Create
//   note:  `EMAIL_FROM` accepts the standard "Name <email>" syntax. The sender
//          email must be on a domain you've authenticated in Brevo.
// ---------------------------------------------------------------------------
interface BrevoSender { email: string; name?: string }
interface BrevoRecipient { email: string }

function parseFromAddress(from: string): BrevoSender {
  // Handles both `Name <foo@bar.com>` and a bare `foo@bar.com`.
  const m = from.match(/^\s*(?:"?([^"<]+?)"?\s*<\s*)?([^>\s]+@[^>\s]+)\s*>?\s*$/);
  if (!m) throw new Error(`EMAIL_FROM "${from}" is not a valid sender address`);
  const name = m[1]?.trim();
  const email = m[2]!.trim();
  return name ? { email, name } : { email };
}

async function sendViaBrevo(input: SendEmailInput): Promise<void> {
  if (!env.email.brevoKey || !env.email.brevoKey.startsWith('xkeysib-')) {
    throw new Error('BREVO_API_KEY is not configured (expected to start with "xkeysib-")');
  }
  const to: BrevoRecipient[] = (Array.isArray(input.to) ? input.to : [input.to]).map((email) => ({ email }));
  const payload = {
    sender: parseFromAddress(env.email.from),
    to,
    subject: input.subject,
    htmlContent: input.html,
    ...(input.text ? { textContent: input.text } : {}),
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': env.email.brevoKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // Brevo returns JSON errors like {"code":"...", "message":"..."}.
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text().catch(() => ''); }
    throw new Error(`Brevo send failed (HTTP ${res.status}): ${detail}`);
  }
}
