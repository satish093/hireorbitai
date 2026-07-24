/**
 * Realtime fan-out via Postgres LISTEN/NOTIFY → SSE.
 *
 * One generic pipe used by messaging, notifications, presence, and any
 * future feature that wants to push to a logged-in user without polling.
 *
 * Wire shape:
 *   - publishToUser(userId, event, payload) — any service can call this.
 *     Issues a `NOTIFY user:<userId>` with a JSON blob.
 *   - This module owns a long-lived dedicated pg.Client (NOT the pool —
 *     the pool reuses connections and LISTEN is connection-bound) that
 *     subscribes once at boot and stays connected for the process lifetime.
 *   - Each subscriber (one per browser SSE connection) registers a
 *     handler on the user-id channel. When PG fires NOTIFY, this module
 *     calls every handler for that user. The SSE controller is responsible
 *     for writing the event to the response stream.
 *
 * Cross-worker delivery comes free: under PM2 cluster mode, every worker
 * starts its own LISTEN client. PG broadcasts every NOTIFY to all
 * listeners. Each worker only fans out to subscribers connected to ITSELF,
 * so the message reaches its target browser regardless of which worker
 * served the SSE connection.
 *
 * Reconnect: if the LISTEN client errors, we log and try to reconnect with
 * a small backoff. We never give up — the dedicated client is the only
 * realtime path; without it the app falls back to the 60s polling that
 * was the previous default.
 */

import { Client } from 'pg';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { httpError } from '../types';

// Per-user concurrent SSE connection cap. Each subscription holds a TCP
// socket + 25s heartbeat + a PG LISTEN entry. Without a cap, a single
// authenticated user could exhaust FDs and saturate the PG LISTEN/NOTIFY
// channel for everyone else. 16 covers laptop + phone + a couple of stale
// tabs comfortably while still bounding the blast radius.
export const MAX_SSE_PER_USER = 16;

export interface RealtimeEvent {
  /** Stable event type — receivers route on this. */
  event: string;
  /** Free-form per-event payload. Must be JSON-serializable. */
  payload: unknown;
}

type Handler = (e: RealtimeEvent) => void;

// userId → Set<Handler>. Multiple browser tabs/devices for the same user
// all get the same event, so we keep a Set per user. Each SSE connection
// registers exactly one handler and unregisters on close.
const subscribers = new Map<string, Set<Handler>>();

// Channel naming. Postgres identifier rules limit channel length to 63
// characters and reject anything with non-ASCII / hyphens unless quoted.
// UUIDs (36 chars with hyphens) fit when quoted, but quoting LISTEN names
// is fiddly — use a fixed prefix + the raw uuid (hyphens are fine inside
// double-quoted identifiers in `NOTIFY "user:..."` syntax).
function channelFor(userId: string): string {
  return `user:${userId}`;
}

// ---------------------------------------------------------------------------
// Singleton LISTEN client.
// ---------------------------------------------------------------------------
let listenClient: Client | null = null;
let listenReady = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function connectListenClient(): Promise<void> {
  if (listenClient) return;
  const ssl =
    env.database.ssl === 'disable'
      ? false
      : env.database.ssl === 'require'
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false };
  const client = new Client({ connectionString: env.database.url, ssl });
  client.on('error', (err) => {
    logger.error({ err }, 'realtime: LISTEN client errored — will reconnect');
    listenReady = false;
    try {
      void client.end();
    } catch {
      /* ignore */
    }
    listenClient = null;
    // Re-LISTEN for every currently-subscribed user once the new client is up.
    scheduleReconnect();
  });
  client.on('notification', (msg) => {
    if (!msg.channel.startsWith('user:')) return;
    const userId = msg.channel.slice('user:'.length);
    const handlers = subscribers.get(userId);
    if (!handlers || handlers.size === 0) return;
    let parsed: RealtimeEvent;
    try {
      parsed = JSON.parse(msg.payload ?? '{}') as RealtimeEvent;
    } catch (e) {
      logger.warn({ err: e, payload: msg.payload }, 'realtime: bad NOTIFY payload — dropping');
      return;
    }
    for (const h of handlers) {
      try {
        h(parsed);
      } catch (e) {
        logger.warn({ err: e }, 'realtime: subscriber handler threw');
      }
    }
  });
  await client.connect();
  listenClient = client;
  listenReady = true;
  // Re-LISTEN every channel we have subscribers for. After a reconnect
  // the new client has no subscriptions; this re-arms them.
  for (const userId of subscribers.keys()) {
    await client.query(`LISTEN "${channelFor(userId).replace(/"/g, '""')}"`);
  }
  logger.info({ resubscribed: subscribers.size }, 'realtime: LISTEN client connected');
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectListenClient().catch((err) =>
      logger.error({ err }, 'realtime: reconnect failed — will retry'),
    );
  }, 2_000);
}

