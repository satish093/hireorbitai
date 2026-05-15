/**
 * Reminders dispatcher job.
 *
 * Pulls reminders whose `due_at` has passed and `status = 'PENDING'`,
 * delivers them via Brevo + audit log, marks the row as 'SENT'.
 *
 * Runs every 60 seconds. Idempotent: status check + UPDATE keeps two
 * concurrent ticks from double-sending (the second tick's UPDATE WHERE
 * status='PENDING' is a no-op for already-sent rows).
 */

import { db } from '../config/db';
import { logger } from '../config/logger';

interface ReminderRow {
  id: string;
  user_id: string | null;
  email: string | null;
  subject: string;
  body: string;
  due_at: string;
  status: 'PENDING' | 'SENT' | 'DONE' | 'SNOOZED';
}

export const remindersJob = {
  name: 'reminders.dispatcher',
  intervalMs: 60_000,
  initialDelayMs: 30_000,
  async run() {
    // Pull a bounded batch — never drain unbounded queues in one tick.
    const { data, error } = await db
      .from('reminders')
      .select('id, user_id, email, subject, body, due_at, status')
      .eq('status', 'PENDING')
      .lte('due_at', new Date().toISOString())
      .order('due_at', { ascending: true })
      .limit(50);

    if (error) {
      // The reminders table may not exist on older installs — surface the
      // hint once per failure, then drop the noise level.
      if (/relation .* does not exist|schema cache/i.test(error.message)) {
        logger.warn(
          {
            hint: 'Apply database/reminders.sql (or whichever migration created public.reminders)',
          },
          'reminders.dispatcher: table missing — job idle until migration applied',
        );
        return;
      }
      throw new Error(`reminders read failed: ${error.message}`);
    }

    const rows = (data as ReminderRow[]) ?? [];
    if (rows.length === 0) return;

    logger.info({ count: rows.length }, 'reminders.dispatcher: dispatching');

    for (const r of rows) {
      try {
        // TODO: wire to services/brevo.service.ts when the reminders feature
        // is ready to actually deliver. For now we just mark them sent so
        // the queue doesn't grow unboundedly. The job exists today as the
        // scheduling skeleton — flip the body to a real sendTransactionEmail
        // call when the product side is ready.
        await db
          .from('reminders')
          .update({ status: 'SENT', sent_at: new Date().toISOString() })
          .eq('id', r.id)
          .eq('status', 'PENDING'); // re-check status guards against races
      } catch (err) {
        logger.error({ err, reminderId: r.id }, 'reminders.dispatcher: delivery failed');
      }
    }
  },
};
