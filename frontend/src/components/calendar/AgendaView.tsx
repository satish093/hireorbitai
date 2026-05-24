import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Avatar } from '../TaskBits';
import { Popover } from '../ui/Popover';
import { TONE_STYLES, sameDay, type CalEvent } from './types';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m === 0 ? '00' : m < 10 ? `0${m}` : `${m}`;
  return `${h12}:${mm} ${period}`;
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/** e.g. "WED MAY 20" — with TODAY / TOMORROW shorthands. */
function fmtDayHeader(d: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, tomorrow)) return 'Tomorrow';

  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

function fmtDayHeaderShort(d: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (sameDay(d, today)) return 'TODAY';
  if (sameDay(d, tomorrow)) return 'TOMORROW';

  return d
    .toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    .toUpperCase();
}

interface DayGroup {
  day: Date;
  events: CalEvent[];
}

function groupByDay(events: CalEvent[]): DayGroup[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  const groups: DayGroup[] = [];
  for (const ev of sorted) {
    const evDate = new Date(ev.start);
    const last = groups[groups.length - 1];
    if (last && sameDay(last.day, evDate)) {
      last.events.push(ev);
    } else {
      groups.push({ day: evDate, events: [ev] });
    }
  }
  return groups;
}

function DotsIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}

// ── Mobile Event Card ──────────────────────────────────────────────────────

