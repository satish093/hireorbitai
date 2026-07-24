/**
 * Tab-bar badge counts — open tasks, pending reminders, unread messages.
 *
 * Port of frontend/src/hooks/useBadgeCounts.ts, same three endpoints and the
 * same 60s base interval with exponential backoff to 5 minutes on failure.
 *
 * Mobile differences:
 *   • polling PAUSES while the app is backgrounded. The web keyed off document
 *     visibility; here it is AppState. Polling a suspended app is wasted
 *     battery, and iOS will not run the timer reliably anyway.
 *   • an immediate tick on foreground, so the badge is correct by the time the
 *     user has finished looking at the screen.
 *   • cooling endpoints are skipped — api.ts arms a client-side cooldown after
 *     a 429, and a poller is exactly what keeps a rate limit pinned.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { api, isEndpointCooling } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useInvalidationListener } from './useInvalidate';

export interface BadgeCounts {
  tasks?: number;
  reminders?: number;
  inbox?: number;
}

const BASE_MS = 60_000;
const MAX_MS = 5 * 60_000;

function countOf(res: { data?: unknown } | null): number | undefined {
  if (!res) return undefined;
  const d = res.data as unknown;
  if (Array.isArray(d)) return d.length;
  if (d && typeof d === 'object') {
    const obj = d as { count?: unknown; unread?: unknown; data?: unknown };
    if (typeof obj.count === 'number') return obj.count;
    if (typeof obj.unread === 'number') return obj.unread;
    if (Array.isArray(obj.data)) return obj.data.length;
  }
  if (typeof d === 'number') return d;
  return undefined;
}

export function useBadgeCounts(): BadgeCounts {
  const { profile } = useAuth();
  const [counts, setCounts] = useState<BadgeCounts>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentMs = useRef(BASE_MS);
  const mounted = useRef(true);

  const userId = profile?.id ?? null;

  useEffect(() => {
    mounted.current = true;
    if (!userId) {
      setCounts({});
      return;
    }

    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };

    const tick = async () => {
      if (!mounted.current) return;
      if (AppState.currentState !== 'active') {
        schedule();
        return;
      }
      try {
        const [t, r, u] = await Promise.all([
          isEndpointCooling('/tasks/assigned-to-me')
            ? null
            : api.get('/tasks/assigned-to-me').catch(() => null),
          isEndpointCooling('/reminders')
            ? null
            : api.get('/reminders', { params: { status: 'PENDING' } }).catch(() => null),
          isEndpointCooling('/messages/unread-count')
            ? null
            : api.get('/messages/unread-count').catch(() => null),
        ]);
        if (!mounted.current) return;
        setCounts((prev) => ({
          tasks: countOf(t) ?? prev.tasks,
          reminders: countOf(r) ?? prev.reminders,
          inbox: countOf(u) ?? prev.inbox,
        }));
        currentMs.current = BASE_MS;
      } catch {
        currentMs.current = Math.min(MAX_MS, currentMs.current * 2);
      } finally {
        schedule();
      }
    };

    const schedule = () => {
      clear();
      if (!mounted.current) return;
      // Jitter so many devices don't sync up into a thundering herd.
      const jitter = currentMs.current * 0.1 * Math.random();
      timer.current = setTimeout(() => void tick(), currentMs.current + jitter);
    };

    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        currentMs.current = BASE_MS;
        void tick();
      } else {
        clear();
      }
    };

    void tick();
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      mounted.current = false;
      clear();
      sub.remove();
    };
  }, [userId]);

  // A read message / completed task should clear its badge immediately, not on
  // the next 60s tick.
  useInvalidationListener('messages', () =>
    setCounts((c) => ({ ...c, inbox: Math.max(0, (c.inbox ?? 1) - 1) })),
  );

  return counts;
}
