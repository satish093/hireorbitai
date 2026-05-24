import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Avatar } from '../TaskBits';
import { DAY_START, DAY_END, TONE_STYLES, layoutDay, sameDay, endOf, type CalEvent } from './types';

// ── Local constants (Day-view only; does NOT touch shared HOUR_HEIGHT) ──
const LOCAL_HOUR_HEIGHT = 54; // px per hour in day view
const LOCAL_GUTTER_W = 60; // px for time gutter in day view

// Hours visible in the grid (DAY_START..DAY_END as labels)
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);
const GRID_HEIGHT = (DAY_END - DAY_START) * LOCAL_HOUR_HEIGHT;

// ── Small helpers ─────────────────────────────────────────────────────────────

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

/** Format minutes as "Xh Ym" (or "Xh" / "Ym" when one part is zero). */
function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Merge an array of [start, end) intervals (in minutes from midnight).
 * Returns sorted, non-overlapping intervals.
 */
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]!;
    const cur = sorted[i]!;
    if (cur[0] <= last[1]) {
      // overlapping — extend
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }
  return merged;
}

// ── Focus-time helpers ────────────────────────────────────────────────────────

interface Segment {
  type: 'busy' | 'free';
  widthPct: number;
}

function computeFocusData(dayEvents: CalEvent[]): {
  freeMinutes: number;
  segments: Segment[];
} {
  const windowStart = DAY_START * 60; // minutes from midnight
  const windowEnd = DAY_END * 60;
  const windowMinutes = windowEnd - windowStart;

  // Build busy intervals clamped to window
  const busyRaw: [number, number][] = dayEvents
    .map((e) => {
      const s = new Date(e.start);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = startMin + e.durationMin;
      const clampedStart = Math.max(startMin, windowStart);
      const clampedEnd = Math.min(endMin, windowEnd);
      return [clampedStart, clampedEnd] as [number, number];
    })
    .filter(([s, e]) => s < e); // drop events fully outside window

  const busyMerged = mergeIntervals(busyRaw);

  // Compute total busy and free minutes
  const busyMinutes = busyMerged.reduce((acc, [s, e]) => acc + (e - s), 0);
  const freeMinutes = Math.max(0, windowMinutes - busyMinutes);

  // Build segments for the horizontal bar (ordered slices of the window)
  const segments: Segment[] = [];
  let cursor = windowStart;

  for (const [bs, be] of busyMerged) {
    if (bs > cursor) {
      // free gap before this busy block
      segments.push({ type: 'free', widthPct: ((bs - cursor) / windowMinutes) * 100 });
    }
    segments.push({ type: 'busy', widthPct: ((be - bs) / windowMinutes) * 100 });
    cursor = be;
  }
  if (cursor < windowEnd) {
    // trailing free time
    segments.push({ type: 'free', widthPct: ((windowEnd - cursor) / windowMinutes) * 100 });
  }

  return { freeMinutes, segments };
}

// ── Travel & buffer helpers ───────────────────────────────────────────────────

interface BufferRow {
  prevTitle: string;
  nextTitle: string;
  gapMin: number;
}

function computeBuffers(dayEvents: CalEvent[]): BufferRow[] {
  if (dayEvents.length < 2) return [];
  const sorted = [...dayEvents].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  const rows: BufferRow[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i]!;
    const next = sorted[i + 1]!;
    const prevEndMs = endOf(prev);
    const nextStartMs = new Date(next.start).getTime();
    const gapMin = Math.max(0, Math.round((nextStartMs - prevEndMs) / 60000));
    // Only show gaps where events don't overlap (gap >= 0) and are on the same day
    if (gapMin >= 0) {
      rows.push({ prevTitle: prev.title, nextTitle: next.title, gapMin });
    }
  }
  return rows;
}

function gapTone(gapMin: number): string {
  if (gapMin < 10) return 'text-warn';
  if (gapMin <= 30) return 'text-muted';
  return 'text-success';
}

function gapLabel(gapMin: number): string {
  if (gapMin < 10) return 'Tight';
  if (gapMin <= 30) return 'Comfortable';
  return 'Long gap';
}

