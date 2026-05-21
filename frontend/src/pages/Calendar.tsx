import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { useVisibleCalendars } from '../components/calendar/useVisibleCalendars';
import type { CalView } from '../components/calendar/types';

const VIEWS: { key: CalView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
];

export function Calendar() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = ((params.get('view') as CalView) || 'week') as CalView;
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { visible, toggle: toggleCalendar } = useVisibleCalendars();

  const { events, loading } = useCalendarData(anchor);
  const shown = events.filter((e) => visible.has(e.calendar));
  const selectedEvent = shown.find((e) => e.id === selectedId) ?? null;

  const setView = (v: CalView) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next);
  };
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
      if (e.key === 'Escape') setSelectedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const activeView =
    view === 'day' ? (
      <DayView anchor={anchor} events={shown} selectedId={selectedId} onSelect={setSelectedId} />
    ) : view === 'month' ? (
      <MonthView
        anchor={anchor}
        events={shown}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAnchor={(d) => {
          setAnchor(d);
          setView('day');
        }}
      />
    ) : view === 'agenda' ? (
      <AgendaView events={shown} selectedId={selectedId} onSelect={setSelectedId} />
    ) : (
      <WeekView anchor={anchor} events={shown} selectedId={selectedId} onSelect={setSelectedId} />
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
            <Button variant="primary" onClick={() => navigate('/interviews')}>
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
          onSelectEvent={setSelectedId}
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
                    onClose={() => setSelectedId(null)}
                    onBrief={
                      selectedEvent.kind === 'interview' ? () => navigate('/interviews') : undefined
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
