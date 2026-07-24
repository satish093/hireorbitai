import { useEffect, useRef } from 'react';
import { getSession } from '../services/session';
import { api } from '../services/api';

/**
 * Subscribe to the server-side SSE realtime channel.
 *
 * The handlers map { eventType → callback } routes each pushed event by
 * name. Hook handles connection, reconnection with exponential backoff,
 * and cleanup on unmount.
 *
 * Auth flow: a short-lived SSE token is exchanged via POST /realtime/token
 * (JWT in Authorization header) before opening the EventSource. This keeps
 * the full JWT out of the URL — and therefore out of CDN/proxy access logs,
 * browser history, and HTTP Referrer headers. The token is single-use with
 * a 60-second TTL, so any URL leak is harmless after the first open.
 *
 * Usage:
 *   useRealtime({
 *     'message:new':     (m: Message) => setMessages((arr) => [...arr, m]),
 *     'message:edited':  (m: Message) => setMessages((arr) => arr.map(...)),
 *     'message:deleted': ({ id }: { id: string }) => setMessages((arr) => arr.filter(...)),
 *   });
 *
 * Best-effort by design — if the connection drops the hook keeps trying
 * to reconnect in the background, and the page's existing polling
 * (where present) catches anything missed during the gap.
 */
export function useRealtime(handlers: Record<string, (payload: unknown) => void>): void {
  // Handlers ref so we don't reopen the EventSource on every parent
  // re-render. The hook subscribes ONCE, and reads handlers from the ref
  // each time an event fires.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1_000; // start at 1s, capped at 30s

    async function open() {
      if (cancelled) return;
      const sess = getSession();
      if (!sess?.access_token) return;

      // Exchange the JWT for a short-lived SSE token. The axios client sends
      // the JWT in the Authorization header — keeping it out of the URL.
      const base = import.meta.env.VITE_API_URL ?? '/api';
      let sseToken: string;
      try {
        const { data } = await api.post<{ sse_token: string }>('/realtime/token');
        sseToken = data.sse_token;
      } catch {
        scheduleReconnect();
        return;
      }
      if (cancelled) return;

      const url = `${base}/realtime/stream?token=${encodeURIComponent(sseToken)}`;
      try {
        es = new EventSource(url, { withCredentials: false });
      } catch {
        scheduleReconnect();
        return;
      }
      es.addEventListener('open', () => {
        // Connection live — reset the backoff so the next drop starts at 1s.
        backoff = 1_000;
      });
      es.addEventListener('error', () => {
        // EventSource auto-reconnects, but on auth failures it loops
        // forever. Tear down and rely on our backoff so a stale token
        // doesn't hammer the server.
        try {
          es?.close();
        } catch {
          /* ignore */
        }
        es = null;
        scheduleReconnect();
      });
      // Per-event listener. SSE delivers named events on whichever
      // listener is registered for that event name — register one for
      // every handler key.
      for (const eventName of Object.keys(handlersRef.current)) {
        es.addEventListener(eventName, (ev: MessageEvent) => {
          let parsed: unknown = ev.data;
          try {
            parsed = JSON.parse(ev.data);
          } catch {
            /* keep as-string */
          }
          handlersRef.current[eventName]?.(parsed);
        });
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // Exponential backoff capped at 30s. Avoids hammering after a
        // long network outage or a server restart.
        backoff = Math.min(30_000, backoff * 2);
        open();
      }, backoff);
    }

    open();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = null;
    };
    // Intentionally empty dep array — the hook opens once and the
    // handlers ref pattern lets the parent update behavior without a
    // reconnect.
  }, []);
}
