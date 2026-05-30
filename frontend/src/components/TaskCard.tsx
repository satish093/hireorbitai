import clsx from 'clsx';
import type { Task, TaskPriority } from '../types';

const PRIORITY_DOT: Record<TaskPriority, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-amber-500',
  MEDIUM: 'bg-yellow-400',
  LOW: 'bg-blue-400',
};

interface Props {
  task: Task;
  onToggle?: (id: string, done: boolean) => void;
  onClick?: (id: string) => void;
}

/**
 * Mobile entity card for a Task (< 768px).
 * Pairs with the desktop TaskKanban / TaskTable — same data contract.
 * Checkbox inline-toggles done state; tap the card body opens the detail.
 */
export function TaskCard({ task, onToggle, onClick }: Props) {
  const isDone = task.status === 'COMPLETED' || task.status === 'CANCELLED';
  const due = task.due_at ? new Date(task.due_at) : null;
  const isToday = due ? due.toDateString() === new Date().toDateString() : false;
  const isOverdue = due && !isDone ? due < new Date() && !isToday : false;

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Checkbox */}
      <button
        type="button"
        aria-label={isDone ? 'Mark open' : 'Mark done'}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.(task.id, !isDone);
        }}
        className={clsx(
          'w-6 h-6 rounded-[7px] shrink-0 mt-0.5 flex items-center justify-center border-2 transition-colors',
          isDone
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'bg-transparent border-border-strong hover:border-muted',
        )}
      >
        {isDone && (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onClick?.(task.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onClick?.(task.id);
        }}
      >
        <div
          className={clsx('text-[14.5px] font-semibold leading-snug', isDone && 'line-through')}
          style={{ color: isDone ? 'var(--muted)' : 'var(--ink)' }}
        >
          {task.title}
        </div>

        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {/* Priority dot */}
          <span
            className={clsx('w-2 h-2 rounded-full shrink-0', PRIORITY_DOT[task.priority])}
            title={task.priority}
          />

          {/* Due date */}
          {due && (
            <span
              className="text-[12px] font-medium"
              style={{
                color: isOverdue ? 'var(--danger)' : isToday ? 'var(--warn)' : 'var(--muted)',
              }}
            >
              {isToday
                ? 'Today'
                : isOverdue
                  ? `Overdue · ${due.toLocaleDateString()}`
                  : due.toLocaleDateString()}
            </span>
          )}

          {/* Tags */}
          {task.tags?.map((tag) => (
            <span
              key={tag}
              className="text-[11px] px-1.5 py-px rounded-md font-semibold"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--ink-2)',
                border: '1px solid var(--border)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
