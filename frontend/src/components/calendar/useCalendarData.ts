import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import toast from 'react-hot-toast';
import type { CalEvent } from './types';

interface RawInterview {
  id: string;
  type?: string | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  interviewer?: string | null;
  meeting_url?: string | null;
  is_mock?: boolean;
  status?: string | null;
  match_score?: number | null;
  consultant?: { user?: { full_name?: string | null } | null } | null;
}
interface RawReminder {
  id: string;
  title?: string | null;
  due_at?: string | null;
  status?: string | null;
}

const DAY = 86_400_000;

/**
 * Loads interviews + reminders into a unified CalEvent[] for a window around
 * the anchor date (wide enough to cover day/week/month/agenda). Uses an
 * alive-flag so a StrictMode remount can't blank the initial load.
 */
export function useCalendarData(anchor: Date) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // Re-fetch when the anchor's month changes (covers paging across views).
  const monthKey = `${anchor.getFullYear()}-${anchor.getMonth()}`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const from = new Date(anchor.getTime() - 10 * DAY).toISOString();
    const to = new Date(anchor.getTime() + 50 * DAY).toISOString();
    Promise.all([
      api.get(`/interviews?from=${from}&to=${to}`).catch(() => ({ data: [] })),
      api.get('/reminders').catch(() => ({ data: [] })),
    ])
      .then(([iRes, rRes]) => {
        if (!alive) return;
        const interviews: CalEvent[] = (iRes.data ?? [])
          .filter((i: RawInterview) => i.scheduled_at)
          .map((i: RawInterview) => ({
            id: i.id,
            title: `${i.type ?? 'Interview'}${i.is_mock ? ' (mock)' : ''}`,
            start: i.scheduled_at as string,
            durationMin: i.duration_minutes ?? 60,
            tone: i.is_mock ? 'mock' : 'accent',
            kind: 'interview' as const,
            calendar: i.is_mock ? ('mock' as const) : ('interviews' as const),
            attendee: i.interviewer ?? i.consultant?.user?.full_name ?? null,
            meetingUrl: i.meeting_url ?? null,
            matchScore: typeof i.match_score === 'number' ? Math.round(i.match_score) : null,
            status: i.status ?? null,
          }));
        const fromMs = new Date(from).getTime();
        const toMs = new Date(to).getTime();
        const reminders: CalEvent[] = (rRes.data ?? [])
          .filter((r: RawReminder) => {
            if (!r.due_at) return false;
            const t = new Date(r.due_at).getTime();
            return t >= fromMs && t <= toMs;
          })
          .map((r: RawReminder) => ({
            id: r.id,
            title: r.title ?? 'Reminder',
            start: r.due_at as string,
            durationMin: 30,
            tone: 'deadline' as const,
            kind: 'reminder' as const,
            calendar: 'deadlines' as const,
            status: r.status ?? null,
          }));
        setEvents([...interviews, ...reminders].sort((a, b) => a.start.localeCompare(b.start)));
      })
      .catch((e: any) => {
        if (alive) toast.error(e?.response?.data?.error ?? 'Failed to load calendar');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  return { events, loading };
}
