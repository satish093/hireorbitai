/**
 * Server-Sent Events controller for the realtime push channel.
 *
 * Browser opens an EventSource against GET /realtime/stream. Auth via the
 * standard Authorization header — the global requireAuth middleware in
 * routes/index.ts attaches req.user before this handler runs.
 *
 * Why SSE over WebSocket:
 *   - One-way push is exactly what we need (message/notification fan-out).
 *     The "client → server" half is the existing POST endpoints.
 *   - EventSource handles reconnection natively, with a Last-Event-ID
 *     header on the next try. No custom backoff to maintain.
 *   - Plays nicely through standard HTTP proxies + Nginx, no upgrade
 *     handshake.
 *   - We get free fan-out across PM2 workers via the Postgres LISTEN
 *     client in realtime.service.ts — no Redis dependency.
 *
 * SSE chunks must flush as they're written. The CloudPanel Nginx vhost
 * needs `proxy_buffering off` on the /api/realtime/stream location for
 * this to work end-to-end. Documented in the operations runbook.
 */

import crypto from 'crypto';
import type { RequestHandler } from 'express';
import { httpError } from '../types';
import { subscribe, type RealtimeEvent } from '../services/realtime.service';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Short-lived SSE token store
//
// EventSource (browser) cannot attach an Authorization header, so the legacy
// approach was to pass the full JWT as ?token= in the URL — which exposes it
// in browser history, CDN logs, and HTTP Referrer headers.
//
// Instead we use a two-step exchange:
//   POST /realtime/token   (requireAuth → JWT in Authorization header)
//     → returns { sse_token: "<64-byte-hex>" }
//   GET  /realtime/stream?token=<sse_token>
//     → looks up the token (60 s TTL, single-use), gets userId, opens stream.
//
// The token is consumed on first connect. Any leak of the short URL is safe
// after the TTL expires or after the first successful open.
// ---------------------------------------------------------------------------
interface SseTokenEntry {
  userId: string;
  expiresAt: number;
}
const sseTokens = new Map<string, SseTokenEntry>();

function evictExpiredSseTokens(): void {
  const now = Date.now();
  for (const [token, entry] of sseTokens) {
    if (entry.expiresAt <= now) sseTokens.delete(token);
  }
}

/** POST /realtime/token — exchange a JWT for a short-lived SSE connect token. */
export const issueToken: RequestHandler = (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  evictExpiredSseTokens();
  if (sseTokens.size > 10_000) {
    logger.warn({ size: sseTokens.size }, 'realtime/token: SSE token store too large');
  }
  const token = crypto.randomBytes(32).toString('hex');
  sseTokens.set(token, { userId: req.user.id, expiresAt: Date.now() + 60_000 });
  res.json({ sse_token: token });
};

/**
 * GET /realtime/stream
 *
 * Long-lived SSE response. Sends a "ready" event on connect, then any
 * realtime event targeted at the caller's user id. Auto-pings every 25s
 * so intermediate proxies don't kill the connection on inactivity.
 */
export const stream: RequestHandler = async (req, res) => {
  // Prefer the short-lived SSE token (single-use, 60 s TTL) — this keeps
  // the full JWT out of the URL and therefore out of CDN/proxy access logs.
  // Fall back to req.user if no sse_token is provided so existing clients
  // continue to work during the transition window.
  let userId: string;
  const sseToken = (req.query.token as string | undefined)?.trim();
  if (sseToken) {
    evictExpiredSseTokens();
    const entry = sseTokens.get(sseToken);
    if (!entry || entry.expiresAt <= Date.now())
      throw httpError(401, 'SSE token invalid or expired');
    sseTokens.delete(sseToken); // single-use
    userId = entry.userId;
  } else if (req.user) {
    userId = req.user.id;
  } else {
    throw httpError(401, 'Not authenticated');
  }

  // SSE headers. The flush + no-cache combo is critical — Nginx will
  // buffer otherwise. The `X-Accel-Buffering: no` header is the standard
  // hint to disable buffering for the duration of this response, even
  // without the vhost change.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // First message — confirms the channel is alive to the client.
  res.write(`event: ready\ndata: {"ok":true}\n\n`);

  // Subscribe handler — pushes incoming NOTIFY events down the wire.
  const unsubscribe = await subscribe(userId, (e: RealtimeEvent) => {
    try {
      // JSON-stringify the full event so the client can do `JSON.parse`
      // on data; SSE event field is the routing key.
      res.write(`event: ${escapeEventName(e.event)}\n`);
      res.write(`data: ${JSON.stringify(e.payload)}\n\n`);
    } catch (err) {
      logger.warn({ err }, 'realtime/stream: write failed — closing connection');
      cleanup();
    }
  });

  // Heartbeat so the connection doesn't get reaped by proxies on idle.
  // 25 s is well under the typical 60 s proxy timeout.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      cleanup();
    }
  }, 25_000);

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
    try {
      res.end();
    } catch {
      /* ignore — already closed */
    }
  }

  // The client closed the tab / the network dropped / the server is
  // shutting down — every path unsubscribes.
  req.on('close', cleanup);
  req.on('error', cleanup);
};

/** Event names go on a single line per the SSE spec. Strip CR/LF to be safe. */
function escapeEventName(name: string): string {
  return name.replace(/[\r\n]/g, '_');
}