/** Boot the LISTEN client. Idempotent. Call once from server.ts startup. */
export async function startRealtime(): Promise<void> {
  await connectListenClient();
}

/** Graceful shutdown — closes the LISTEN client. */
export async function stopRealtime(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (listenClient) {
    try {
      await listenClient.end();
    } catch {
      /* ignore */
    }
    listenClient = null;
    listenReady = false;
  }
}

// ---------------------------------------------------------------------------
// Subscriber API used by the SSE controller.
// ---------------------------------------------------------------------------

/**
 * Register a handler for events targeting a specific user. Returns an
 * unsubscribe function — call it when the SSE stream closes or the client
 * disconnects.
 *
 * If this is the first subscriber for `userId`, issues a LISTEN to PG.
 * If unsubscribing leaves zero subscribers, issues an UNLISTEN to keep
 * the LISTEN client's working set small.
 */
export async function subscribe(userId: string, handler: Handler): Promise<() => void> {
  let set = subscribers.get(userId);
  // Bound the per-user subscriber set BEFORE we register or LISTEN. A single
  // user holding MAX_SSE_PER_USER live connections is already at the cap;
  // additional attempts must bounce with 429 instead of silently queuing.
  // Defense-in-depth against an authed DoS (FD exhaustion + LISTEN/NOTIFY
  // saturation) by a single account.
  if (set && set.size >= MAX_SSE_PER_USER) {
    throw httpError(
      429,
      'Too many open realtime connections — close some browser tabs and try again.',
    );
  }
  if (!set) {
    set = new Set();
    subscribers.set(userId, set);
    if (listenReady && listenClient) {
      // Quote the channel name — UUIDs contain hyphens and Postgres
      // identifiers reject hyphens unless quoted.
      await listenClient
        .query(`LISTEN "${channelFor(userId).replace(/"/g, '""')}"`)
        .catch((err) => logger.warn({ err, userId }, 'realtime: LISTEN failed'));
    }
  }
  set.add(handler);
  return () => {
    const s = subscribers.get(userId);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) {
      subscribers.delete(userId);
      if (listenReady && listenClient) {
        listenClient
          .query(`UNLISTEN "${channelFor(userId).replace(/"/g, '""')}"`)
          .catch((err) => logger.warn({ err, userId }, 'realtime: UNLISTEN failed'));
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Publisher API used by app-layer producers (messages, notifications, etc).
// ---------------------------------------------------------------------------

/**
 * Push an event to a specific user. Returns a promise that resolves once
 * Postgres has accepted the NOTIFY — usually <5 ms. Failures are logged
 * but not thrown; realtime is best-effort and must never break the
 * producing operation (e.g. failing to push a message:new event must
 * not roll back the INSERT that created the message).
 *
 * The pool is used here (not the dedicated LISTEN client) so concurrent
 * publishes don't serialize behind each other.
 */
import { pool } from '../config/db';

export async function publishToUser(
  userId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  if (!userId) return;
  const body: RealtimeEvent = { event, payload };
  try {
    // Channel + payload are both passed as parameters to pg_notify — using
    // the function form avoids the LISTEN/NOTIFY name-quoting rules that
    // bite when channel names have hyphens (every UUID has hyphens).
    await pool.query('SELECT pg_notify($1, $2)', [channelFor(userId), JSON.stringify(body)]);
  } catch (err) {
    logger.warn({ err, userId, event }, 'realtime: pg_notify failed — event dropped');
  }
}
