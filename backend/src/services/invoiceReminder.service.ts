/**
 * Invoice reminder dispatch — shared by the manual "Send reminder" endpoint
 * (invoices.controller) and the daily invoice-overdue job.
 *
 * Recipients for one invoice:
 *   - the bill-to CLIENT (bill_to_snapshot.email ?? bill_to_email), and
 *   - the company's MANAGERS: HR_MANAGER / MANAGER group leads whose home group
 *     is the invoice's company_group_id, plus anyone granted co-management of
 *     that group via manager_group_grants.
 *
 * Never throws on a single bad recipient — each send is best-effort and logged.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { sendInvoiceOverdueNotice } from './brevo.service';
import { GROUP_LEAD_ROLES } from '../types';
import type { InvoiceRow } from './invoicePdf.service';

export interface Recipient {
  email: string;
  name?: string;
}

/**
 * HR/Manager recipients responsible for a company group. De-duped by lowercased
 * email. Degrades gracefully if the grants table hasn't been migrated yet.
 */
export async function companyManagerRecipients(
  companyGroupId: string | null,
): Promise<Recipient[]> {
  if (!companyGroupId) return [];
  const byEmail = new Map<string, Recipient>();

  const { data: leads } = await db
    .from('users')
    .select('email, full_name, role, is_active, group_id')
    .eq('group_id', companyGroupId)
    .in('role', GROUP_LEAD_ROLES as unknown as string[])
    .eq('is_active', true);
  for (const u of (leads ?? []) as Array<{ email: string; full_name: string | null }>) {
    if (u.email)
      byEmail.set(u.email.toLowerCase(), { email: u.email, name: u.full_name ?? undefined });
  }

  // Co-managers granted this group. Table may be absent on older installs.
  try {
    const { data: grants, error } = await db
      .from('manager_group_grants')
      .select('manager_id')
      .eq('group_id', companyGroupId);
    if (!error) {
      const ids = (grants ?? [])
        .map((g: { manager_id: string | null }) => g.manager_id)
        .filter((id: string | null): id is string => !!id);
      if (ids.length) {
        const { data: mgrs } = await db
          .from('users')
          .select('email, full_name, role, is_active')
          .in('id', ids)
          .eq('is_active', true)
          .in('role', GROUP_LEAD_ROLES as unknown as string[]);
        for (const u of (mgrs ?? []) as Array<{ email: string; full_name: string | null }>) {
          if (u.email)
            byEmail.set(u.email.toLowerCase(), { email: u.email, name: u.full_name ?? undefined });
        }
      }
    }
  } catch {
    /* grants table missing — home-group leads only */
  }

  return [...byEmail.values()];
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function invoiceAmountDue(invoice: InvoiceRow): number {
  return Math.max(
    0,
    Math.round((num(invoice.total_amount) - num(invoice.amount_paid)) * 100) / 100,
  );
}

export function daysOverdue(dueDate: InvoiceRow['due_date']): number {
  if (!dueDate) return 0;
  const due = new Date(`${String(dueDate).slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(due)) return 0;
  return Math.max(0, Math.round((today - due) / 86_400_000));
}

export interface ReminderResult {
  client_emailed: string | null;
  managers_emailed: number;
}

/**
 * Send one invoice's reminder to the client + the company managers. Returns who
 * was notified. Caller is responsible for any throttle stamp (last_overdue_alert_at).
 */
export async function dispatchInvoiceReminder(invoice: InvoiceRow): Promise<ReminderResult> {
  const amountDue = invoiceAmountDue(invoice);
  const overdue = daysOverdue(invoice.due_date);
  const currency = (invoice.currency as string) || 'USD';
  const companyName = invoice.issuer_snapshot?.name ?? null;
  const billToName = invoice.bill_to_snapshot?.name ?? null;
  const dueDate = invoice.due_date ? String(invoice.due_date).slice(0, 10) : null;

  const shared = {
    invoiceNumber: invoice.invoice_number ?? null,
    companyName,
    billToName,
    amountDue,
    currency,
    dueDate,
    daysOverdue: overdue,
  };

  const clientEmail = (invoice.bill_to_snapshot?.email ?? invoice.bill_to_email ?? '').trim();
  let client_emailed: string | null = null;
  if (clientEmail) {
    try {
      await sendInvoiceOverdueNotice({
        to: { email: clientEmail, name: billToName ?? undefined },
        audience: 'client',
        ...shared,
      });
      client_emailed = clientEmail;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, invoiceId: invoice.id, to: clientEmail },
        'invoice reminder: client send failed',
      );
    }
  }

  const managers = await companyManagerRecipients(invoice.company_group_id ?? null);
  let managers_emailed = 0;
  for (const m of managers) {
    try {
      await sendInvoiceOverdueNotice({
        to: { email: m.email, name: m.name },
        audience: 'manager',
        ...shared,
      });
      managers_emailed++;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, invoiceId: invoice.id, to: m.email },
        'invoice reminder: manager send failed',
      );
    }
  }

  return { client_emailed, managers_emailed };
}
