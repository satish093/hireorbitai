import clsx from 'clsx';
import { Popover } from '../ui/Popover';
import { TONE_STYLES, sameDay, type CalEvent } from './types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m === 0 ? '00' : m < 10 ? `0${m}` : `${m}`;
  return `${h12}:${mm} ${period}`;
}

/** Build the 6×7 grid (Sunday-first) for the month containing `anchor`. */
function buildMonthGrid(anchor: Date): Date[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startDow = firstOfMonth.getDay(); // 0=Sun

  // Grid starts on the Sunday on or before the 1st
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - startDow);

  // Always render 6 rows × 7 cols = 42 cells
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

/** Single event chip — left tone strip + tinted bg, matching Week view style. */
function EventChip({
  ev,
  isSelected,
  onSelect,
}: {
  ev: CalEvent;
  isSelected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const tone = TONE_STYLES[ev.tone];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(ev.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          onSelect(ev.id);
        }
      }}
      className={clsx(
        'relative flex items-center text-[11px] rounded-md border pl-2.5 pr-1 py-0.5 mb-0.5 cursor-pointer overflow-hidden truncate transition-shadow hover:shadow-sm',
        isSelected
          ? 'ring-2 ring-accent border-transparent bg-accent-soft'
          : `${tone.bg} ${tone.border}`,
      )}
    >
      {/* Left tone strip — matches WeekView's absolute left bar */}
      <span className={clsx('absolute left-0 top-0 bottom-0 w-1 rounded-l-md', tone.bar)} />
      <span className="truncate text-ink">{ev.title}</span>
      <span className="ml-auto shrink-0 font-mono text-muted hidden sm:inline pl-1">
        {fmtTime(ev.start)}
      </span>
    </div>
  );
}

export function MonthView({
  anchor,
  events,
  selectedId,
  onSelect,
  onAnchor,
}: {
  anchor: Date;
  events: CalEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnchor: (d: Date) => void;
}): JSX.Element {
  const today = new Date();
  const anchorMonth = anchor.getMonth();
  const cells = buildMonthGrid(anchor);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* ── WEEKDAY HEADER ── */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[10px] text-muted uppercase tracking-wide py-2 select-none"
          >
            {label}
          </div>
        ))}
      </div>

      {/* ── DAY CELLS ── */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          const isCurrentMonth = day.getMonth() === anchorMonth;
          const isToday = sameDay(day, today);

          // Events on this cell day, sorted by start time
          const dayEvents = events
            .filter((e) => sameDay(new Date(e.start), day))
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

          const visible = dayEvents.slice(0, MAX_CHIPS);
          const overflow = dayEvents.length - visible.length;

          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div
              key={idx}
              className={clsx(
                'min-h-[104px] border-t border-l border-border p-1.5 cursor-pointer transition-colors hover:bg-hover/50',
                isWeekend && isCurrentMonth && 'bg-bg-sunken/40',
              )}
              onClick={() => onAnchor(day)}
            >
              {/* Cell content — dimmed at 55% opacity for spillover days */}
              <div className={clsx(!isCurrentMonth && 'opacity-55')}>
                {/* Day number */}
                <div className="flex items-center justify-start mb-1">
                  {isToday ? (
                    <span className="font-mono text-[12px] font-semibold bg-accent text-white rounded-full w-6 h-6 grid place-items-center select-none">
                      {day.getDate()}
                    </span>
                  ) : (
                    <span
                      className={clsx(
                        'font-mono text-[12px] w-6 h-6 grid place-items-center select-none',
                        isCurrentMonth ? 'text-ink' : 'text-faint',
                      )}
                    >
                      {day.getDate()}
                    </span>
                  )}
                </div>

                {/* Event chips */}
                {visible.map((ev) => (
                  <EventChip
                    key={ev.id}
                    ev={ev}
                    isSelected={ev.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}

                {/* Overflow — Popover listing all events for the day */}
                {overflow > 0 && (
                  <Popover
                    button={(open) => (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                        }}
                        className={clsx(
                          'block text-[11px] text-accent px-1 py-0.5 rounded cursor-pointer select-none',
                          open ? 'bg-accent-soft' : 'hover:bg-hover',
                        )}
                      >
                        +{overflow} more
                      </span>
                    )}
                  >
                    {(close) => (
                      <div className="flex flex-col gap-0.5 py-1">
                        {dayEvents.map((ev) => {
                          const tone = TONE_STYLES[ev.tone];
                          return (
                            <div
                              key={ev.id}
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelect(ev.id);
                                close();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  onSelect(ev.id);
                                  close();
                                }
                              }}
                              className={clsx(
                                'relative flex items-center gap-2 text-[12px] rounded px-2 py-1.5 cursor-pointer truncate',
                                ev.id === selectedId ? 'bg-accent-soft' : 'hover:bg-hover',
                              )}
                            >
                              <span
                                className={clsx('shrink-0 w-1.5 h-1.5 rounded-full', tone.dot)}
                              />
                              <span className="truncate text-ink flex-1">{ev.title}</span>
                              <span className="font-mono text-muted shrink-0 text-[11px]">
                                {fmtTime(ev.start)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Popover>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
