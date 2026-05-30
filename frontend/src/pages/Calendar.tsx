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
import { ScheduleModal, type EditInterview } from '../components/calendar/ScheduleModal';
import { AddReminderModal } from '../components/calendar/AddReminderModal';
import { FeedbackModal } from '../components/calendar/FeedbackModal';
import type { EventAction } from '../components/calendar/EventDetailBar';
import { useVisibleCalendars } from '../components/calendar/useVisibleCalendars';
import type { CalView, CalendarKey, CalEvent } from '../components/calendar/types';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import { useRealtime } from '../hooks/useRealtime';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Date → local "YYYY-MM-DDTHH:mm" for the schedule modal's DateTimePicker. */
const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATUS_FOR: Record<Exclude<EventAction, 'reschedule'>, string> = {
  complete: 'COMPLETED',
  noshow: 'NO_SHOW',
  cancel: 'CANCELLED',
};

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
  // Day view is available in both modes so clicking a date in the month/agenda
  // can drill into that day.
  const VIEWS = VIEW_META;

  const [params, setParams] = useSearchParams();
  // Default to agenda — best on mobile; readable on desktop too.
  const rawView = ((params.get('view') as CalView) || 'agenda') as CalView;
  const view = rawView;
  const dateParam = params.get('date');
  const anchor = useMemo(
    () => (dateParam ? new Date(`${dateParam}T00:00:00`) : new Date()),
    [dateParam],
  );
  const selectedId = params.get('event');
  const { visible: storedVisible, toggle: toggleCalendar } = useVisibleCalendars();
  const visible = restrictTo ? new Set<CalendarKey>(restrictTo) : storedVisible;

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [createAt, setCreateAt] = useState<Date | null>(null);
  const [editInterview, setEditInterview] = useState<EditInterview | null>(null);
  const [addFor, setAddFor] = useState<Date | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<{ id: string; title?: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const { events, loading, mutateLocal, reload } = useCalendarData(anchor, reloadTick);
  const shown = events.filter((e) => visible.has(e.calendar));
  const selectedEvent = shown.find((e) => e.id === selectedId) ?? null;

  // Live sync: a mutation here or in another tab (SSE) refetches this surface.
  useRealtime({ 'interview:changed': () => setReloadTick((t) => t + 1) });
  useInvalidationListener('interviews', () => setReloadTick((t) => t + 1));

  // Optimistic drag-to-reschedule.
  function reschedule(ev: CalEvent, newStartIso: string) {
    mutateLocal(ev.id, { start: newStartIso });
    api
      .patch(`/interviews/${ev.id}`, { scheduled_at: newStartIso })
      .then(() => {
        toast.success('Interview moved');
        invalidate('interviews');
      })
      .catch((e: any) => {
        reload();
        toast.error(e?.response?.data?.error ?? 'Could not reschedule');
      });
  }

  // Open the schedule modal at a clicked slot.
  function openCreateAt(d: Date) {
    setEditInterview(null);
    setCreateAt(d);
    setScheduleOpen(true);
  }

  // Quick actions on the selected interview.
  function runAction(a: EventAction) {
    if (!selectedEvent) return;
    if (a === 'reschedule') {
      setCreateAt(null);
      setEditInterview({
        id: selectedEvent.id,
        consultant_id: selectedEvent.consultantId ?? null,
        consultant_name: selectedEvent.consultantName ?? selectedEvent.attendee ?? null,
        type: selectedEvent.interviewType ?? null,
        scheduled_at: selectedEvent.start,
        interviewer: selectedEvent.interviewer ?? null,
        meeting_url: selectedEvent.meetingUrl ?? null,
      });
      setScheduleOpen(true);
      return;
    }
    const status = STATUS_FOR[a];
    mutateLocal(selectedEvent.id, { status });
    api
      .patch(`/interviews/${selectedEvent.id}`, { status })
      .then(() => {
        toast.success(`Marked ${status.toLowerCase().replace('_', ' ')}`);
        invalidate('interviews');
        setSelected(null);
      })
      .catch((e: any) => {
        reload();
        toast.error(e?.response?.data?.error ?? 'Could not update');
      });
  }

  function closeSchedule() {
    setScheduleOpen(false);
    setCreateAt(null);
    setEditInterview(null);
  }

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
      <DayView
        anchor={anchor}
        events={shown}
        selectedId={selectedId}
        onSelect={setSelected}
        onReschedule={isInterviews ? reschedule : undefined}
        onCreateAt={isInterviews ? openCreateAt : undefined}
      />
    ) : view === 'month' ? (
      <MonthView
        anchor={anchor}
        events={shown}
        selectedId={selectedId}
        onSelect={setSelected}
        onAnchor={(d) => {
          // Clicking a date just moves the anchor — it does not change the view.
          setAnchor(d);
        }}
      />
    ) : view === 'agenda' ? (
      <AgendaView anchor={anchor} events={shown} selectedId={selectedId} onSelect={setSelected} />
    ) : (
      <WeekView
        anchor={anchor}
        events={shown}
        selectedId={selectedId}
        onSelect={setSelected}
        onReschedule={isInterviews ? reschedule : undefined}
        onCreateAt={isInterviews ? openCreateAt : undefined}
      />
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
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditInterview(null);
                    setCreateAt(null);
                    setScheduleOpen(true);
                  }}
                >
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
      {/* Mobile view switcher — inline (the page no longer renders its own
          fixed bottom bar, which used to collide with the global MobileBottomNav). */}
      <div className="md:hidden mb-3">
        <ButtonGroup>
          {VIEWS.map((v) => (
            <ButtonGroupItem key={v.key} pressed={view === v.key} onClick={() => setView(v.key)}>
              {v.label}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      {/* pb on mobile clears the floating FAB + the global bottom nav */}
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
                    onAction={
                      isInterviews && selectedEvent.kind === 'interview' ? runAction : undefined
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile FAB ───────────────────────────────────────────────
          Sits ABOVE the global MobileBottomNav (58px + safe area), not above a
          calendar-local bar (removed). z-30 keeps it below modals/sheets. */}
      <button
        style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}
        className="md:hidden fixed right-5 w-14 h-14 rounded-full bg-accent text-white shadow-xl z-30 flex items-center justify-center text-3xl font-light leading-none active:scale-95 transition-transform"
        onClick={() => {
          if (isInterviews) {
            setEditInterview(null);
            setCreateAt(null);
            setScheduleOpen(true);
          } else {
            setAddFor(anchor);
          }
        }}
        aria-label={isInterviews ? 'Schedule interview' : 'Add reminder'}
      >
        +
      </button>

      {/* (The calendar-local fixed bottom tab bar was removed — it collided with
          the global MobileBottomNav. The view switcher is now the inline
          segmented control above the calendar body.) */}

      {/* Modals */}
      {isInterviews ? (
        <>
          <ScheduleModal
            open={scheduleOpen}
            mock={false}
            onClose={closeSchedule}
            onScheduled={() => setReloadTick((t) => t + 1)}
            defaultStartLocal={createAt ? toLocalInput(createAt) : undefined}
            editInterview={editInterview}
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
