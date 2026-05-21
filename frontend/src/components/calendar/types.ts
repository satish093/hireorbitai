// Shared types + layout helpers for the Calendar scheduling surface.

export type CalTone = 'accent' | 'mock' | 'team' | 'deadline';
export type CalendarKey = 'interviews' | 'mock' | 'team' | 'deadlines' | 'personal';
export type CalView = 'day' | 'week' | 'month' | 'agenda';

export interface CalEvent {
  id: string;
  title: string;
  start: string; // ISO
  durationMin: number;
  tone: CalTone;
  kind: 'interview' | 'reminder';
  calendar: CalendarKey;
  attendee?: string | null;
  meetingUrl?: string | null;
  matchScore?: number | null;
  status?: string | null;
}

export const CALENDARS: { key: CalendarKey; label: string; tone: CalTone }[] = [
  { key: 'interviews', label: 'Interviews', tone: 'accent' },
  { key: 'mock', label: 'Mock loops', tone: 'mock' },
  { key: 'team', label: 'Team holds', tone: 'team' },
  { key: 'deadlines', label: 'Deadlines', tone: 'deadline' },
  { key: 'personal', label: 'Personal', tone: 'team' },
];

/** Token-based styles per event tone. Use these (no literal colors). */
export const TONE_STYLES: Record<CalTone, { bar: string; bg: string; text: string; dot: string }> =
  {
    accent: { bar: 'bg-accent', bg: 'bg-accent-soft', text: 'text-accent', dot: 'bg-accent' },
    mock: { bar: 'bg-danger', bg: 'bg-danger-soft', text: 'text-danger', dot: 'bg-danger' },
    team: {
      bar: 'bg-[color:var(--muted)]',
      bg: 'bg-bg-sunken',
      text: 'text-ink-2',
      dot: 'bg-[color:var(--muted)]',
    },
    deadline: { bar: 'bg-warn', bg: 'bg-warn-soft', text: 'text-warn', dot: 'bg-warn' },
  };

export const HOUR_HEIGHT = 44;
export const DAY_START = 8; // 8 AM
export const DAY_END = 18; // 6 PM
export const GUTTER_W = 52;

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const endOf = (e: CalEvent) => new Date(e.start).getTime() + e.durationMin * 60000;

/** Monday of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export interface PositionedEvent {
  ev: CalEvent;
  col: number; // column index within its overlap group
  cols: number; // total columns in its overlap group
  conflict: boolean;
}

/**
 * Lay out a single day's events, assigning each a column within its overlap
 * group so colliding events render side-by-side (50% width for a pair, etc.).
 * Greedy interval-graph coloring over transitively-overlapping clusters.
 */
export function layoutDay(events: CalEvent[]): PositionedEvent[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  const out: PositionedEvent[] = [];
  let i = 0;
  while (i < sorted.length) {
    // Build a cluster: keep extending while the next event starts before the
    // cluster's running max end.
    const cluster: CalEvent[] = [sorted[i]!];
    let clusterEnd = endOf(sorted[i]!);
    let j = i + 1;
    while (j < sorted.length && new Date(sorted[j]!.start).getTime() < clusterEnd) {
      cluster.push(sorted[j]!);
      clusterEnd = Math.max(clusterEnd, endOf(sorted[j]!));
      j++;
    }
    // Greedy column assignment within the cluster.
    const colEnds: number[] = []; // running end time per column
    const assigned: { ev: CalEvent; col: number }[] = [];
    for (const ev of cluster) {
      const s = new Date(ev.start).getTime();
      let col = colEnds.findIndex((end) => end <= s);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(endOf(ev));
      } else {
        colEnds[col] = endOf(ev);
      }
      assigned.push({ ev, col });
    }
    const cols = colEnds.length;
    for (const a of assigned) out.push({ ev: a.ev, col: a.col, cols, conflict: cols > 1 });
    i = j;
  }
  return out;
}
