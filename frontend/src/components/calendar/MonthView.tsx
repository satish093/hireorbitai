import clsx from 'clsx';
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

          return (
            <div
              key={idx}
              className="min-h-[96px] border-t border-l border-border p-1 cursor-pointer"
              onClick={() => onAnchor(day)}
            >
              {/* Day number */}
              <div className="flex items-center justify-start mb-0.5">
                {isToday ? (
                  <span className="font-mono text-[12px] bg-ink text-bg rounded-full w-6 h-6 grid place-items-center select-none">
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
              {visible.map((ev) => {
                const tone = TONE_STYLES[ev.tone];
                const isSelected = ev.id === selectedId;

                return (
                  <div
                    key={ev.id}
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
                      'flex items-center gap-1 text-[11px] truncate rounded px-1 py-0.5 mb-0.5 cursor-pointer',
                      isSelected ? 'bg-accent-soft' : 'hover:bg-hover',
                    )}
                  >
                    <span className={clsx('shrink-0 w-1.5 h-1.5 rounded-full', tone.dot)} />
                    <span className="truncate text-ink">{ev.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-muted hidden sm:inline">
                      {fmtTime(ev.start)}
                    </span>
                  </div>
                );
              })}

              {/* Overflow */}
              {overflow > 0 && <div className="text-[11px] text-muted px-1">+{overflow} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
