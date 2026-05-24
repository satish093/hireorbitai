import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { ButtonGroup, ButtonGroupItem } from '../components/ButtonGroup';
import { SkeletonCard } from '../components/Skeleton';
import { useCalendarData } from '../components/calendar/useCalendarData';
import { CalendarSidebar } from '../components/calendar/CalendarSidebar';
import { WeekView } from '../components/calendar/WeekView';
import { DayView } from '../components/calendar/DayView';
import { MonthView } from '../components/calendar/MonthView';
import { AgendaView } from '../components/calendar/AgendaView';
import { EventDetailBar } from '../components/calendar/EventDetailBar';
import { ScheduleModal } from '../components/calendar/ScheduleModal';
import { AddReminderModal } from '../components/calendar/AddReminderModal';
import { FeedbackModal } from '../components/calendar/FeedbackModal';
import { useVisibleCalendars } from '../components/calendar/useVisibleCalendars';
import type { CalView, CalendarKey } from '../components/calendar/types';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Icons for the mobile bottom tab bar
const VIEW_META: { key: CalView; label: string; icon: JSX.Element }[] = [
  {
    key: 'day',
    label: 'Day',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6v8M6 10h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'week',
    label: 'Week',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="5" width="2.5" height="10" rx="1" fill="currentColor" />
        <rect x="7.5" y="5" width="2.5" height="10" rx="1" fill="currentColor" />
        <rect x="12" y="5" width="2.5" height="10" rx="1" fill="currentColor" />
        <rect x="16" y="5" width="1.5" height="10" rx="0.75" fill="currentColor" opacity="0.4" />
      </svg>
    ),
  },
  {
    key: 'month',
    label: 'Month',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 7.5h14M7.5 7.5v9.5M12.5 7.5v9.5" stroke="currentColor" strokeWidth="1" />
      </svg>
    ),
  },
  {
    key: 'agenda',
    label: 'Agenda',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M4 6h12M4 10h12M4 14h8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

/**
 * Shared scheduling surface, two modes:
 *  - `planner` (default, the /calendar page): no Day view; the primary action
 *    adds a personal item to a date (a reminder); interviews are visible but
 *    read-only — you can't schedule them here.
 *  - `interviews` (the Interviews wrapper): the full scheduler — Day view +
 *    "Schedule" opens the interview modal + per-interview feedback.
 */
export function Calendar({
  restrictTo,
  mode = 'planner',
}: {
  restrictTo?: CalendarKey[];
  mode?: 'planner' | 'interviews';
} = {}) {
  const isInterviews = mode === 'interviews';
  const VIEWS = isInterviews ? VIEW_META : VIEW_META.filter((v) => v.key !== 'day');

  const [params, setParams] = useSearchParams();
  // Default to agenda — best on mobile; readable on desktop too.
  const rawView = ((params.get('view') as CalView) || 'agenda') as CalView;
  const view = !isInterviews && rawView === 'day' ? 'week' : rawView;
  const dateParam = params.get('date');
  const anchor = useMemo(
    () => (dateParam ? new Date(`${dateParam}T00:00:00`) : new Date()),
    [dateParam],
  );
  const selectedId = params.get('event');
  const { visible: storedVisible, toggle: toggleCalendar } = useVisibleCalendars();
  const visible = restrictTo ? new Set<CalendarKey>(restrictTo) : storedVisible;

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [addFor, setAddFor] = useState<Date | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<{ id: string; title?: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const { events, loading } = useCalendarData(anchor, reloadTick);
  const shown = events.filter((e) => visible.has(e.calendar));
  const selectedEvent = shown.find((e) => e.id === selectedId) ?? null;

  const setParam = (key: string, value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  // Switching views closes the detail bar so it doesn't linger.
  const setView = (v: CalView) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('view', v);
      next.delete('event');
      return next;
    });

  const setAnchor = (d: Date) => setParam('date', ymd(d));
  const setSelected = (id: string | null) => setParam('event', id);

  function shift(dir: -1 | 1) {
    const d = new Date(anchor);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'month') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * 7);
    setAnchor(d);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelected(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const activeView =
    view === 'day' ? (
      <DayView anchor={anchor} events={shown} selectedId={selectedId} onSelect={setSelected} />
    ) : view === 'month' ? (
      <MonthView
        anchor={anchor}
        events={shown}
        selectedId={selectedId}
        onSelect={setSelected}
        onAnchor={(d) => {
          if (isInterviews) {
            setAnchor(d);
            setView('day');
          } else {
            setAnchor(d);
            setAddFor(d);
          }
        }}
      />
    ) : view === 'agenda' ? (
      <AgendaView events={shown} selectedId={selectedId} onSelect={setSelected} />
    ) : (
      <WeekView anchor={anchor} events={shown} selectedId={selectedId} onSelect={setSelected} />
    );

  return (
    <Layout
      title={isInterviews ? 'Interviews' : 'Calendar'}
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: isInterviews ? 'Interviews' : 'Calendar' },
      ]}
    >
      <PageHeader
        title={monthLabel}
        description={
          isInterviews
            ? 'Schedule and review interviews and mock loops.'
            : 'Your interviews and deadlines — add personal items to any date.'
        }
        action={
          <>
            {/* Navigation — visible on all screens */}
            <ButtonGroup>
              <ButtonGroupItem onClick={() => shift(-1)}>‹</ButtonGroupItem>
              <ButtonGroupItem onClick={() => setAnchor(new Date())}>Today</ButtonGroupItem>
              <ButtonGroupItem onClick={() => shift(1)}>›</ButtonGroupItem>
            </ButtonGroup>

            {/* View switcher — desktop only; mobile uses the fixed bottom tab bar */}
            <div className="hidden md:block">
              <ButtonGroup>
                {VIEWS.map((v) => (
                  <ButtonGroupItem
                    key={v.key}
                    pressed={view === v.key}
                    onClick={() => setView(v.key)}
                  >
                    {v.label}
                  </ButtonGroupItem>
                ))}
              </ButtonGroup>
            </div>

            {/* Primary action — desktop only; mobile uses the FAB */}
            <div className="hidden md:block">
              {isInterviews ? (
                <Button variant="primary" onClick={() => setScheduleOpen(true)}>
                  Schedule
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setAddFor(anchor)}>
                  Add
                </Button>
              )}
            </div>
          </>
        }
      />

      {/* ── Sidebar + main view ──────────────────────────────────── */}
      {/* pb-24 on mobile reserves space above the fixed bottom tab bar */}
      <div className="flex flex-col md:flex-row md:gap-5 md:items-start pb-24 md:pb-0">
        {/* Sidebar: hidden on mobile — use bottom tab bar + FAB instead */}
        <div className="hidden md:block">
          <CalendarSidebar
            anchor={anchor}
            onAnchor={setAnchor}
            events={shown}
            visible={visible}
            onToggleCalendar={toggleCalendar}
            onSelectEvent={setSelected}
            showCalendars={!restrictTo}
          />
        </div>

        <div className="w-full min-w-0 flex-1">
          {loading ? (
            <SkeletonCard lines={8} />
          ) : (
            <div className="relative w-full">
              {activeView}
              {selectedEvent && (
                <div className="sticky bottom-0 z-10 mt-2 rounded-xl overflow-hidden border border-border shadow-md">
                  <EventDetailBar
                    event={selectedEvent}
                    onClose={() => setSelected(null)}
                    onFeedback={
                      isInterviews && selectedEvent.kind === 'interview'
                        ? () => setFeedbackFor({ id: selectedEvent.id, title: selectedEvent.title })
                        : undefined
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile FAB ───────────────────────────────────────────── */}
      <button
        className="md:hidden fixed bottom-[80px] right-5 w-14 h-14 rounded-full bg-accent text-white shadow-xl z-40 flex items-center justify-center text-3xl font-light leading-none active:scale-95 transition-transform"
        onClick={() => (isInterviews ? setScheduleOpen(true) : setAddFor(anchor))}
        aria-label={isInterviews ? 'Schedule interview' : 'Add reminder'}
      >
        +
      </button>

      {/* ── Mobile bottom tab bar ────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border safe-pb"
        aria-label="Calendar views"
      >
        <div className="flex h-16">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={clsx(
                'flex-1 flex flex-col items-center justify-center gap-1 transition-colors',
                view === v.key ? 'text-accent' : 'text-muted hover:text-ink',
              )}
            >
              {v.icon}
              <span className="text-[10px] font-medium tracking-wide">{v.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Modals */}
      {isInterviews ? (
        <>
          <ScheduleModal
            open={scheduleOpen}
            mock={false}
            onClose={() => setScheduleOpen(false)}
            onScheduled={() => setReloadTick((t) => t + 1)}
          />
          <FeedbackModal
            interview={feedbackFor}
            onClose={() => setFeedbackFor(null)}
            onSaved={() => setReloadTick((t) => t + 1)}
          />
        </>
      ) : (
        <AddReminderModal
          open={addFor !== null}
          defaultDate={addFor ?? anchor}
          onClose={() => setAddFor(null)}
          onAdded={() => setReloadTick((t) => t + 1)}
        />
      )}
    </Layout>
  );
}
