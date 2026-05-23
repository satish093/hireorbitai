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

  if (sameDay(d, today)) return 'TODAY';
  if (sameDay(d, tomorrow)) return 'TOMORROW';

  return d
    .toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    })
    .toUpperCase();
}

interface DayGroup {
  day: Date;
  events: CalEvent[];
}

/** Group events by calendar day, sorted ascending. Only days with events. */
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

// ── Small inline 3-dot icon (no external deps) ────────────────────────────

function DotsIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
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

  // Endless-scroll state: how many 7-day windows to show.
  // NOTE: reveals from the already-loaded event set; a true fetch-more would
  // also widen the upstream data window passed via `events`.
  const [weeksShown, setWeeksShown] = useState(2);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setWeeksShown((w) => w + 1);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute cut-off: weeksShown * 7 days from the first event (or today).
  const baseDate = allGroups.length > 0 ? allGroups[0]!.day : new Date();
  const cutoff = new Date(baseDate);
  cutoff.setDate(baseDate.getDate() + weeksShown * 7);

  const visibleGroups = allGroups.filter((g) => g.day <= cutoff);
  const hasMore = allGroups.length > visibleGroups.length;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {allGroups.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted select-none">
          Nothing scheduled.
        </div>
      ) : (
        <>
          {visibleGroups.map((group) => (
            <div key={group.day.toISOString()}>
              {/* ── Day header ── */}
              <div className="bg-bg-sunken px-4 py-2 text-[11px] font-mono uppercase tracking-wider text-muted select-none">
                {fmtDayHeader(group.day)}
              </div>

              {/* ── Event rows ── */}
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
                    {/* LEFT — time + duration */}
                    <div className="w-[90px] shrink-0 flex flex-col items-end justify-center">
                      <span className="font-mono text-[12px] text-ink leading-tight">
                        {fmtTime(ev.start)}
                      </span>
                      <span className="font-mono text-[11px] text-muted leading-tight">
                        {fmtDuration(ev.durationMin)}
                      </span>
                    </div>

                    {/* Vertical tone bar */}
                    <div className={clsx('w-1 self-stretch rounded-full shrink-0', tone.bar)} />

                    {/* Title + attendee */}
                    <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
                      <span className="text-[13px] text-ink truncate leading-tight">
                        {ev.title}
                      </span>
                      {ev.attendee && (
                        <span className="flex items-center gap-1.5 text-[12px] text-muted truncate">
                          <Avatar name={ev.attendee} size={14} />
                          <span className="truncate">{ev.attendee}</span>
                        </span>
                      )}
                    </div>

                    {/* RIGHT — "more" popover */}
                    <div
                      className="shrink-0 flex items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
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

          {/* Sentinel for IntersectionObserver — only rendered when more data exists */}
          {hasMore && (
            <div ref={sentinelRef} className="h-8 flex items-center justify-center">
              <span className="text-[11px] text-muted select-none">Loading more…</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
