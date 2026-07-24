import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Pill } from '../Pill';
import { dueUrgency, relativeDay, type MyAssignment } from './types';

/** One enrolled course row inside a CourseGroup. */
export function CourseRow({ a }: { a: MyAssignment & { updated_at?: string | null } }) {
  const done = a.status === 'COMPLETED';
  const required = !!a.course?.compliance_category;
  const pct = Math.round(a.progress_percentage || 0);
  const urgency = done ? null : dueUrgency(a.due_date);
  const cta =
    a.status === 'NOT_STARTED'
      ? 'Start'
      : done
        ? 'Review'
        : a.status === 'READY_TO_COMPLETE'
          ? 'Finish'
          : 'Resume';

  return (
    <Link
      to={`/training/assignments/${a.id}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 hover:border-border-strong hover:shadow-sm transition"
    >
      {/* Status-tinted icon block */}
      <span
        className={clsx(
          'shrink-0 grid place-items-center rounded-lg text-base',
          done ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent',
        )}
        style={{ width: 40, height: 40 }}
        aria-hidden="true"
      >
        {done ? '✓' : '🔖'}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink truncate">
            {a.course?.title ?? 'Course'}
          </span>
          <Pill
            tone={
              required
                ? { bg: 'bg-bg-sunken', text: 'text-ink-2' }
                : { bg: 'bg-bg-sunken', text: 'text-muted' }
            }
          >
            {required ? 'REQUIRED' : 'OPTIONAL'}
          </Pill>
          {urgency && (
            <Pill
              tone={
                urgency.tone === 'danger'
                  ? { bg: 'bg-danger-soft', text: 'text-danger' }
                  : { bg: 'bg-warn-soft', text: 'text-warn' }
              }
            >
              {urgency.label}
            </Pill>
          )}
        </div>
        <div className="text-[12px] text-muted truncate mt-0.5">
          {a.course?.category ?? 'General'}
          {a.updated_at ? ` · last opened ${relativeDay(a.updated_at)}` : ''}
        </div>
        {/* Progress */}
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-bg-sunken overflow-hidden max-w-[260px]">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] font-mono text-muted tabular-nums">{pct}%</span>
        </div>
      </div>

      <span className="shrink-0 inline-flex items-center h-8 px-3 rounded-lg border border-border text-[13px] text-ink-2">
        {cta}
      </span>
    </Link>
  );
}
