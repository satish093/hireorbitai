import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Avatar } from '../TaskBits';
import {
  HOUR_HEIGHT,
  DAY_START,
  DAY_END,
  GUTTER_W,
  TONE_STYLES,
  layoutDay,
  mondayOf,
  sameDay,
  type CalEvent,
} from './types';

// Hours visible in the grid (DAY_START..DAY_END inclusive as labels)
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);
const GRID_HEIGHT = (DAY_END - DAY_START) * HOUR_HEIGHT;

function hourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

export function WeekView({
  anchor,
  events,
  selectedId,
  onSelect,
}: {
  anchor: Date;
  events: CalEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Build Mon–Fri of this week
  const monday = mondayOf(anchor);
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const nowHour = now.getHours();
  const nowMin = now.getMinutes();
  const nowTop = (nowHour + nowMin / 60 - DAY_START) * HOUR_HEIGHT;
  const nowInRange = nowHour >= DAY_START && nowHour < DAY_END;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-x-auto" tabIndex={0}>
      {/* ── DAY HEADER ── */}
      <div className="flex border-b border-border sticky top-0 bg-surface z-10">
        {/* Gutter spacer */}
        <div style={{ width: GUTTER_W, minWidth: GUTTER_W }} className="shrink-0" />
        {days.map((day) => {
          const isToday = sameDay(day, now);
          return (
            <div
              key={day.toISOString()}
              className="flex-1 min-w-[120px] flex flex-col items-center justify-center py-2 gap-1"
            >
              <span
                className={clsx(
                  'text-[10px] uppercase tracking-wider font-medium',
                  isToday ? 'text-accent' : 'text-muted',
                )}
              >
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </span>
              <span
                className={clsx(
                  'text-[13px] font-mono grid place-items-center w-7 h-7 rounded-full',
                  isToday ? 'bg-accent text-white dark:text-bg font-semibold' : 'text-ink',
                )}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── GRID BODY ── */}
      <div className="flex" style={{ height: GRID_HEIGHT }}>
        {/* Time gutter */}
        <div className="relative shrink-0" style={{ width: GUTTER_W, minWidth: GUTTER_W }}>
          {HOURS.map((h) => {
            const topPx = (h - DAY_START) * HOUR_HEIGHT;
            // Don't render a label at DAY_END — it would overflow
            if (h === DAY_END) return null;
            return (
              <span
                key={h}
                className="absolute right-2 text-[10px] font-mono text-muted select-none"
                style={{ top: topPx - 7 }}
              >
                {hourLabel(h)}
              </span>
            );
          })}
        </div>

        {/* Day columns */}
        {days.map((day) => {
          const isToday = sameDay(day, now);
          const dayEvents = events.filter((e) => sameDay(new Date(e.start), day));
          const positioned = layoutDay(dayEvents);
          const hasConflict = positioned.some((p) => p.conflict);

          return (
            <div
              key={day.toISOString()}
              className={clsx('relative flex-1 min-w-[120px]', isToday && 'bg-accent-soft')}
            >
              {/* Horizontal hour gridlines */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-border"
                  style={{ top: (h - DAY_START) * HOUR_HEIGHT }}
                />
              ))}

              {/* Conflict pill */}
              {hasConflict && (
                <div className="absolute top-1 right-1 z-20 text-[9px] font-mono text-danger bg-danger-soft rounded px-1 leading-4 pointer-events-none">
                  ⚠ CONFLICT
                </div>
              )}

              {/* Now-line (today only) */}
              {isToday && nowInRange && (
                <div
                  className="absolute left-0 right-0 z-10 pointer-events-none"
                  style={{ top: nowTop }}
                >
                  {/* Dot */}
                  <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-danger" />
                  {/* Line */}
                  <div className="h-[2px] bg-danger w-full" />
                </div>
              )}

              {/* Events */}
              {positioned.map(({ ev, col, cols, conflict: _conflict }) => {
                const startDate = new Date(ev.start);
                const startHour = startDate.getHours();
                const startMin = startDate.getMinutes();

                const topRaw = (startHour + startMin / 60 - DAY_START) * HOUR_HEIGHT;
                const topPx = Math.max(0, topRaw);
                const heightPx = Math.max(20, (ev.durationMin / 60) * HOUR_HEIGHT - 2);

                const leftPct = (col / cols) * 100;
                const widthCalc = `calc(${100 / cols}% - 4px)`;

                const tone = TONE_STYLES[ev.tone];
                const isSelected = ev.id === selectedId;

                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onSelect(ev.id)}
                    className={clsx(
                      'absolute overflow-hidden rounded-lg border cursor-pointer text-left transition-shadow',
                      tone.bg,
                      isSelected
                        ? 'ring-2 ring-accent border-transparent z-10 shadow-sm'
                        : `${tone.border} hover:shadow-sm`,
                    )}
                    style={{
                      top: topPx,
                      height: heightPx,
                      left: `${leftPct}%`,
                      width: widthCalc,
                      marginLeft: 2,
                    }}
                  >
                    {/* Left tone strip */}
                    <div
                      className={clsx('absolute left-0 top-0 bottom-0 w-1 rounded-l-lg', tone.bar)}
                    />

                    {/* Content */}
                    <div className="pl-2 pr-1 pt-0.5 pb-0.5 h-full flex flex-col justify-start overflow-hidden">
                      {/* Title */}
                      <span className="text-[11px] font-medium text-ink truncate leading-tight">
                        {ev.title}
                      </span>

                      {/* Attendee — show if height > 28 */}
                      {heightPx > 28 && ev.attendee && (
                        <span className="text-[10px] text-muted truncate leading-tight">
                          {ev.attendee}
                        </span>
                      )}

                      {/* Avatar + meta row — show if height > 56 */}
                      {heightPx > 56 && (
                        <div className="flex items-center gap-1 mt-auto overflow-hidden">
                          <Avatar name={ev.attendee} size={16} />
                          {ev.status && (
                            <span className="text-[9px] font-mono text-muted truncate">
                              {ev.status}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
