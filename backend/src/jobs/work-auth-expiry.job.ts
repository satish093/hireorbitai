/**
 * Work authorization document expiry alert job.
 *
 * Runs once daily. For each document expiring within 60/30/7 days, sends an
 * email to the consultant, their recruiter, and the recruiter's manager.
 * Tracks the last send time in `last_expiry_alert_at` so alerts fire at most
 * once per day even if the job runs multiple times.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { sendWorkAuthExpiryAlert } from '../services/brevo.service';

interface DocRow {
  id: string;
  doc_type: string;
  label: string | null;
  expiry_date: string;
  last_expiry_alert_at: string | null;
  consultant: {
    id: string;
    user: { email: string; full_name: string | null } | null;
    recruiter: {
      id: string;
      user: { email: string; full_name: string | null } | null;
      manager: { user: { email: string; full_name: string | null } | null } | null;
    } | null;
  } | null;
}

const ALERT_WINDOWS_DAYS = [60, 30, 7];

export const workAuthExpiryJob = {
  name: 'work-auth-expiry',
  intervalMs: 24 * 60 * 60 * 1000, // daily
  initialDelayMs: 120_000, // 2 min after startup
  async run() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Query docs expiring within the largest window (60 days), not yet expired.
    const maxDays = Math.max(...ALERT_WINDOWS_DAYS);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + maxDays);

    const { data, error } = await db
      .from('work_auth_documents')
      .select(
        'id, doc_type, label, expiry_date, last_expiry_alert_at,' +
          ' consultant:consultants!consultant_id(' +
          '   id,' +
          '   user:users!user_id(email, full_name),' +
          '   recruiter:recruiters!recruiter_id(' +
          '     id,' +
          '     user:users!user_id(email, full_name),' +
          '     manager:recruiter_managers!recruiter_id(user:users!manager_id(email, full_name))' +
          '   )' +
          ' )',
      )
      .gte('expiry_date', today.toISOString().slice(0, 10))
      .lte('expiry_date', maxDate.toISOString().slice(0, 10));

    if (error) {
      if (/relation .* does not exist|schema cache/i.test(error.message)) {
        logger.warn(
          { hint: 'Apply backend/migrations/1748000000000_work-auth-documents.sql' },
          'work-auth-expiry: table missing — job idle until migration applied',
        );
        return;
      }
      throw new Error(`work-auth-expiry query failed: ${error.message}`);
    }

    const docs = (data ?? []) as DocRow[];
    if (docs.length === 0) return;

    const nowIso = new Date().toISOString();
    const cutoff = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();

    let sent = 0;
    for (const doc of docs) {
      // Skip if we already sent an alert today.
      if (doc.last_expiry_alert_at && doc.last_expiry_alert_at > cutoff) continue;

      const expiry = new Date(doc.expiry_date);
      expiry.setHours(0, 0, 0, 0);
      const daysUntilExpiry = Math.round(
        (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Only alert at the defined milestones.
      if (!ALERT_WINDOWS_DAYS.some((d) => Math.abs(daysUntilExpiry - d) <= 1)) continue;

      const consultant = doc.consultant;
      if (!consultant?.user?.email) continue;
      const consultantName = consultant.user.full_name ?? consultant.user.email;

      const recipients: Array<{ email: string; name?: string }> = [
        { email: consultant.user.email, name: consultant.user.full_name ?? undefined },
      ];
      if (consultant.recruiter?.user?.email) {
        recipients.push({
          email: consultant.recruiter.user.email,
          name: consultant.recruiter.user.full_name ?? undefined,
        });
      }
      if ((consultant.recruiter as any)?.manager?.user?.email) {
        recipients.push({
          email: (consultant.recruiter as any).manager.user.email,
          name: (consultant.recruiter as any).manager.user.full_name ?? undefined,
        });
      }

      for (const recipient of recipients) {
        try {
          await sendWorkAuthExpiryAlert({
            to: recipient,
            consultantName,
            docType: doc.doc_type,
            label: doc.label,
            expiryDate: doc.expiry_date,
            daysUntilExpiry,
          });
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : err, docId: doc.id, to: recipient.email },
            'work-auth-expiry: email send failed',
          );
        }
      }

      // Mark as alerted so we don't re-send today.
      const { error: updateErr } = await db
        .from('work_auth_documents')
        .update({ last_expiry_alert_at: nowIso })
        .eq('id', doc.id);
      if (updateErr) {
        logger.warn({ err: updateErr.message, docId: doc.id }, 'work-auth-expiry: update failed');
      }

      sent++;
    }

    if (sent > 0) {
      logger.info({ sent }, 'work-auth-expiry: alerts dispatched');
    }
  },
};
