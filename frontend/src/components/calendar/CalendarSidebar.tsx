import { useEffect, useState } from 'react';
import { Button } from '../Button';
// Avatar is imported for potential future attendee display; kept per contract.
import { Avatar } from '../TaskBits'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { CALENDARS, TONE_STYLES, sameDay, type CalEvent, type CalendarKey } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** First weekday (0=Sun) of the given month. */
function firstWeekday(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function addMonths(d: Date, delta: number): Date {
  const next = new Date(d);
  next.setDate(1);
  next.setMonth(next.getMonth() + delta);
  return next;
}

function formatCountdown(nowMs: number, startMs: number): string {
  const diffMs = startMs - nowMs;
  if (diffMs <= 0) return 'NOW';
  const totalMin = Math.floor(diffMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `IN ${m}m`;
  if (m === 0) return `IN ${h}h`;
  return `IN ${h}h ${m}m`;
}

function formatEventTime(start: Date): string {
  return start.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// CalendarSidebar
// ---------------------------------------------------------------------------

export function CalendarSidebar({
  anchor,
  onAnchor,
  events,
  visible,
  onToggleCalendar,
  onSelectEvent,
  showCalendars = true,
}: {
  anchor: Date;
  onAnchor: (d: Date) => void;
  events: CalEvent[];
  visible: Set<CalendarKey>;
  onToggleCalendar: (k: CalendarKey) => void;
  onSelectEvent: (id: string) => void;
  /** Hidden in restricted mode (e.g. Interviews wrapper) where the visible
   *  set is fixed and the toggles would be inert. */
  showCalendars?: boolean;
}): JSX.Element {
  // Tick state for countdown recompute every 60s.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const totalDays = daysInMonth(year, month);
  const leadingBlanks = firstWeekday(year, month); // 0–6

  const today = new Date();

  // Event dot lookup: set of day-of-month values that have ≥1 event this month.
  const daysWithEvents = new Set<number>();
  for (const ev of events) {
    const d = new Date(ev.start);
    if (d.getFullYear() === year && d.getMonth() === month) {
      daysWithEvents.add(d.getDate());
    }
  }

  // Up-next: nearest future event from now.
  const nowMs = Date.now();
  // Suppress unused-variable warning — tick is consumed to force rerender.
  void tick;
  const upNext =
    events
      .filter((ev) => new Date(ev.start).getTime() > nowMs)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;

  // Build day cells (blanks + days).
  const cells: Array<{ day: number } | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => ({ day: i + 1 })),
  ];

  const monthLabel = anchor.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="w-full md:w-[260px] shrink-0 space-y-4">
      {/* ------------------------------------------------------------------ */}
      {/* 1. Mini month picker                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-surface rounded-xl border border-border p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Previous month"
            onClick={() => onAnchor(addMonths(anchor, -1))}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M9 11L5 7l4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>

          <span className="text-sm font-semibold text-ink">{monthLabel}</span>

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Next month"
            onClick={() => onAnchor(addMonths(anchor, 1))}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M5 3l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        </div>

        {/* Weekday header row */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAY_LETTERS.map((letter, i) => (
            <div
              key={i}
              className="flex items-center justify-center text-[10px] text-muted font-medium h-6"
            >
              {letter}
            </div>
          ))}
        </div>

        {/* Day cells grid */}
        <div className="grid grid-cols-7 gap-y-0.5">
          {cells.map((cell, idx) => {
            if (!cell) {
              // Leading blank
              return <div key={`blank-${idx}`} className="w-8 h-8" />;
            }

            const { day } = cell;
            const cellDate = new Date(year, month, day);
            const isToday = sameDay(cellDate, today);
            const isSelected = sameDay(cellDate, anchor);
            const hasDot = daysWithEvents.has(day);

            return (
              <div
                key={day}
                className="flex flex-col items-center justify-center cursor-pointer select-none"
                onClick={() => onAnchor(cellDate)}
              >
                <div
                  className={[
                    'w-8 h-8 grid place-items-center rounded-full text-[12px] font-medium transition-colors',
                    isToday
                      ? 'bg-accent text-white dark:text-bg font-semibold'
                      : isSelected
                        ? 'ring-2 ring-accent text-accent'
                        : 'text-ink hover:bg-hover',
                  ].join(' ')}
                >
                  {day}
                </div>
                {/* Event dot */}
                {hasDot && <div className="w-1 h-1 rounded-full bg-accent mt-0.5" />}
                {/* Placeholder to keep row height stable when no dot */}
                {!hasDot && <div className="w-1 h-1 mt-0.5 opacity-0" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Up Next widget                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div>
        {upNext === null ? (
          <p className="text-[12px] text-muted px-1">Nothing upcoming.</p>
        ) : (
          <div className="bg-accent-soft rounded-xl p-3 space-y-1.5">
            {/* Countdown */}
            <span className="text-[11px] font-mono text-accent tracking-wide">
              {formatCountdown(nowMs, new Date(upNext.start).getTime())}
            </span>

            {/* Title */}
            <p className="text-[13px] font-semibold text-ink leading-snug">{upNext.title}</p>

            {/* Time */}
            <p className="text-[12px] text-ink">{formatEventTime(new Date(upNext.start))}</p>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-0.5">
              {upNext.meetingUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(upNext.meetingUrl!, '_blank', 'noopener,noreferrer')}
                >
                  Join Zoom
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onSelectEvent(upNext.id)}>
                Brief
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Calendars list                                                   */}
      {/* ------------------------------------------------------------------ */}
      {showCalendars && (
        <div className="space-y-1">
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted px-1 mb-2">
            Calendars
          </p>

          {CALENDARS.map((cal) => {
            const checked = visible.has(cal.key);
            const dotClass = TONE_STYLES[cal.tone].dot;

            return (
              <div
                key={cal.key}
                className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer px-1 py-0.5 rounded-md hover:bg-hover transition-colors"
                role="checkbox"
                aria-checked={checked}
                tabIndex={0}
                onClick={() => onToggleCalendar(cal.key)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onToggleCalendar(cal.key);
                  }
                }}
              >
                {/* Custom checkbox */}
                <span
                  className={[
                    'w-3.5 h-3.5 rounded-[3px] border shrink-0 grid place-items-center transition-colors',
                    checked ? `${dotClass} border-transparent` : 'border-border bg-surface',
                  ].join(' ')}
                >
                  {checked && (
                    <svg width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden>
                      <path
                        d="M1 3.5L3.5 6L8 1"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>

                {cal.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
