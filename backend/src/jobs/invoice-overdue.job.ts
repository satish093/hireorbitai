/**
 * Invoice overdue reminder job.
 *
 * Runs once daily. For every active, sent-but-unpaid invoice whose due date has
 * passed and that still carries a balance, emails:
 *   - the bill-to CLIENT (a payment-overdue reminder), and
 *   - the company's MANAGERS (HR_MANAGER / MANAGER group leads) — an internal
 *     heads-up.
 *
 * Throttled via `invoices.last_overdue_alert_at` so each invoice is reminded at
 * most once per day even if the job runs more than once (or the manual "Send
 * reminder" button was used). Bounded batch per tick so a large backlog can't
 * blow up a single run.
 */

import { pool } from '../config/db';
import { logger } from '../config/logger';
import { dispatchInvoiceReminder } from '../services/invoiceReminder.service';
import type { InvoiceRow } from '../services/invoicePdf.service';

const BATCH = 200;

export const invoiceOverdueJob = {
  name: 'invoice-overdue',
  intervalMs: 24 * 60 * 60 * 1000, // daily
  initialDelayMs: 180_000, // 3 min after startup
  async run() {
    let rows: InvoiceRow[];
    try {
      const result = await pool.query(
        `select id, invoice_number, company_group_id, issuer_snapshot, bill_to_snapshot,
                bill_to_email, currency, total_amount, amount_paid, due_date, status
           from public.invoices
          where archived_at is null
            and status in ('Submitted','Approved','Partially Paid')
            and due_date is not null
            and due_date < current_date
            and (total_amount - amount_paid) > 0
            and (last_overdue_alert_at is null
                 or last_overdue_alert_at < now() - interval '23 hours')
          order by due_date asc
          limit ${BATCH}`,
      );
      rows = result.rows as InvoiceRow[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // amount_paid / last_overdue_alert_at land in 1778000000000_invoice_payments.
      if (/column .* does not exist|relation .* does not exist|schema cache/i.test(msg)) {
        logger.warn(
          { hint: 'Apply backend/migrations/1778000000000_invoice_payments.sql', err: msg },
          'invoice-overdue: column/table missing — job idle until migration applied',
        );
        return;
      }
      throw new Error(`invoice-overdue query failed: ${msg}`);
    }

    if (rows.length === 0) return;

    let sent = 0;
    for (const invoice of rows) {
      try {
        const result = await dispatchInvoiceReminder(invoice);
        // Stamp regardless of whether a recipient existed — a no-recipient
        // invoice shouldn't be re-scanned every tick. (Surfaced once below.)
        await pool.query('update public.invoices set last_overdue_alert_at = now() where id = $1', [
          invoice.id,
        ]);
        if (result.client_emailed || result.managers_emailed > 0) sent++;
        else
          logger.warn(
            { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number },
            'invoice-overdue: no reminder recipients (no bill-to email, no company managers)',
          );
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, invoiceId: invoice.id },
          'invoice-overdue: reminder dispatch failed',
        );
      }
    }

    if (sent > 0)
      logger.info({ sent, scanned: rows.length }, 'invoice-overdue: reminders dispatched');
  },
};
