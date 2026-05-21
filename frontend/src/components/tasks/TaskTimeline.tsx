import clsx from 'clsx';
import { type TaskRow } from './types';

// ---------------------------------------------------------------------------
// Week helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

/** Returns the Monday of the week containing `ref` (local time). */
function getMondayOf(ref: Date): Date {
  const d = new Date(ref);
  // JS getDay(): 0=Sun, 1=Mon … 6=Sat
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diffToMon);
  return d;
}

/** Returns date-only noon (avoids DST edge cases) for the Nth weekday (0=Mon). */
function weekDay(monday: Date, offset: 0 | 1 | 2 | 3 | 4): Date {
  const d = new Date(monday);
  d.setDate(d.getDate() + offset);
  d.setHours(12, 0, 0, 0);
  return d;
}

/**
 * Returns which column (0-4 = Mon-Fri) `due_at` maps to for the current week,
 * or null if the date falls outside Mon–Fri this week.
 */
function dueColumn(due_at: string | null | undefined, monday: Date): 0 | 1 | 2 | 3 | 4 | null {
  if (!due_at) return null;
  const d = new Date(due_at);
  if (isNaN(d.getTime())) return null;
  // Normalise to date-only for comparison
  d.setHours(0, 0, 0, 0);
  const mon = new Date(monday);
  mon.setHours(0, 0, 0, 0);
  const diffMs = d.getTime() - mon.getTime();
  const diffDays = Math.round(diffMs / (24 * 3600 * 1000));
  if (diffDays < 0 || diffDays > 4) return null;
  return diffDays as 0 | 1 | 2 | 3 | 4;
}

// ---------------------------------------------------------------------------
// Bar color by priority / tag
// ---------------------------------------------------------------------------

function barClass(task: TaskRow): string {
  // 'interview' tag takes precedence
  const tags = (task.tags ?? []).map((t) => t.toLowerCase());
  if (tags.includes('interview')) return 'bg-accent';

  // TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  // The spec also mentions 'URGENT' (legacy / future-proofing) — treat it like HIGH.
  const p: string = task.priority ?? '';
  if (p === 'HIGH' || p === 'CRITICAL' || p === 'URGENT') return 'bg-danger';
  if (p === 'MEDIUM') return 'bg-warn';
  // LOW or unknown
  return 'bg-bg-sunken border border-border';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskTimeline({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: TaskRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const monday = getMondayOf(new Date());

  // Five weekday Date objects for the header labels
  const weekDays = ([0, 1, 2, 3, 4] as const).map((i) => weekDay(monday, i));

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center text-sm text-muted italic">
        No tasks to schedule.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Header row */}
      <div className="grid grid-cols-[160px_1fr] items-center gap-2 px-3 py-2 border-b border-border bg-bg-sunken">
        {/* Left label column header — blank */}
        <div />
        {/* 5-column day header */}
        <div className="grid grid-cols-5 gap-1">
          {weekDays.map((d, i) => (
            <div key={i} className="text-center">
              <span className="block text-[11px] font-semibold text-ink font-mono">
                {DAY_NAMES[i]}
              </span>
              <span className="block text-[11px] text-faint font-mono">{d.getDate()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Task rows */}
      {tasks.map((t) => {
        const col = dueColumn(t.due_at, monday);
        const isSelected = selectedId === t.id;

        return (
          <div
            key={t.id}
            className="grid grid-cols-[160px_1fr] items-center gap-2 px-3 py-1.5 border-b border-border last:border-0"
          >
            {/* Title — clickable */}
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className={clsx(
                'text-[13px] text-ink truncate text-left rounded px-1 py-0.5 transition-colors',
                isSelected ? 'bg-accent-soft' : 'hover:bg-hover',
              )}
              title={t.title}
            >
              {t.title}
            </button>

            {/* 5-col track */}
            <div className="grid grid-cols-5 gap-1 h-6 items-center">
              {([0, 1, 2, 3, 4] as const).map((i) => {
                if (col !== i) {
                  return <div key={i} />;
                }
                return (
                  <div
                    key={i}
                    className={clsx('rounded h-4 self-center w-full', barClass(t))}
                    title={t.title}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
