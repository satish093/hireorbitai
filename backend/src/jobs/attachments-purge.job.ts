/**
 * Orphan attachment purge job.
 *
 * `messageAttachments.upload` creates rows with `message_id = NULL` while
 * the user is still typing — they only get claimed (linked to a real
 * message) on the subsequent `POST /messages`. If the user abandons the
 * compose (closes the tab, navigates away, crashes), the row stays
 * orphaned and the file sits in storage at `pending/<uploader>/...`
 * forever.
 *
 * This job runs every 6 hours and:
 *   1. Selects every message_attachments row with message_id IS NULL and
 *      created_at < NOW() - INTERVAL '24 hours'.
 *   2. Deletes the storage object (best-effort — a 404 from storage is
 *      fine because then there's nothing to leak).
 *   3. Deletes the DB row.
 *
 * 24 hours is generous on purpose: a user typing on mobile may legitimately
 * leave a draft for hours. Shorter windows risk yanking files out from
 * under an active compose; longer windows just delay disk reclamation.
 */

import { db, pool } from '../config/db';
import { logger } from '../config/logger';

const BUCKET = 'message-attachments';
const ORPHAN_AGE_HOURS = 24;
const BATCH_SIZE = 500;

interface OrphanRow {
  id: string;
  storage_path: string;
}

export const attachmentsPurgeJob = {
  name: 'message_attachments.purge_orphans',
  // Every 6 hours — keeps the orphan tail short without hammering storage.
  intervalMs: 6 * 60 * 60_000,
  // Wait 2 minutes after boot so the API has bound + the migration runner
  // (if any) has finished. The job is read-then-delete, so it can survive
  // a half-applied migration, but a 2-minute delay is essentially free.
  initialDelayMs: 120_000,
  async run() {
    let totalDeleted = 0;
    // Loop until a batch returns 0 — keeps each transaction small.
    // The `<` comparison uses Postgres's NOW() so the threshold is server-
    // time, not Node-time.
    for (;;) {
      const { rows } = await pool.query<OrphanRow>(
        `SELECT id, storage_path
           FROM public.message_attachments
          WHERE message_id IS NULL
            AND created_at < NOW() - ($1 || ' hours')::interval
          LIMIT $2`,
        [String(ORPHAN_AGE_HOURS), BATCH_SIZE],
      );
      if (rows.length === 0) break;

      // Delete storage objects in parallel. Best-effort — a failure here
      // logs and we still delete the DB row (so the next tick doesn't
      // re-fetch it forever).
      await Promise.all(
        rows.map(async (r) => {
          try {
            await db.storage.from(BUCKET).remove([r.storage_path]);
          } catch (err) {
            logger.warn(
              { err, id: r.id, path: r.storage_path },
              'attachments_purge: storage delete failed (DB row still removed)',
            );
          }
        }),
      );

      const ids = rows.map((r) => r.id);
      await pool.query(`DELETE FROM public.message_attachments WHERE id = ANY($1::uuid[])`, [ids]);
      totalDeleted += rows.length;

      // If the batch wasn't full, we've drained the queue — stop.
      if (rows.length < BATCH_SIZE) break;
    }
    if (totalDeleted > 0) {
      logger.info(
        { deleted: totalDeleted, ageHours: ORPHAN_AGE_HOURS },
        'attachments_purge: removed orphan attachments',
      );
    }
  },
};
