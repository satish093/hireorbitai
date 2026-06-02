import clsx from 'clsx';
import { Button } from './Button';

interface Reminder {
  id: string;
  title: string;
  due_at?: string | null;
  description?: string | null;
  status: string;
}

interface Props {
  reminder: Reminder;
  onComplete: (id: string) => void;
  onEdit?: (reminder: Reminder) => void;
  onDelete?: (id: string) => void;
}

/**
 * Mobile entity card for a Reminder (< 768px).
 * Pairs with the desktop DataTable row.
 */
export function ReminderCard({ reminder: r, onComplete, onEdit, onDelete }: Props) {
  const isDone = r.status === 'DONE' || r.status === 'SENT';
  const due = r.due_at ? new Date(r.due_at) : null;
  const isOverdue = due && !isDone ? due < new Date() : false;
  const isToday = due ? due.toDateString() === new Date().toDateString() : false;

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Bell icon */}
      <div
        className="w-9 h-9 rounded-xl grid place-items-center shrink-0 mt-0.5"
        style={{ background: isDone ? 'var(--hover)' : 'var(--accent-soft)' }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke={isDone ? 'var(--muted)' : 'var(--accent)'}
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div
          className={clsx('text-[14.5px] font-semibold', isDone && 'line-through')}
          style={{ color: isDone ? 'var(--muted)' : 'var(--ink)' }}
        >
          {r.title}
        </div>

        {due && (
          <div
            className="text-[12px] mt-0.5 font-medium"
            style={{
              color: isOverdue ? 'var(--danger)' : isToday ? 'var(--warn)' : 'var(--muted)',
            }}
          >
            {isToday
              ? 'Due today at ' + due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : due.toLocaleString()}
          </div>
        )}

        {r.description && (
          <div className="text-[12.5px] mt-1 line-clamp-2" style={{ color: 'var(--muted)' }}>
            {r.description}
          </div>
        )}
      </div>

      {/* Status / actions */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {!isDone && (
          <Button size="sm" variant="ghost" onClick={() => onComplete(r.id)}>
            Done
          </Button>
        )}
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={() => onEdit(r)}>
            Edit
          </Button>
        )}
        {onDelete && (
          <Button size="sm" variant="danger-ghost" onClick={() => onDelete(r.id)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
