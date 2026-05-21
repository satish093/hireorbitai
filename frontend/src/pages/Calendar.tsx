import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import clsx from 'clsx';
import toast from 'react-hot-toast';

interface CalEvent {
  id: string;
  title: string;
  when: string;
  kind: 'interview' | 'reminder';
  status: string;
}

/**
 * Day grid for the current month, plus a detail list below for the SELECTED
 * day (defaults to today). The page header advertises "Click a date to
 * filter" — clicking a cell selects that day, the detail list follows.
 *
 * State:
 *   - month         which month is rendered in the grid
 *   - selectedDate  which day is shown in the detail list (or null = today)
 *   - selecting a day OUTSIDE the visible month also flips `month` so the
 *     grid stays in sync with the selection
 */
export function Calendar() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [month, setMonth] = useState(() => new Date());
  // Null = "show today by default". A real Date pins to that day.
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const start = new Date(month.getFullYear(), month.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);
    const from = start.toISOString();
    const to = end.toISOString();
    Promise.all([api.get(`/interviews?from=${from}&to=${to}`), api.get('/reminders')])
      .then(([iRes, rRes]) => {
        if (cancelled) return;
        const interviews: CalEvent[] = (iRes.data ?? []).map((i: any) => ({
          id: i.id,
          title: `${i.type ?? 'Interview'}${i.is_mock ? ' (mock)' : ''}${i.interviewer ? ` · ${i.interviewer}` : ''}`,
          when: i.scheduled_at,
          kind: 'interview',
          status: i.status,
        }));
        const reminders: CalEvent[] = (rRes.data ?? [])
          .filter((r: any) => {
            if (!r.due_at) return false;
            const d = new Date(r.due_at);
            return d >= start && d <= end;
          })
          .map((r: any) => ({
            id: r.id,
            title: r.title,
            when: r.due_at,
            kind: 'reminder',
            status: r.status,
          }));
        setEvents(
          [...interviews, ...reminders].sort((a, b) => (a.when ?? '').localeCompare(b.when ?? '')),
        );
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e?.response?.data?.error ?? 'Failed to load calendar');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const byDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of events) {
      const k = new Date(e.when).toDateString();
      (map[k] ??= []).push(e);
    }
    return map;
  }, [events]);

  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const leading = start.getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= end.getDate(); d++)
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isToday = (d: Date) =>
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  const isSelected = (d: Date) =>
    !!selectedDate &&
    d.getDate() === selectedDate.getDate() &&
    d.getMonth() === selectedDate.getMonth() &&
    d.getFullYear() === selectedDate.getFullYear();

  // The day whose events are listed in the detail panel below the grid.
  // Defaults to today; user can click any cell to override.
  const focusDate = selectedDate ?? today;
  const focusEvents = byDay[focusDate.toDateString()] ?? [];
  const customSelected = !!selectedDate && !isToday(selectedDate);

  function selectDay(d: Date) {
    // Clicking the already-selected day toggles back to "today" — gives a
    // single-click way to clear the filter without hunting for a button.
    if (isSelected(d)) {
      setSelectedDate(null);
      return;
    }
    setSelectedDate(d);
    // If the clicked day is in another month (e.g. user navigated then
    // clicked a date that landed before/after the visible month), flip the
    // grid to match. With our current cells layout this is mostly defensive.
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <Layout title="Calendar">
      <PageHeader
        title="Calendar"
        description="Interviews and reminders across the month. Click a date to filter the list below."
        action={
          <div className="inline-flex items-center gap-1 bg-surface border border-border rounded-lg p-1 shadow-sm">
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              aria-label="Previous month"
            >
              ‹
            </Button>
            <span className="text-sm font-medium text-ink min-w-[120px] text-center">
              {month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              aria-label="Next month"
            >
              ›
            </Button>
            <span className="w-px h-5 bg-hover mx-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMonth(new Date());
                setSelectedDate(null);
              }}
            >
              Today
            </Button>
          </div>
        }
      />

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-hover">
          {DOW.map((d) => (
            <div
              key={d}
              className="text-[10px] font-semibold uppercase tracking-widest text-muted px-3 py-2"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, idx) => {
            if (!d) {
              return (
                <div
                  key={`blank-${idx}`}
                  className={clsx(
                    'min-h-[110px] border-r border-b border-border p-2 bg-slate-50/40',
                    (idx + 1) % 7 === 0 && 'border-r-0',
                    idx >= cells.length - 7 && 'border-b-0',
                  )}
                />
              );
            }
            const dayEvents = byDay[d.toDateString()] ?? [];
            const sel = isSelected(d);
            const today_ = isToday(d);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => selectDay(d)}
                aria-pressed={sel}
                aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${dayEvents.length ? ` — ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ''}`}
                className={clsx(
                  'min-h-[110px] border-r border-b border-border p-2 text-left transition',
                  'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                  (idx + 1) % 7 === 0 && 'border-r-0',
                  idx >= cells.length - 7 && 'border-b-0',
                  sel ? 'bg-brand-50 ring-1 ring-inset ring-brand-300' : 'hover:bg-hover',
                )}
              >
                <div
                  className={clsx(
                    'text-xs font-semibold mb-1.5 inline-flex items-center justify-center w-6 h-6 rounded-full',
                    today_ ? 'bg-ink text-bg' : sel ? 'bg-brand-600 text-white' : 'text-ink',
                  )}
                >
                  {d.getDate()}
                </div>
                {!loading &&
                  dayEvents.slice(0, 3).map((e, ei) => (
                    <div
                      key={e.id}
                      style={{ animationDelay: `${ei * 30}ms` }}
                      className={clsx(
                        'mb-1 rounded-md px-1.5 py-0.5 border text-[11px] leading-tight animate-fade-in-up transition',
                        e.kind === 'interview'
                          ? 'bg-indigo-50 dark:bg-indigo-500/15 border-indigo-100 dark:border-indigo-500/20 text-indigo-800 dark:text-indigo-300'
                          : 'bg-amber-50 dark:bg-amber-500/15 border-amber-100 dark:border-amber-500/20 text-amber-800 dark:text-amber-300',
                      )}
                      title={`${new Date(e.when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${e.title}`}
                    >
                      <span className="font-medium">
                        {new Date(e.when).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>{' '}
                      <span className="truncate">{e.title}</span>
                    </div>
                  ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-muted mt-0.5">+{dayEvents.length - 3} more</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail list — defaults to today, follows the user's day selection. */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink">
            {customSelected
              ? focusDate.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })
              : 'Today'}
            <span className="ml-2 text-xs font-normal text-muted">
              {focusEvents.length} event{focusEvents.length === 1 ? '' : 's'}
            </span>
          </h2>
          {customSelected && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedDate(null)}>
              Clear ✕
            </Button>
          )}
        </div>
        <div className="bg-surface border border-border rounded-xl divide-y divide-border">
          {focusEvents.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted italic text-center">
              {customSelected ? 'Nothing scheduled this day.' : 'Nothing scheduled today.'}
            </div>
          ) : (
            focusEvents.map((e) => (
              <div key={e.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-16 text-xs font-mono text-muted">
                  {new Date(e.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
                <div className="flex-1 min-w-0 text-sm text-ink truncate">{e.title}</div>
                <span
                  className={clsx(
                    'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded',
                    e.kind === 'interview'
                      ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                      : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300',
                  )}
                >
                  {e.kind}
                </span>
                <StatusBadge status={e.status} />
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
