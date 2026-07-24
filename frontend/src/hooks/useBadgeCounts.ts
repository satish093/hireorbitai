import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useInvalidationListener } from './useInvalidate';

export interface BadgeCounts {
  tasks?: number;
  reminders?: number;
  inbox?: number;
}

/**
 * Polls badge counts (tasks assigned to me, pending reminders, unread messages)
 * on a 60-second interval with exponential backoff on errors and an instant
 * refresh when a realtime `message:new` event fires.
 *
 * Used by both Sidebar (desktop) and MobileBottomNav (mobile) so the logic
 * lives in one place.
 */
export function useBadgeCounts(): BadgeCounts {
  const { profile } = useAuth();
  const [counts, setCounts] = useState<BadgeCounts>({});

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const BASE_MS = 60_000;
    const MAX_MS = 5 * 60_000;
    let currentMs = BASE_MS;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) {
        schedule();
        return;
      }
      if (inflight) {
        schedule();
        return;
      }
      inflight = true;
      try {
        const [t, r, u] = await Promise.all([
          api.get('/tasks/assigned-to-me').catch(() => null),
          api.get('/reminders', { params: { status: 'PENDING' } }).catch(() => null),
          api.get('/messages/unread-count').catch(() => null),
        ]);
        if (cancelled) return;
        if (t == null || r == null || u == null) {
          currentMs = Math.min(MAX_MS, currentMs * 2);
        } else {
          currentMs = BASE_MS;
        }
        setCounts({
          tasks: (t?.data ?? []).length,
          reminders: (r?.data ?? []).length,
          inbox: u?.data?.unread ?? 0,
        });
      } finally {
        inflight = false;
        schedule();
      }
    };

    function schedule() {
      if (cancelled) return;
      const jitter = currentMs * 0.1 * Math.random();
      timer = setTimeout(tick, currentMs + jitter);
    }

    void tick();

    const onVisibility = () => {
      if (cancelled || document.hidden || inflight) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Instant inbox refresh when a realtime message:new arrives.
  useInvalidationListener('messages', () => {
    if (!profile) return;
    void api
      .get('/messages/unread-count')
      .then((u) => setCounts((prev) => ({ ...prev, inbox: u?.data?.unread ?? prev.inbox })))
      .catch(() => {});
  });

  return counts;
}
