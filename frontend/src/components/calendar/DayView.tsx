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
  sameDay,
  type CalEvent,
} from './types';

// Hours visible in the grid (DAY_START..DAY_END as labels)
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);
const GRID_HEIGHT = (DAY_END - DAY_START) * HOUR_HEIGHT;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m === 0 ? '00' : m < 10 ? `0${m}` : `${m}`;
  return `${h12}:${mm} ${period}`;
}

function hourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

export function DayView({
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

  const isToday = sameDay(anchor, now);
  const nowHour = now.getHours();
  const nowMin = now.getMinutes();
  const nowTop = (nowHour + nowMin / 60 - DAY_START) * HOUR_HEIGHT;
  const nowInRange = nowHour >= DAY_START && nowHour < DAY_END;

  const dayEvents = events.filter((e) => sameDay(new Date(e.start), anchor));
  const positioned = layoutDay(dayEvents);

  const weekday = anchor.toLocaleDateString('en-US', { weekday: 'long' });
  const dateLabel = anchor.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* ── HEADER ── */}
      <div className="px-4 py-3 border-b border-border flex items-baseline gap-2">
        <span className="font-mono text-sm font-semibold text-ink">{weekday}</span>
        <span className="font-mono text-xs text-muted">{dateLabel}</span>
        {isToday && (
          <span className="ml-auto text-[11px] font-mono text-accent bg-accent-soft rounded px-1.5 py-0.5">
            Today
          </span>
        )}
      </div>

      {/* ── GRID BODY ── */}
      <div className="flex" style={{ height: GRID_HEIGHT }}>
        {/* Time gutter */}
        <div
          className="relative shrink-0 border-r border-border"
          style={{ width: GUTTER_W, minWidth: GUTTER_W }}
        >
          {HOURS.map((h) => {
            if (h === DAY_END) return null;
            return (
              <span
                key={h}
                className="absolute right-2 text-[10px] font-mono text-faint select-none"
                style={{ top: (h - DAY_START) * HOUR_HEIGHT - 7 }}
              >
                {hourLabel(h)}
              </span>
            );
          })}
        </div>

        {/* Event column */}
        <div className="relative flex-1">
          {/* Horizontal hour gridlines */}
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-border"
              style={{ top: (h - DAY_START) * HOUR_HEIGHT }}
            />
          ))}

          {/* Now-line (today only) */}
          {isToday && nowInRange && (
            <div
              className="absolute left-0 right-0 z-10 pointer-events-none"
              style={{ top: nowTop }}
            >
              <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-danger" />
              <div className="h-[2px] bg-danger w-full" />
            </div>
          )}

          {/* Events */}
          {positioned.map(({ ev, col, cols }) => {
            const startDate = new Date(ev.start);
            const startH = startDate.getHours();
            const startM = startDate.getMinutes();

            const topPx = Math.max(0, (startH + startM / 60 - DAY_START) * HOUR_HEIGHT);
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
                  'absolute overflow-hidden rounded-md cursor-pointer text-left',
                  tone.bg,
                  isSelected && 'ring-2 ring-accent',
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
                <div className={clsx('absolute left-0 top-0 bottom-0 w-[3px]', tone.bar)} />

                {/* Content */}
                <div className="pl-2 pr-1 pt-0.5 pb-0.5 h-full flex flex-col justify-start overflow-hidden">
                  <span className="text-[11px] font-medium text-ink truncate leading-tight">
                    {ev.title}
                  </span>
                  {heightPx > 28 && (
                    <>
                      <span className="text-[10px] font-mono text-muted truncate leading-tight">
                        {fmtTime(ev.start)}
                      </span>
                      {ev.attendee && (
                        <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                          <Avatar name={ev.attendee} size={14} />
                          <span className="text-[10px] text-muted truncate">{ev.attendee}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
