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
import { FeedbackModal } from '../components/calendar/FeedbackModal';
import { useVisibleCalendars } from '../components/calendar/useVisibleCalendars';
import type { CalView, CalendarKey } from '../components/calendar/types';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const VIEWS: { key: CalView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
];

export function Calendar({ restrictTo }: { restrictTo?: CalendarKey[] } = {}) {
  const [params, setParams] = useSearchParams();
  const view = ((params.get('view') as CalView) || 'week') as CalView;
  // anchor + selection live in the URL so view/date/event persist across reloads.
  const dateParam = params.get('date');
  const anchor = useMemo(
    () => (dateParam ? new Date(`${dateParam}T00:00:00`) : new Date()),
    [dateParam],
  );
  const selectedId = params.get('event');
  const { visible: storedVisible, toggle: toggleCalendar } = useVisibleCalendars();
  const visible = restrictTo ? new Set<CalendarKey>(restrictTo) : storedVisible;

  // Schedule / feedback modals + a reload tick so a successful mutation
  // re-fetches the calendar feed.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState<{ id: string; title?: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

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
          setAnchor(d);
          setView('day');
        }}
      />
    ) : view === 'agenda' ? (
      <AgendaView events={shown} selectedId={selectedId} onSelect={setSelected} />
    ) : (
      <WeekView anchor={anchor} events={shown} selectedId={selectedId} onSelect={setSelected} />
    );

  return (
    <Layout
      title="Calendar"
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Calendar' }]}
    >
      <PageHeader
        title={monthLabel}
        description="Interviews, mock loops, and deadlines across your week."
        action={
          <>
            <ButtonGroup>
              <ButtonGroupItem onClick={() => shift(-1)}>‹</ButtonGroupItem>
              <ButtonGroupItem onClick={() => setAnchor(new Date())}>Today</ButtonGroupItem>
              <ButtonGroupItem onClick={() => shift(1)}>›</ButtonGroupItem>
            </ButtonGroup>
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
            <Button variant="primary" onClick={() => setScheduleOpen(true)}>
              Schedule
            </Button>
          </>
        }
      />

      <div className="flex gap-5 items-start">
        <CalendarSidebar
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
                      selectedEvent.kind === 'interview'
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
    </Layout>
  );
}
