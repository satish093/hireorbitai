/**
 * In-process job scheduler.
 *
 * Single-VPS deployment doesn't need Redis / BullMQ. Each job is a function +
 * an interval (ms). The scheduler:
 *   - Runs every job once on startup (after a configurable delay so the API
 *     finishes binding before background work starts).
 *   - Skips a tick if the previous run hasn't finished — never overlaps.
 *   - Catches all errors so a misbehaving job can't crash the API process.
 *   - Logs every tick + outcome through the shared pino logger.
 *
 * When we eventually scale beyond a single instance, swap the implementation
 * for a Redis-backed lock (one row per job in a `job_leases` table works fine
 * if you don't want a Redis dep). The Job interface is the contract — keep
 * it stable.
 */

import { logger } from '../config/logger';

export interface Job {
  /** Stable identifier — used in logs + lease rows. */
  name: string;
  /** How often to run, in milliseconds. */
  intervalMs: number;
  /** Initial delay before the first run, in ms. Default: 5_000. */
  initialDelayMs?: number;
  /** The thing to do. Receives no args; if you need state, close over it. */
  run: () => Promise<void> | void;
}

interface Lease {
  job: Job;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: boolean;
  cancelled: boolean;
}

const leases: Lease[] = [];

/** Register a job. Idempotent — re-registering the same name is a no-op. */
export function register(job: Job): void {
  if (leases.find((l) => l.job.name === job.name)) {
    logger.warn({ job: job.name }, 'scheduler: duplicate registration ignored');
    return;
  }
  leases.push({ job, timer: null, inflight: false, cancelled: false });
}

/**
 * Start every registered job. Idempotent across multiple calls.
 *
 * Under PM2 cluster mode (multiple workers), only the worker with
 * `NODE_APP_INSTANCE === '0'` actually fires jobs. The other workers
 * register the leases but stay idle. This guarantees one execution per
 * tick without needing a Redis lock or DB lease table — PM2's worker
 * numbering is deterministic across restarts.
 *
 * Set `JOBS_ALL_WORKERS=true` to disable the leader election (useful only
 * if every job has been verified multi-execution-safe at the SQL layer).
 */
export function start(): void {
  const instance = process.env.NODE_APP_INSTANCE;
  const isLeader = !instance || instance === '0' || process.env.JOBS_ALL_WORKERS === 'true';
  if (!isLeader) {
    logger.info({ instance, count: leases.length }, 'scheduler: idle on non-leader worker');
    return;
  }
  for (const l of leases) {
    if (l.timer || l.cancelled) continue;
    schedule(l, l.job.initialDelayMs ?? 5_000);
  }
  logger.info({ count: leases.length, jobs: leases.map((l) => l.job.name) }, 'scheduler: started');
}

/** Stop every job. Used by the graceful-shutdown hook in server.ts. */
export async function stop(): Promise<void> {
  for (const l of leases) {
    l.cancelled = true;
    if (l.timer) clearTimeout(l.timer);
    l.timer = null;
  }
  // Best-effort: wait for any inflight tick to settle, but cap at 5s so we
  // don't block shutdown forever.
  const deadline = Date.now() + 5_000;
  while (leases.some((l) => l.inflight) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  logger.info('scheduler: stopped');
}

function schedule(l: Lease, delayMs: number): void {
  if (l.cancelled) return;
  l.timer = setTimeout(() => void tick(l), delayMs);
}

async function tick(l: Lease): Promise<void> {
  l.timer = null;
  if (l.cancelled) return;
  if (l.inflight) {
    // Shouldn't happen — schedule() only fires once per cycle — but guard
    // against re-entry just in case.
    schedule(l, l.job.intervalMs);
    return;
  }
  l.inflight = true;
  const startedAt = Date.now();
  try {
    await l.job.run();
    logger.debug({ job: l.job.name, durationMs: Date.now() - startedAt }, 'scheduler: tick ok');
  } catch (err) {
    logger.error(
      { err, job: l.job.name, durationMs: Date.now() - startedAt },
      'scheduler: tick failed',
    );
  } finally {
    l.inflight = false;
    schedule(l, l.job.intervalMs);
  }
}
