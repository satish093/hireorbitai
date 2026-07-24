/**
 * Daily match digest scheduler entry.
 *
 * Fires once per 24 h. Initial-delay is computed so the first run lands at
 * DAILY_DIGEST_HOUR_UTC (default 09:00 UTC) — that's 5am ET / 2pm CET /
 * late evening in Asia. Override the hour with the env var if the consultant
 * timezone distribution differs.
 *
 * Gated by the `daily_digest` feature flag — when off, the tick is a cheap
 * no-op (no consultant query, no Anthropic spend, no Brevo send).
 *
 * Single source of truth is the leader worker (NODE_APP_INSTANCE === '0').
 * Cluster mode does not double-fire — see backend/src/jobs/scheduler.ts.
 */

import { logger } from '../config/logger';
import { loadFlags } from '../controllers/featureFlags.controller';
import { runDailyDigest } from '../services/digest.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// Compute initial delay so the first run lands at the target UTC hour today
// (if still in the future) or tomorrow. Clamped to at least 60 s so we don't
// fire immediately on a same-second restart and overlap a manual run.
function computeInitialDelayMs(): number {
  const hourUtc = Number(process.env.DAILY_DIGEST_HOUR_UTC ?? 9);
  const clampedHour = Number.isFinite(hourUtc) && hourUtc >= 0 && hourUtc <= 23 ? hourUtc : 9;
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(clampedHour, 0, 0, 0);
  if (target.getTime() <= now.getTime() + 60_000) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

export const dailyDigestJob = {
  name: 'jobs.daily-digest',
  intervalMs: DAY_MS,
  initialDelayMs: computeInitialDelayMs(),
  async run() {
    const flags = await loadFlags();
    if (flags.daily_digest === false || flags.daily_digest === undefined) {
      // Default-OFF: only fire when an admin explicitly enabled the flag in
      // /admin/feature-flags. Keeps the digest from spamming on the first
      // deploy before anyone's reviewed it.
      logger.debug('jobs.daily-digest: skipped — daily_digest flag not enabled');
      return;
    }
    logger.info('jobs.daily-digest: starting');
    const start = Date.now();
    try {
      const report = await runDailyDigest();
      logger.info({ durationMs: Date.now() - start, ...report }, 'jobs.daily-digest: completed');
    } catch (err) {
      logger.error({ err }, 'jobs.daily-digest: catastrophic failure');
      throw err;
    }
  },
};
