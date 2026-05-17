import { useEffect, useRef } from 'react';
import { getSession } from '../services/session';

/**
 * Subscribe to the server-side SSE realtime channel.
 *
 * The handlers map { eventType → callback } routes each pushed event by
 * name. Hook handles connection, reconnection with exponential backoff,
 * and cleanup on unmount. Auth is the JWT from localStorage passed as
 * ?token= since EventSource cannot set custom headers.
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

    function open() {
      if (cancelled) return;
      // Token comes from the same session source the api client uses,
      // so a refresh-rotated token flows through automatically.
      const sess = getSession();
      const token = sess?.access_token ?? null;
      if (!token) return;
      // Use the same /api/* prefix the axios client uses so Nginx routes
      // correctly. import.meta.env.VITE_API_URL ends with /api in this app.
      const base = import.meta.env.VITE_API_URL ?? '/api';
      const url = `${base}/realtime/stream?token=${encodeURIComponent(token)}`;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
