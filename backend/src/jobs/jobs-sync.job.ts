/**
 * Scheduled job-ingestion sync.
 *
 * Calls jobIngestion.runSync() on a fixed interval so admins don't have to
 * remember to click "Sync now". Gated by the `job_ingestion` feature flag —
 * when the flag is off, ticks become no-ops (cheap fast path, no driver
 * calls, no Anthropic spend).
 *
 * Default interval: 6 hours. Override with JOB_SYNC_INTERVAL_MS for a
 * different cadence (e.g. 3600000 = 1h). Set to 0 to disable scheduling
 * entirely while leaving manual /jobs/sync available.
 *
 * Initial delay defaults to 60s so the first tick fires after PM2 has
 * stabilized and the API is serving traffic — avoids hammering an
 * already-cold-starting process.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { loadFlags } from '../controllers/featureFlags.controller';
import { runSync } from '../services/jobIngestion.service';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const intervalEnv = Number(process.env.JOB_SYNC_INTERVAL_MS);
const intervalMs = Number.isFinite(intervalEnv) && intervalEnv > 0 ? intervalEnv : SIX_HOURS_MS;

export const jobsSyncJob = {
  name: 'jobs.ingestion-sync',
  intervalMs,
  initialDelayMs: 60_000,
  async run() {
    const flags = await loadFlags();
    if (flags.job_ingestion === false) {
      logger.debug('jobs.ingestion-sync: skipped — job_ingestion flag disabled');
      return;
    }

    // Quick existence probe so a fresh DB without source_companies doesn't
    // log "scheduler: tick failed" every 6h. Empty list → idle return.
    const probe = await db
      .from('source_companies')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    const activeCount = probe.count ?? 0;
    if (activeCount === 0) {
      logger.debug('jobs.ingestion-sync: no active source_companies — skipping');
      return;
    }

    logger.info({ activeSources: activeCount }, 'jobs.ingestion-sync: starting');
    const start = Date.now();
    try {
      const result = await runSync();
      // Sum across per-source reports for a single rollup log line. Per-source
      // detail is already logged inside runSync(), so the summary keeps
      // structured logs scannable.
      const totals = (result.reports ?? []).reduce(
        (acc, r) => ({
          pulled: acc.pulled + (r.jobs_pulled ?? 0),
          upserted: acc.upserted + (r.jobs_upserted ?? 0),
          errored: acc.errored + (r.error ? 1 : 0),
        }),
        { pulled: 0, upserted: 0, errored: 0 },
      );
      logger.info(
        {
          durationMs: Date.now() - start,
          sources: (result.reports ?? []).length,
          pulled: totals.pulled,
          upserted: totals.upserted,
          errored: totals.errored,
          matches_evaluated: result.auto_match?.matches_evaluated ?? 0,
          notifications_sent: result.auto_match?.notifications_sent ?? 0,
        },
        'jobs.ingestion-sync: completed',
      );
    } catch (err) {
      // runSync handles per-driver errors internally; a throw here means
      // something catastrophic (DB down, etc). Let the scheduler log and
      // retry on the next tick.
      logger.error({ err }, 'jobs.ingestion-sync: catastrophic failure');
      throw err;
    }
  },
};
