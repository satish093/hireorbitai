import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

const ALL_VIEWS: { key: CalView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
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
  const VIEWS = isInterviews ? ALL_VIEWS : ALL_VIEWS.filter((v) => v.key !== 'day');

  const [params, setParams] = useSearchParams();
  // Planner has no Day view — fall back to Week if the URL asks for it.
  const rawView = ((params.get('view') as CalView) || 'week') as CalView;
  const view = !isInterviews && rawView === 'day' ? 'week' : rawView;
  // anchor + selection live in the URL so view/date/event persist across reloads.
  const dateParam = params.get('date');
  const anchor = useMemo(
    () => (dateParam ? new Date(`${dateParam}T00:00:00`) : new Date()),
    [dateParam],
  );
  const selectedId = params.get('event');
  const { visible: storedVisible, toggle: toggleCalendar } = useVisibleCalendars();
  const visible = restrictTo ? new Set<CalendarKey>(restrictTo) : storedVisible;

  // Schedule (interviews) / Add (planner) / feedback modals + a reload tick so
  // a successful mutation re-fetches the calendar feed.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [addFor, setAddFor] = useState<Date | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<{ id: string; title?: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { events, loading } = useCalendarData(anchor, reloadTick);
  const shown = events.filter((e) => visible.has(e.calendar));
  const selectedEvent = shown.find((e) => e.id === selectedId) ?? null;

  // Functional updater so callbacks never close over a stale `params`.
  const setParam = (key: string, value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const setView = (v: CalView) => setParam('view', v);
  const setAnchor = (d: Date) => setParam('date', ymd(d));
  const setSelected = (id: string | null) => setParam('event', id);

  function shift(dir: -1 | 1) {
    const d = new Date(anchor);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'month') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * 7);
    setAnchor(d);
  }
  // Esc closes the detail bar.
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
          // Interviews: drill into the day. Planner: set something on that date.
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
            {/* Sidebar toggle — mobile only */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-hover border border-border text-muted shrink-0"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M2 4h12M2 8h12M2 12h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            {/* Nav: prev / today / next */}
            <ButtonGroup>
              <ButtonGroupItem onClick={() => shift(-1)}>‹</ButtonGroupItem>
              <ButtonGroupItem onClick={() => setAnchor(new Date())}>Today</ButtonGroupItem>
              <ButtonGroupItem onClick={() => shift(1)}>›</ButtonGroupItem>
            </ButtonGroup>

            {/* View selector — native select on mobile, button group on md+ */}
            <select
              className="md:hidden text-sm border border-border rounded-lg px-2 py-1.5 bg-surface text-ink"
              value={view}
              onChange={(e) => setView(e.target.value as CalView)}
            >
              {VIEWS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
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

            {isInterviews ? (
              <Button variant="primary" onClick={() => setScheduleOpen(true)}>
                Schedule
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setAddFor(anchor)}>
                Add
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col md:flex-row gap-5 items-start">
        <CalendarSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          anchor={anchor}
          onAnchor={setAnchor}
          events={shown}
          visible={visible}
          onToggleCalendar={toggleCalendar}
          onSelectEvent={setSelected}
          showCalendars={!restrictTo}
        />
        <div className="min-w-0 flex-1">
          {loading ? (
            <SkeletonCard lines={8} />
          ) : (
            <div className="relative">
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