function MobileEventCard({
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
    <button
      type="button"
      onClick={() => onSelect(ev.id)}
      className={clsx(
        'w-full text-left rounded-xl border p-4 transition-all active:scale-[0.98]',
        isSelected
          ? `${tone.bg} ${tone.border} ring-2 ring-offset-1 ring-accent`
          : `${tone.bg} ${tone.border} hover:shadow-sm`,
      )}
    >
      {/* Title row */}
      <div className="flex items-start gap-3">
        {/* Left tone strip */}
        <div
          className={clsx('w-1 shrink-0 rounded-full mt-0.5', tone.bar)}
          style={{ height: 20 }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold text-ink leading-snug truncate">{ev.title}</p>
        </div>
      </div>

      {/* Meta row */}
      <div className="mt-2 ml-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Time + duration */}
        <span className={clsx('text-[13px] font-medium', tone.text)}>{fmtTime(ev.start)}</span>
        <span className="text-[12px] text-muted font-mono">{fmtDuration(ev.durationMin)}</span>

        {/* Attendee */}
        {ev.attendee && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted min-w-0">
            <Avatar name={ev.attendee} size={16} />
            <span className="truncate">{ev.attendee}</span>
          </span>
        )}

        {/* Meeting badge */}
        {ev.meetingUrl && (
          <span className="text-[11px] font-medium text-success bg-success-soft rounded-full px-2 py-0.5">
            Video
          </span>
        )}

        {/* Match score */}
        {ev.kind === 'interview' && typeof ev.matchScore === 'number' && (
          <span className="text-[11px] font-mono font-semibold text-success bg-success-soft rounded-full px-2 py-0.5">
            {ev.matchScore}%
          </span>
        )}
      </div>
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export function AgendaView({
  events,
  selectedId,
  onSelect,
}: {
  events: CalEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const allGroups = groupByDay(events);

  const [weeksShown, setWeeksShown] = useState(2);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setWeeksShown((w) => w + 1);
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const baseDate = allGroups.length > 0 ? allGroups[0]!.day : new Date();
  const cutoff = new Date(baseDate);
  cutoff.setDate(baseDate.getDate() + weeksShown * 7);
  const visibleGroups = allGroups.filter((g) => g.day <= cutoff);
  const hasMore = allGroups.length > visibleGroups.length;

  if (allGroups.length === 0) {
    return (
      <div className="w-full flex items-center justify-center min-h-[65vh]">
        <div className="text-center space-y-2">
          <p className="text-4xl">📅</p>
          <p className="text-[14px] text-muted">Nothing scheduled</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Mobile: card list ──────────────────────────────────── */}
      <div className="sm:hidden space-y-6">
        {visibleGroups.map((group) => (
          <div key={group.day.toISOString()}>
            {/* Day heading */}
            <div className="flex items-center gap-3 mb-3">
              <div
                className={clsx(
                  'w-10 h-10 rounded-full grid place-items-center shrink-0 font-mono text-[15px] font-bold',
                  sameDay(group.day, new Date())
                    ? 'bg-accent text-white'
                    : 'bg-bg-sunken text-muted',
                )}
              >
                {group.day.getDate()}
              </div>
              <div>
                <p
                  className={clsx(
                    'text-[14px] font-semibold leading-tight',
                    sameDay(group.day, new Date()) ? 'text-accent' : 'text-ink',
                  )}
                >
                  {fmtDayHeader(group.day)}
                </p>
                <p className="text-[11px] text-muted">
                  {group.day.toLocaleDateString('en-US', { weekday: 'long' })}
                </p>
              </div>
            </div>

            {/* Event cards */}
            <div className="space-y-2.5">
              {group.events.map((ev) => (
                <MobileEventCard
                  key={ev.id}
                  ev={ev}
                  isSelected={ev.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ))}

        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-4">
            <span className="text-[12px] text-muted">Loading more…</span>
          </div>
        )}
      </div>

      {/* ── Desktop: compact row list ──────────────────────────── */}
      <div className="hidden sm:block rounded-none sm:rounded-xl border-y sm:border border-border bg-surface overflow-hidden">
        {visibleGroups.map((group) => (
          <div key={group.day.toISOString()}>
            {/* Day header */}
            <div className="bg-bg-sunken px-4 py-2 text-[11px] font-mono uppercase tracking-wider text-muted select-none">
              {fmtDayHeaderShort(group.day)}
            </div>

            {/* Event rows */}
            {group.events.map((ev) => {
              const tone = TONE_STYLES[ev.tone];
              const isSelected = ev.id === selectedId;

              return (
                <div
                  key={ev.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(ev.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelect(ev.id);
                  }}
                  className={clsx(
                    'flex items-stretch gap-3 px-4 py-2.5 border-t border-border border-l-2 cursor-pointer transition-colors',
                    isSelected
                      ? 'bg-accent-soft border-l-accent'
                      : 'border-l-transparent hover:bg-hover',
                  )}
                >
                  {/* Time + duration */}
                  <div className="w-[90px] shrink-0 flex flex-col items-end justify-center">
                    <span className="font-mono text-[12px] text-ink leading-tight">
                      {fmtTime(ev.start)}
                    </span>
                    <span className="font-mono text-[11px] text-muted leading-tight">
                      {fmtDuration(ev.durationMin)}
                    </span>
                  </div>

                  {/* Tone bar */}
                  <div className={clsx('w-1 self-stretch rounded-full shrink-0', tone.bar)} />

                  {/* Title + attendee */}
                  <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
                    <span className="text-[13px] text-ink truncate leading-tight">{ev.title}</span>
                    {ev.attendee && (
                      <span className="flex items-center gap-1.5 text-[12px] text-muted truncate">
                        <Avatar name={ev.attendee} size={14} />
                        <span className="truncate">{ev.attendee}</span>
                      </span>
                    )}
                  </div>

                  {/* More popover */}
                  <div className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                    <Popover
                      align="right"
                      panelClassName="min-w-[120px]"
                      button={(open) => (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="More options"
                          className={clsx(
                            'flex items-center justify-center w-6 h-6 rounded text-ink-2 cursor-pointer',
                            open ? 'bg-hover' : 'hover:bg-hover',
                          )}
                        >
                          <DotsIcon />
                        </span>
                      )}
                    >
                      {(close) => (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            onSelect(ev.id);
                            close();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              onSelect(ev.id);
                              close();
                            }
                          }}
                          className="flex items-center gap-2 text-[13px] text-ink px-2 py-1.5 rounded cursor-pointer hover:bg-hover"
                        >
                          Open
                        </div>
                      )}
                    </Popover>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {hasMore && (
          <div ref={sentinelRef} className="h-8 flex items-center justify-center">
            <span className="text-[11px] text-muted select-none">Loading more…</span>
          </div>
        )}
      </div>
    </>
  );
}
