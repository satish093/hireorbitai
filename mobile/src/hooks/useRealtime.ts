/**
 * Subscribe to the server-side SSE realtime channel.
 *
 * Same transport and the same auth handshake as the web
 * (frontend/src/hooks/useRealtime.ts): POST /realtime/token exchanges the JWT
 * for a single-use, 60-second SSE token, which is then passed in the stream
 * URL's query string. That keeps the long-lived JWT out of proxy access logs.
 *
 * TWO mobile realities the web hook never had to handle:
 *
 * 1. THERE IS NO GLOBAL `EventSource` IN REACT NATIVE.
 *    We use `react-native-sse`, which implements the same event contract over
 *    RN's networking stack.
 *
 * 2. THE OS SUSPENDS THE CONNECTION WHEN THE APP IS BACKGROUNDED.
 *    This is the single most important thing to understand about realtime in
 *    this app: an SSE stream is a FOREGROUND-ONLY transport. iOS tears down
 *    sockets shortly after backgrounding and Android doze does the same.
 *    So the hook closes deliberately on background and reopens on foreground,
 *    rather than pretending a dead socket is alive.
 *
 *    ==> Events that occur while the app is backgrounded are NOT delivered.
 *    Anything a user must learn about while the app is closed (a new message,
 *    an incoming call) needs a real push notification via APNs/FCM. There is no
 *    push infrastructure in the backend today; see mobile/README.md.
 *
 * Best-effort by design. On reconnect, screens should refetch their list —
 * that is what covers the gap.
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type EventSource from 'react-native-sse';
import { api } from '../services/api';
import { getSession } from '../services/session';
import { config as appConfig } from '../config/env';

/**
 * Resolve `react-native-sse` LAZILY and defensively.
 *
 * The library is a pure-JS XHR polyfill (no native module to link), but a hard
 * top-level `import` means that if the package fails to load for ANY reason —
 * not bundled, or incompatible with the installed React Native/Hermes — the
 * whole route module throws at import time. With no error boundary above the
 * route that used to close the entire app the moment Inbox was tapped, since
 * this hook is the one thing unique to the messages/chat routes.
 *
 * Resolving it inside a try/catch turns "SSE library unavailable" into "no live
 * updates" (screens still refetch via pull-to-refresh and onReconnect) instead
 * of a crash. Cached after the first attempt; `null` means unavailable.
 */
type EventSourceCtor = typeof EventSource;
let sseModuleResolved = false;
let EventSourceCls: EventSourceCtor | null = null;

function resolveEventSource(): EventSourceCtor | null {
  if (sseModuleResolved) return EventSourceCls;
  sseModuleResolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-sse');
    EventSourceCls = (mod?.default ?? mod) as EventSourceCtor;
  } catch {
    EventSourceCls = null;
  }
  return EventSourceCls;
}

export type RealtimeHandlers = Record<string, (payload: unknown) => void>;

interface Options {
  /** Fires after a reconnect so the screen can refetch what it missed. */
  onReconnect?: () => void;
  /** Set false to hold the connection closed (e.g. screen not focused). */
  enabled?: boolean;
}

const MAX_BACKOFF_MS = 30_000;

export function useRealtime(handlers: RealtimeHandlers, options: Options = {}): void {
  const { onReconnect, enabled = true } = options;

  // Refs so the effect subscribes ONCE and the parent can still update
  // behaviour without forcing a reconnect.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1_000;
    let hasConnectedOnce = false;

    function close(): void {
      try {
        es?.removeAllEventListeners();
        es?.close();
      } catch {
        /* ignore */
      }
      es = null;
    }

    function scheduleReconnect(): void {
      if (cancelled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
        void open();
      }, backoff);
    }

    async function open(): Promise<void> {
      if (cancelled || es) return;
      const sess = getSession();
      if (!sess?.access_token) return;

      // If the SSE library can't load, run without live push. Do NOT schedule a
      // reconnect — retrying can't make a missing module appear, and the screen
      // already refetches on focus / pull-to-refresh.
      const ES = resolveEventSource();
      if (!ES) return;

      let sseToken: string;
      try {
        const { data } = await api.post<{ sse_token: string }>('/realtime/token');
        sseToken = data.sse_token;
      } catch {
        scheduleReconnect();
        return;
      }
      if (cancelled) return;

      const url = `${appConfig.apiBaseUrl}/realtime/stream?token=${encodeURIComponent(sseToken)}`;
      try {
        es = new ES(url, {
          // The token in the URL is the credential; no bearer header needed.
          headers: {},
          // We drive reconnection ourselves so a rejected token can't spin.
          pollingInterval: 0,
        });
      } catch {
        scheduleReconnect();
        return;
      }

      es.addEventListener('open', () => {
        backoff = 1_000;
        if (hasConnectedOnce) onReconnectRef.current?.();
        hasConnectedOnce = true;
      });

      es.addEventListener('error', () => {
        // Tear down and use our own backoff. Left alone, a stale token makes
        // the library retry in a tight loop against a 401.
        close();
        scheduleReconnect();
      });

      // SSE dispatches by event name — register one listener per handler key.
      for (const eventName of Object.keys(handlersRef.current)) {
        es.addEventListener(eventName as never, (ev: { data?: string | null }) => {
          let parsed: unknown = ev?.data;
          try {
            if (typeof ev?.data === 'string') parsed = JSON.parse(ev.data);
          } catch {
            /* keep the raw string */
          }
          handlersRef.current[eventName]?.(parsed);
        });
      }
    }

    // Foreground/background lifecycle. Closing on background is deliberate:
    // the socket is already dead at the OS level, and holding a zombie
    // reference just delays the reconnect once the user comes back.
    const onAppStateChange = (state: AppStateStatus) => {
      if (cancelled) return;
      if (state === 'active') {
        if (!es) {
          backoff = 1_000;
          void open();
        }
      } else {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        close();
      }
    };

    const sub = AppState.addEventListener('change', onAppStateChange);
    void open();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      sub.remove();
      close();
    };
  }, [enabled]);
}
