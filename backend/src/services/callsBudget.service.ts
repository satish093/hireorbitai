/**
 * Org-wide monthly call-duration budget.
 *
 * Caps total accepted call time at env.calls.monthlyHourCap (default
 * 980 hrs) per calendar month so Cloudflare Realtime TURN egress stays
 * inside the 1,000 GB/mo free tier. The cap is enforced ONLY at
 * /calls/offer — calls already in flight when the cap is reached
 * continue uninterrupted; only NEW offers get a 503.
 *
 * Architecture:
 *   - getMonthlyHoursUsed() sums duration_seconds for `status='ended'`
 *     calls whose `started_at` falls inside the current UTC calendar
 *     month. Memoized for 60 s so /calls/offer doesn't hit the DB on
 *     every call attempt.
 *   - invalidateMonthlyHoursUsed() is called from /calls/end so the
 *     just-finished call's duration is visible to the next /offer's
 *     cap check (instead of waiting 60 s for the cache to expire).
 *   - assertUnderMonthlyCap() is the controller-facing throw site.
 *
 * The cache key includes the year+month so a new month automatically
 * invalidates the prior month's count without any cron job — the next
 * lookup misses the cache and triggers a fresh SUM for the new window.
 */

import { pool } from '../config/db';
import { env } from '../config/env';
import { httpError } from '../types';
import { logger } from '../config/logger';

interface CacheEntry {
  /** YYYY-MM in UTC. When the current month differs from this, the
   *  entry is stale by definition — month rollover invalidation is
   *  free (no cron needed). */
  monthKey: string;
  /** Hours used in the cached month. */
  hours: number;
  /** Wall-clock ms when this entry was computed; entries older than
   *  CACHE_TTL_MS are refreshed even when the month hasn't changed. */
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

/** YYYY-MM string in UTC for the supplied Date (or now() by default). */
function utcMonthKey(at: Date = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Total hours of accepted-call audio recorded so far this calendar month.
 * Memoized for ~60 s; auto-rolls when the calendar month changes.
 */
export async function getMonthlyHoursUsed(): Promise<number> {
  const now = Date.now();
  const monthKey = utcMonthKey();
  if (cache && cache.monthKey === monthKey && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.hours;
  }
  // Aggregate inside the partial index `calls_started_at_idx` (see
  // database/calls-duration.sql). COALESCE so an empty month returns 0
  // rather than null.
  const { rows } = await pool.query<{ hours: string }>(
    `SELECT COALESCE(SUM(duration_seconds), 0)::float8 / 3600.0 AS hours
       FROM public.calls
      WHERE status = 'ended'
        AND duration_seconds IS NOT NULL
        AND started_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
  );
  const hours = Number(rows[0]?.hours ?? 0);
  cache = { monthKey, hours, fetchedAt: now };
  return hours;
}

/**
 * Wipe the cache so the very next call to getMonthlyHoursUsed re-queries
 * Postgres. Called from /calls/end after the UPDATE that writes
 * duration_seconds — otherwise the just-finished call wouldn't count
 * against the cap for up to 60 s.
 */
export function invalidateMonthlyHoursUsed(): void {
  cache = null;
}

/**
 * Guard for /calls/offer. Throws 503 when the org has consumed >= cap
 * hours in the current calendar month. Setting CALLS_MONTHLY_HOUR_CAP=0
 * disables the cap entirely (dev/test escape hatch).
 */
export async function assertUnderMonthlyCap(): Promise<void> {
  const cap = env.calls.monthlyHourCap;
  if (cap <= 0) return; // disabled
  const used = await getMonthlyHoursUsed();
  if (used >= cap) {
    // Logged at info, not warn — this is a planned, recoverable state.
    // Operators can grep the audit_logs row (calls_monthly_cap_reached)
    // for per-incident detail; this log line just gives ops a heartbeat.
    logger.info(
      { used_hours: used, cap_hours: cap },
      'callsBudget: monthly cap reached — refusing new offers',
    );
    throw httpError(503, 'Monthly call capacity reached — service paused until next month', {
      used_hours: used,
      cap_hours: cap,
    });
  }
}
