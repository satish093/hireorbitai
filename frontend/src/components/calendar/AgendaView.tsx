import clsx from 'clsx';
import { Avatar } from '../TaskBits';
import { TONE_STYLES, sameDay, type CalEvent } from './types';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m === 0 ? '00' : m < 10 ? `0${m}` : `${m}`;
  return `${h12}:${mm} ${period}`;
}

function fmtDayHeader(d: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

interface DayGroup {
  day: Date;
  events: CalEvent[];
}

/** Group events by calendar day, sorted ascending. Only days that have events. */
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

export function AgendaView({
  events,
  selectedId,
  onSelect,
}: {
  events: CalEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const groups = groupByDay(events);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {groups.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted select-none">
          Nothing scheduled.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.day.toISOString()}>
            {/* Day header */}
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted px-4 py-2 bg-bg-sunken border-b border-border select-none">
              {fmtDayHeader(group.day)}
            </div>

            {/* Events */}
            {group.events.map((ev) => {
              const tone = TONE_STYLES[ev.tone];
              const isSelected = ev.id === selectedId;

              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onSelect(ev.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2.5 border-t border-border text-left',
                    isSelected ? 'bg-accent-soft' : 'hover:bg-hover',
                  )}
                >
                  {/* Time */}
                  <span className="font-mono text-[12px] text-muted w-20 shrink-0 text-left">
                    {fmtTime(ev.start)}
                  </span>

                  {/* Tone dot */}
                  <span className={clsx('shrink-0 w-1.5 h-1.5 rounded-full', tone.dot)} />

                  {/* Title */}
                  <span className="text-[13px] text-ink truncate flex-1">{ev.title}</span>

                  {/* Attendee */}
                  {ev.attendee && (
                    <span className="flex items-center gap-1.5 text-[12px] text-muted ml-auto shrink-0">
                      <Avatar name={ev.attendee} size={18} />
                      <span className="hidden sm:inline truncate max-w-[120px]">{ev.attendee}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
