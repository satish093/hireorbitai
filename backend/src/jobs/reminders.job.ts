/**
 * Reminders dispatcher job.
 *
 * Pulls reminders whose `due_at` has passed and `status = 'PENDING'`,
 * delivers them via Brevo + audit log, marks the row as 'SENT'. On failure
 * increments a per-row attempt counter and schedules an exponential-backoff
 * retry. After MAX_ATTEMPTS the row is forced to SENT with the last error
 * stored so the queue can't grow unboundedly on a permanent failure.
 *
 * Runs every 60 seconds. Idempotency:
 *   1. Bounded batch of 50 per tick — never drain unbounded queues.
 *   2. The UPDATE WHERE status='PENDING' guard means a second concurrent tick
 *      can't double-send the same row.
 *   3. delivery_next_attempt_at gates retry timing so a transient Brevo
 *      outage doesn't trigger 60 retries per minute per row.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { sendReminderNotice } from '../services/brevo.service';

interface ReminderRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  due_at: string;
  status: 'PENDING' | 'SENT' | 'DONE' | 'SNOOZED';
  delivery_attempts?: number | null;
}

interface OwnerRow {
  id: string;
  email: string;
  full_name: string | null;
}

const MAX_ATTEMPTS = 5;
// Exponential backoff in seconds: 1m, 2m, 4m, 8m, 16m.
function backoffSeconds(attempts: number): number {
  return 60 * Math.pow(2, Math.max(0, attempts - 1));
}

export const remindersJob = {
  name: 'reminders.dispatcher',
  intervalMs: 60_000,
  initialDelayMs: 30_000,
  async run() {
    const nowIso = new Date().toISOString();
    // Pull a bounded batch. The retry-window guard (delivery_next_attempt_at)
    // tolerates rows where the column is null (first attempt) or already due.
    const { data, error } = await db
      .from('reminders')
      .select('id, owner_id, title, description, due_at, status, delivery_attempts')
      .eq('status', 'PENDING')
      .lte('due_at', nowIso)
      .or(`delivery_next_attempt_at.is.null,delivery_next_attempt_at.lte.${nowIso}`)
      .order('due_at', { ascending: true })
      .limit(50);

    if (error) {
      // The reminders table or the new tracking columns may not exist yet on
      // older installs — surface the hint once per failure type, then drop the
      // noise level.
      if (/relation .* does not exist|schema cache|column .* does not exist/i.test(error.message)) {
        logger.warn(
          {
            hint: 'Apply database/reminders-delivery-tracking.sql (or schema.sql for first install)',
            err: error.message,
          },
          'reminders.dispatcher: table/column missing — job idle until migration applied',
        );
        return;
      }
      throw new Error(`reminders read failed: ${error.message}`);
    }

    const rows = (data as ReminderRow[]) ?? [];
    if (rows.length === 0) return;

    // Batch-resolve recipient profiles so we don't issue N round-trips. The
    // job runs at most 50 rows per tick, so a single .in() lookup is cheap.
    const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
    const { data: owners } = await db
      .from('users')
      .select('id, email, full_name')
      .in('id', ownerIds);
    const ownerById = new Map<string, OwnerRow>(
      ((owners ?? []) as OwnerRow[]).map((u) => [u.id, u]),
    );

    logger.info({ count: rows.length }, 'reminders.dispatcher: dispatching');

    for (const r of rows) {
      const owner = ownerById.get(r.owner_id);
      if (!owner) {
        // Orphaned reminder — owner was hard-deleted but cascade missed it,
        // or the join failed. Force-close so we don't loop on it.
        await db
          .from('reminders')
          .update({
            status: 'SENT',
            sent_at: new Date().toISOString(),
            delivery_last_error: 'owner not found',
          })
          .eq('id', r.id)
          .eq('status', 'PENDING');
        logger.warn({ reminderId: r.id, ownerId: r.owner_id }, 'reminder owner missing');
        continue;
      }

      try {
        await sendReminderNotice({
          to: { email: owner.email, name: owner.full_name ?? undefined },
          title: r.title,
          description: r.description,
          dueAt: new Date(r.due_at),
          relatedUrl: null,
        });
        // The status guard keeps a concurrent tick from double-marking — the
        // second update is a no-op if status is no longer PENDING.
        await db
          .from('reminders')
          .update({
            status: 'SENT',
            sent_at: new Date().toISOString(),
            delivery_last_error: null,
          })
          .eq('id', r.id)
          .eq('status', 'PENDING');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const attempts = (r.delivery_attempts ?? 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Permanent give-up: mark SENT so the queue drains. The error is
          // preserved on the row + logged loudly so an operator can inspect.
          await db
            .from('reminders')
            .update({
              status: 'SENT',
              sent_at: new Date().toISOString(),
              delivery_attempts: attempts,
              delivery_last_error: msg,
            })
            .eq('id', r.id)
            .eq('status', 'PENDING');
          logger.error(
            { err: msg, reminderId: r.id, attempts },
            'reminders.dispatcher: giving up after max attempts',
          );
        } else {
          const nextAt = new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString();
          await db
            .from('reminders')
            .update({
              delivery_attempts: attempts,
              delivery_last_error: msg,
              delivery_next_attempt_at: nextAt,
            })
            .eq('id', r.id)
            .eq('status', 'PENDING');
          logger.warn(
            { err: msg, reminderId: r.id, attempts, nextAt },
            'reminders.dispatcher: send failed, will retry',
          );
        }
      }
    }
  },
};
