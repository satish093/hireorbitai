import React from 'react';
import { Button } from '../Button';
import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import { Popover } from '../ui/Popover';
import { TASK_PRIORITIES, type TaskPriority } from '../../types';
import { type FilterState, type ViewMode, type TaskUser } from './types';

export function TaskFilterBar({
  filters,
  onChange,
  total,
  shown,
  view,
  onView,
  searchRef,
  users,
}: {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  total: number;
  shown: number;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  users: TaskUser[];
}): JSX.Element {
  // Derive display labels for filter trigger buttons.
  const priorityLabel = filters.priority ? filters.priority : 'Priority';
  const assigneeLabel = filters.assignee_id
    ? (users.find((u) => u.id === filters.assignee_id)?.full_name ??
      users.find((u) => u.id === filters.assignee_id)?.email ??
      'Assignee')
    : 'Assignee';
  const tagLabel = filters.tag ? `#${filters.tag}` : 'Tag';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search input */}
      <div className="relative">
        <input
          ref={searchRef}
          value={filters.q ?? ''}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search tasks…"
          className="h-8 w-[220px] rounded-md border border-border-strong bg-surface pl-3 pr-8 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:border-accent"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-faint border border-border rounded px-1">
          /
        </span>
      </div>

      {/* Priority filter */}
      <Popover
        button={(open) => (
          <Button
            size="sm"
            variant={filters.priority ? 'outline' : 'ghost'}
            aria-expanded={open}
            rightIcon={
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          >
            {priorityLabel}
          </Button>
        )}
        panelClassName="min-w-[140px]"
      >
        {(close) => (
          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              block
              className="!justify-start"
              onClick={() => {
                onChange({ priority: '' });
                close();
              }}
            >
              Any
            </Button>
            {(TASK_PRIORITIES as TaskPriority[]).map((p) => (
              <Button
                key={p}
                variant="ghost"
                size="sm"
                block
                className="!justify-start"
                onClick={() => {
                  onChange({ priority: p });
                  close();
                }}
              >
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </Button>
            ))}
          </div>
        )}
      </Popover>

      {/* Assignee filter */}
      <Popover
        button={(open) => (
          <Button
            size="sm"
            variant={filters.assignee_id ? 'outline' : 'ghost'}
            aria-expanded={open}
            rightIcon={
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          >
            {assigneeLabel}
          </Button>
        )}
        panelClassName="min-w-[180px] max-h-[260px] overflow-y-auto"
      >
        {(close) => (
          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              block
              className="!justify-start"
              onClick={() => {
                onChange({ assignee_id: undefined });
                close();
              }}
            >
              Anyone
            </Button>
            {users.map((u) => (
              <Button
                key={u.id}
                variant="ghost"
                size="sm"
                block
                className="!justify-start"
                onClick={() => {
                  onChange({ assignee_id: u.id });
                  close();
                }}
              >
                {u.full_name ?? u.email}
              </Button>
            ))}
          </div>
        )}
      </Popover>

      {/* Tag filter */}
      <Popover
        button={(open) => (
          <Button
            size="sm"
            variant={filters.tag ? 'outline' : 'ghost'}
            aria-expanded={open}
            rightIcon={
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          >
            {tagLabel}
          </Button>
        )}
        panelClassName="min-w-[180px]"
      >
        {(close) => {
          // Local state for the tag input. Using a React ref-driven uncontrolled
          // input here avoids re-rendering the whole filter bar on every keystroke.
          let inputRef: HTMLInputElement | null = null;
          return (
            <div className="flex flex-col gap-2 p-1">
              <input
                ref={(el) => {
                  inputRef = el;
                }}
                defaultValue={filters.tag ?? ''}
                placeholder="Enter tag…"
                className="h-8 w-full rounded-md border border-border-strong bg-surface px-3 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:border-accent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onChange({ tag: (e.currentTarget.value || undefined) as string | undefined });
                    close();
                  }
                }}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  block
                  onClick={() => {
                    onChange({ tag: (inputRef?.value || undefined) as string | undefined });
                    close();
                  }}
                >
                  Apply
                </Button>
                {filters.tag && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onChange({ tag: undefined });
                      close();
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          );
        }}
      </Popover>

      {/* Overdue toggle */}
      <Button
        size="sm"
        variant={filters.overdue ? 'primary' : 'ghost'}
        onClick={() => onChange({ overdue: filters.overdue ? undefined : true })}
      >
        Overdue
      </Button>

      {/* Right side: count + view switcher */}
      <div className="ml-auto flex items-center gap-3">
        <span className="text-[12px] font-mono text-muted whitespace-nowrap">
          {shown} of {total} shown
        </span>
        <ButtonGroup>
          <ButtonGroupItem pressed={view === 'kanban'} onClick={() => onView('kanban')}>
            Kanban
          </ButtonGroupItem>
          <ButtonGroupItem pressed={view === 'table'} onClick={() => onView('table')}>
            Table
          </ButtonGroupItem>
          <ButtonGroupItem pressed={view === 'timeline'} onClick={() => onView('timeline')}>
            Timeline
          </ButtonGroupItem>
        </ButtonGroup>
      </div>
    </div>
  );
}
