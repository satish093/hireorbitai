import { type DragEvent } from 'react';
import { PriorityBadge, DuePill, Avatar, shortId } from '../TaskBits';
import { type TaskRow } from './types';

export function TaskCard({
  task,
  selected,
  onSelect,
  onDragStart,
}: {
  task: TaskRow;
  selected?: boolean;
  onSelect: () => void;
  onDragStart?: (e: DragEvent<HTMLElement>, id: string) => void;
}): JSX.Element {
  const tags = task.tags ?? [];
  const visibleTags = tags.slice(0, 3);
  const extraTagCount = tags.length - visibleTags.length;

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!!onDragStart}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      onDragStart={onDragStart ? (e) => onDragStart(e, task.id) : undefined}
      className={[
        'rounded-lg border bg-surface p-3 transition select-none outline-none',
        onDragStart ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        selected
          ? 'border-ink shadow-md'
          : 'border-border hover:border-border-strong hover:shadow-sm',
        'focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-accent',
      ].join(' ')}
    >
      {/* Tags row */}
      {tags.length > 0 && (
        <div className="flex items-center justify-between gap-1 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] font-mono bg-bg-sunken text-ink-2 rounded px-1.5 py-0.5"
              >
                #{tag}
              </span>
            ))}
            {extraTagCount > 0 && (
              <span className="text-[10px] font-mono bg-bg-sunken text-ink-2 rounded px-1.5 py-0.5">
                +{extraTagCount}
              </span>
            )}
          </div>
          {/* Short ID — top-right of tags row */}
          <span className="text-[10px] font-mono text-faint ml-auto shrink-0">
            {shortId(task.id)}
          </span>
        </div>
      )}

      {/* If no tags, still show the short ID aligned right */}
      {tags.length === 0 && (
        <div className="flex justify-end">
          <span className="text-[10px] font-mono text-faint">{shortId(task.id)}</span>
        </div>
      )}

      {/* Title */}
      <p className="text-[13px] font-medium text-ink leading-[1.4] line-clamp-2 mt-1.5">
        {task.title}
      </p>

      {/* Footer */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {/* Left group */}
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <PriorityBadge priority={task.priority} />
          <DuePill task={task} />

          {/* Comment count */}
          {!!task.comment_count && (
            <span className="flex items-center gap-0.5 text-[11px] font-mono text-muted">
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                className="shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M14 1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2v3l3-3h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              {task.comment_count}
            </span>
          )}

          {/* Subtask count */}
          {!!task.subtask_count && (
            <span className="flex items-center gap-0.5 text-[11px] font-mono text-muted">
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                className="shrink-0"
                aria-hidden="true"
              >
                <rect x="1" y="3" width="6" height="1.5" rx="0.75" fill="currentColor" />
                <rect x="1" y="7" width="6" height="1.5" rx="0.75" fill="currentColor" />
                <rect x="1" y="11" width="6" height="1.5" rx="0.75" fill="currentColor" />
                <path
                  d="M9.5 4l1.5 1.5L14 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 11l1.5 1.5L14 10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {task.subtask_done ?? 0}/{task.subtask_count}
            </span>
          )}
        </div>

        {/* Right — assignee avatar */}
        <div className="shrink-0">
          {task.assignee ? (
            <Avatar name={task.assignee.full_name} email={task.assignee.email} size={22} />
          ) : (
            <span className="text-[10px] text-muted italic">Unassigned</span>
          )}
        </div>
      </div>
    </div>
  );
}
