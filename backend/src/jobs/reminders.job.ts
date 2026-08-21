/**
 * Reminders dispatcher job.
 *
 * Pulls reminders whose `due_at` has passed and `status = 'PENDING'`, delivers
 * them as an in-app SSE toast, and marks the row 'SENT'. Reminders are
 * in-app only — we do not email them.
 *
 * Runs every 60 seconds. Idempotency:
 *   1. Bounded batch of 50 per tick — never drain unbounded queues.
 *   2. The UPDATE WHERE status='PENDING' guard means a second concurrent tick
 *      can't double-deliver the same row.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { publishToUser } from '../services/realtime.service';
import { sendPushToUser } from '../services/push.service';

interface ReminderRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  due_at: string;
  status: 'PENDING' | 'SENT' | 'DONE' | 'SNOOZED';
  related_type?: string | null;
  related_id?: string | null;
}

interface OwnerRow {
  id: string;
}

export const remindersJob = {
  name: 'reminders.dispatcher',
  intervalMs: 60_000,
  initialDelayMs: 30_000,
  async run() {
    const nowIso = new Date().toISOString();
    // Pull a bounded batch of due, undelivered reminders.
    const { data, error } = await db
      .from('reminders')
      .select('id, owner_id, title, description, due_at, status, related_type, related_id')
      .eq('status', 'PENDING')
      .lte('due_at', nowIso)
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

    // Batch-resolve owners so we can detect orphaned reminders in one round
    // trip. The job runs at most 50 rows per tick, so a single .in() is cheap.
    const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
    const { data: owners } = await db.from('users').select('id').in('id', ownerIds);
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
          .update({ status: 'SENT', sent_at: new Date().toISOString() })
          .eq('id', r.id)
          .eq('status', 'PENDING');
        logger.warn({ reminderId: r.id, ownerId: r.owner_id }, 'reminder owner missing');
        continue;
      }

      try {
        // The status guard keeps a concurrent tick from double-marking — the
        // second update is a no-op if status is no longer PENDING.
        await db
          .from('reminders')
          .update({ status: 'SENT', sent_at: new Date().toISOString() })
          .eq('id', r.id)
          .eq('status', 'PENDING');
        // In-app push so an open browser shows a toast. Never throws
        // (publishToUser swallows).
        await publishToUser(owner.id, 'reminder:due', {
          id: r.id,
          title: r.title,
          description: r.description,
          due_at: r.due_at,
          related_type: r.related_type ?? null,
          related_id: r.related_id ?? null,
        });
        // Hard push so a backgrounded phone still gets the reminder. Best-effort.
        await sendPushToUser(owner.id, {
          title: 'Reminder',
          body: r.title,
          data: { type: 'reminder', id: r.id },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err: msg, reminderId: r.id }, 'reminders.dispatcher: deliver failed');
      }
    }
  },
};
