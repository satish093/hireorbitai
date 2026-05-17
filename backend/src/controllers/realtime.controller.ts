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

import type { RequestHandler } from 'express';
import { httpError } from '../types';
import { subscribe, type RealtimeEvent } from '../services/realtime.service';
import { logger } from '../config/logger';

/**
 * GET /realtime/stream
 *
 * Long-lived SSE response. Sends a "ready" event on connect, then any
 * realtime event targeted at the caller's user id. Auto-pings every 25s
 * so intermediate proxies don't kill the connection on inactivity.
 */
export const stream: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const userId = req.user.id;

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