// ── Main component ────────────────────────────────────────────────────────────

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
  const nowTop = (nowHour + nowMin / 60 - DAY_START) * LOCAL_HOUR_HEIGHT;
  const nowInRange = nowHour >= DAY_START && nowHour < DAY_END;

  const dayEvents = events.filter((e) => sameDay(new Date(e.start), anchor));
  const positioned = layoutDay(dayEvents);

  const weekday = anchor.toLocaleDateString('en-US', { weekday: 'long' });
  const dateLabel = anchor.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // ── Side panel data ────────────────────────────────────────────────────────
  const { freeMinutes, segments } = computeFocusData(dayEvents);
  const bufferRows = computeBuffers(dayEvents);

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* ── LEFT: time-grid card ── */}
      <div className="flex-1 min-w-0 rounded-none sm:rounded-xl border-y sm:border border-border bg-surface overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-ink">{weekday}</span>
          <span className="font-mono text-xs text-muted">{dateLabel}</span>
          {isToday && (
            <span className="ml-auto text-[11px] font-mono text-accent bg-accent-soft rounded px-1.5 py-0.5">
              Today
            </span>
          )}
        </div>

        {/* Grid body */}
        <div className="flex" style={{ height: GRID_HEIGHT }}>
          {/* Time gutter */}
          <div
            className="relative shrink-0 border-r border-border"
            style={{ width: LOCAL_GUTTER_W, minWidth: LOCAL_GUTTER_W }}
          >
            {HOURS.map((h) => {
              if (h === DAY_END) return null;
              return (
                <span
                  key={h}
                  className="absolute right-2 text-[10px] font-mono text-muted select-none"
                  style={{ top: (h - DAY_START) * LOCAL_HOUR_HEIGHT - 7 }}
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
                style={{ top: (h - DAY_START) * LOCAL_HOUR_HEIGHT }}
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

              const topPx = Math.max(0, (startH + startM / 60 - DAY_START) * LOCAL_HOUR_HEIGHT);
              const heightPx = Math.max(20, (ev.durationMin / 60) * LOCAL_HOUR_HEIGHT - 2);

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
                    <span className="text-[11px] font-medium text-ink truncate leading-tight">
                      {ev.title}
                    </span>
                    {heightPx > 28 && (
                      <span className="text-[10px] font-mono text-muted truncate leading-tight">
                        {fmtTime(ev.start)}
                      </span>
                    )}
                    {heightPx > 56 && ev.attendee && (
                      <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                        <Avatar name={ev.attendee} size={14} />
                        <span className="text-[10px] text-muted truncate">{ev.attendee}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── RIGHT: side panel — hidden on mobile/tablet, shown lg+ ── */}
      <div className="hidden lg:block lg:w-[320px] lg:shrink-0 space-y-4">
        {/* Focus time card */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">
            Focus time
          </p>
          <p className="text-2xl font-semibold text-ink mb-3">{fmtDur(freeMinutes)}</p>

          {/* Working-window bar */}
          <div className="h-3 rounded-full overflow-hidden flex bg-bg-sunken">
            {segments.map((seg, idx) => (
              <div
                key={idx}
                className={clsx(
                  'h-full shrink-0',
                  seg.type === 'free' ? 'bg-accent-soft' : 'bg-hover',
                )}
                style={{ width: `${seg.widthPct}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] font-mono text-muted">{hourLabel(DAY_START)}</span>
            <span className="text-[10px] font-mono text-muted">{hourLabel(DAY_END)}</span>
          </div>
        </div>

        {/* Travel & buffers card */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">
            Travel &amp; buffers
          </p>

          {bufferRows.length === 0 ? (
            <p className="text-[12px] text-muted">No back-to-back events today.</p>
          ) : (
            <ul className="space-y-2">
              {bufferRows.map((row, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  {/* Gap duration chip */}
                  <span
                    className={clsx(
                      'shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded bg-bg-sunken',
                      gapTone(row.gapMin),
                    )}
                  >
                    {fmtDur(row.gapMin)}
                  </span>
                  {/* Labels */}
                  <div className="min-w-0">
                    <p className="text-[11px] text-ink-2 truncate leading-tight">{row.prevTitle}</p>
                    <p className={clsx('text-[10px] font-mono leading-tight', gapTone(row.gapMin))}>
                      {gapLabel(row.gapMin)} · then {row.nextTitle}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
