import React from 'react';
import clsx from 'clsx';
import { Button } from '../Button';
import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import { SelectInput } from '../SelectInput';
import { Popover } from '../ui/Popover';
import { useUserGroups } from '../GroupBadge';
import { TASK_PRIORITIES, type TaskPriority } from '../../types';
import { type FilterState, type SavedView, type ViewMode, type TaskUser } from './types';

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Count of advanced filters in effect (search is shown separately). */
function activeCount(f: FilterState): number {
  return [f.priority, f.assignee_id, f.group_id, f.tag, f.overdue, f.status].filter(Boolean).length;
}

/**
 * Single, calm Tasks toolbar. The default row leads with search · the active
 * view · New task. Advanced filters AND saved views live behind one "Filters"
 * control (progressive disclosure); whatever's actually applied surfaces as
 * removable chips so nothing is hidden once it's on.
 */
export function TaskFilterBar({
  filters,
  onChange,
  total,
  shown,
  view,
  onView,
  searchRef,
  users,
  views,
  activeViewId,
  onSelectView,
  onSaveCurrent,
  profileId,
  onNewTask,
  canCreate,
}: {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  total: number;
  shown: number;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  users: TaskUser[];
  views: SavedView[];
  activeViewId: string | null;
  onSelectView: (v: SavedView) => void;
  onSaveCurrent: () => void;
  profileId?: string;
  onNewTask: () => void;
  canCreate: boolean;
}): JSX.Element {
  const nActive = activeCount(filters);
  const { groups } = useUserGroups();
  const userName = (id?: string) => {
    const u = users.find((x) => x.id === id);
    return u?.full_name ?? u?.email ?? 'Someone';
  };
  const groupName = (id?: string) => groups.find((g) => g.id === id)?.name ?? 'Group';

  // Removable chips for whatever's applied.
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.priority)
    chips.push({
      key: 'priority',
      label: `Priority: ${titleCase(filters.priority)}`,
      clear: () => onChange({ priority: '' }),
    });
  if (filters.assignee_id)
    chips.push({
      key: 'assignee',
      label:
        filters.assignee_id === profileId
          ? 'Assigned to me'
          : `Assignee: ${userName(filters.assignee_id)}`,
      clear: () => onChange({ assignee_id: undefined }),
    });
  if (filters.group_id)
    chips.push({
      key: 'group',
      label: `Group: ${groupName(filters.group_id)}`,
      clear: () => onChange({ group_id: undefined }),
    });
  if (filters.tag)
    chips.push({ key: 'tag', label: `#${filters.tag}`, clear: () => onChange({ tag: undefined }) });
  if (filters.overdue)
    chips.push({ key: 'overdue', label: 'Overdue', clear: () => onChange({ overdue: undefined }) });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative">
        <input
          ref={searchRef}
          value={filters.q ?? ''}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search tasks…"
          className="h-9 w-[220px] rounded-lg border border-border bg-surface pl-3 pr-8 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-faint border border-border rounded px-1">
          /
        </span>
      </div>

      {/* Filters + saved views (progressive disclosure) */}
      <Popover
        panelClassName="min-w-[280px]"
        button={(open) => (
          <button
            className={clsx(
              'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] transition-colors press',
              nActive > 0
                ? 'bg-accent-soft border-accent/40 text-accent'
                : 'bg-surface border-border text-ink-2 hover:bg-hover',
              open && 'ring-2 ring-accent/30',
            )}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2 4h12M4 8h8M6 12h4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Filters
            {nActive > 0 && (
              <span className="ml-0.5 text-[10px] font-mono bg-accent text-white dark:text-bg rounded-full px-1.5">
                {nActive}
              </span>
            )}
          </button>
        )}
      >
        {(close) => (
          <div className="w-[260px] space-y-3">
            {profileId && (
              <Button
                size="sm"
                variant={filters.assignee_id === profileId ? 'primary' : 'outline'}
                block
                onClick={() =>
                  onChange({
                    assignee_id: filters.assignee_id === profileId ? undefined : profileId,
                  })
                }
              >
                Assigned to me
              </Button>
            )}

            <SelectInput
              label="Priority"
              value={filters.priority ?? ''}
              onChange={(e) => onChange({ priority: e.target.value as TaskPriority | '' })}
              options={[
                { value: '', label: 'Any priority' },
                ...(TASK_PRIORITIES as TaskPriority[]).map((p) => ({
                  value: p,
                  label: titleCase(p),
                })),
              ]}
            />

            <SelectInput
              label="Assignee"
              value={filters.assignee_id ?? ''}
              onChange={(e) => onChange({ assignee_id: e.target.value || undefined })}
              options={[
                { value: '', label: 'Anyone' },
                ...users.map((u) => ({ value: u.id, label: u.full_name ?? u.email })),
              ]}
            />

            {groups.length > 0 && (
              <SelectInput
                label="Group"
                value={filters.group_id ?? ''}
                onChange={(e) => onChange({ group_id: e.target.value || undefined })}
                options={[
                  { value: '', label: 'Any group' },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            )}

            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1.5">Tag</span>
              <input
                defaultValue={filters.tag ?? ''}
                placeholder="Enter a tag + Enter"
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onChange({ tag: e.currentTarget.value.trim() || undefined });
                    close();
                  }
                }}
              />
            </label>

            <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={!!filters.overdue}
                onChange={(e) => onChange({ overdue: e.target.checked || undefined })}
                className="accent-[color:var(--accent)]"
              />
              Overdue only
            </label>

            {views.length > 0 && (
              <div className="pt-2 border-t border-border">
                <span className="block text-xs font-medium text-muted mb-1.5">Saved views</span>
                <div className="flex flex-wrap gap-1.5">
                  {views.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        onSelectView(v);
                        close();
                      }}
                      className={clsx(
                        'text-[12px] rounded-full px-2.5 py-1 border transition-colors',
                        v.id === activeViewId
                          ? 'bg-ink text-bg border-ink'
                          : 'bg-surface border-border text-ink-2 hover:bg-hover',
                      )}
                    >
                      {v.name}
                      {v.count != null && <span className="ml-1 text-faint">{v.count}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              size="sm"
              variant="ghost"
              block
              className="!justify-start"
              onClick={onSaveCurrent}
            >
              + Save current as view
            </Button>
          </div>
        )}
      </Popover>

      {/* Active-filter chips */}
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={c.clear}
          className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg bg-accent-soft text-accent text-[12px] press"
          title="Remove filter"
        >
          {c.label}
          <span aria-hidden="true" className="text-accent/70">
            ✕
          </span>
        </button>
      ))}

      {/* Right: count · view switch · New task.
          On mobile becomes a full-width second row so nothing overlaps. */}
      <div className="w-full sm:ml-auto sm:w-auto flex items-center gap-2 sm:gap-3">
        <span className="text-[12px] font-mono text-muted whitespace-nowrap mr-auto sm:mr-0">
          {shown} of {total}
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
        {canCreate && (
          <Button variant="primary" size="sm" onClick={onNewTask}>
            New task
          </Button>
        )}
      </div>
    </div>
  );
}
