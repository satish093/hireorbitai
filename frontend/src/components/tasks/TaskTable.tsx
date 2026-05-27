import { useState, useRef } from 'react';
import clsx from 'clsx';
import { TaskStatusBadge, PriorityBadge, DuePill, Avatar } from '../TaskBits';
import { Button } from '../Button';
import { Popover } from '../ui/Popover';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { type TaskRow, type TaskUser } from './types';
import { TASK_STATUSES, TASK_STATUS_LABEL, MANAGER_TIER, type TaskStatus } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(id: string): string {
  return `HO-${id.slice(-3).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Bulk-action popovers
// ---------------------------------------------------------------------------

function MoveToPopover({ onMove }: { onMove: (status: TaskStatus) => Promise<void> }) {
  return (
    <Popover
      button={(open) => (
        <Button variant="outline" size="sm" className={clsx(open && 'ring-2 ring-accent/40')}>
          Move to ▾
        </Button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
          {TASK_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={async () => {
                await onMove(s);
                close();
              }}
              className="text-left px-3 py-1.5 rounded text-sm text-ink hover:bg-hover"
            >
              {TASK_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function AssignPopover({
  users,
  onAssign,
}: {
  users: TaskUser[];
  onAssign: (userId: string) => Promise<void>;
}) {
  return (
    <Popover
      button={(open) => (
        <Button variant="outline" size="sm" className={clsx(open && 'ring-2 ring-accent/40')}>
          Assign ▾
        </Button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto">
          {users.length === 0 && (
            <span className="px-3 py-2 text-sm text-muted italic">No users available</span>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={async () => {
                await onAssign(u.id);
                close();
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-ink hover:bg-hover"
            >
              <Avatar name={u.full_name} email={u.email} size={22} />
              <span className="truncate">{u.full_name ?? u.email}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function TagPopover({ onAddTag }: { onAddTag: (tag: string) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Popover
      button={(open) => (
        <Button variant="outline" size="sm" className={clsx(open && 'ring-2 ring-accent/40')}>
          Tag ▾
        </Button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-2 p-1">
          <input
            ref={inputRef}
            type="text"
            placeholder="Tag name…"
            className="border border-border rounded-md px-2.5 py-1.5 text-sm text-ink bg-surface outline-none focus:ring-2 focus:ring-accent/40 w-full"
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                const v = inputRef.current?.value.trim().toLowerCase();
                if (v) {
                  await onAddTag(v);
                  close();
                }
              }
            }}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={async () => {
              const v = inputRef.current?.value.trim().toLowerCase();
              if (v) {
                await onAddTag(v);
                close();
              }
            }}
          >
            Add
          </Button>
        </div>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TaskTable({
  tasks,
  selectedId,
  onSelect,
  users,
  onChanged,
}: {
  tasks: TaskRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  users: TaskUser[];
  onChanged: () => void;
}): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Assign / Tag / Delete are manager-only; status move stays (the backend lets
  // an assignee change status).
  const { profile } = useAuth();
  const canManage = !!profile && (MANAGER_TIER as readonly string[]).includes(profile.role);

  // ---- Checkbox helpers ----

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(tasks.map((t) => t.id)) : new Set());
  }

  const allChecked = tasks.length > 0 && selected.size === tasks.length;
  const someChecked = selected.size > 0 && !allChecked;

  // ---- Bulk mutation helpers ----

  async function runBulkOp(label: string, mutate: (id: string) => Promise<unknown>) {
    try {
      await Promise.all(Array.from(selected).map(mutate));
      toast.success(`${selected.size} task${selected.size > 1 ? 's' : ''} ${label}`);
      setSelected(new Set());
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? `Bulk ${label} failed`);
    }
  }

  async function bulkMove(status: TaskStatus) {
    await runBulkOp('moved', (id) => api.patch(`/tasks/${id}/status`, { status }));
  }

  async function bulkAssign(userId: string) {
    await runBulkOp('assigned', (id) => api.patch(`/tasks/${id}`, { assignee_id: userId }));
  }

  async function bulkTag(tag: string) {
    // Merge the new tag into existing tags[] for each selected task.
    const byId = new Map(tasks.map((t) => [t.id, t]));
    await runBulkOp('tagged', (id) => {
      const existing: string[] = byId.get(id)?.tags ?? [];
      const merged = existing.includes(tag) ? existing : [...existing, tag];
      return api.patch(`/tasks/${id}`, { tags: merged });
    });
  }

  async function bulkDelete() {
    if (
      !window.confirm(
        `Delete ${selected.size} task${selected.size > 1 ? 's' : ''}? This cannot be undone.`,
      )
    )
      return;
    await runBulkOp('deleted', (id) => api.delete(`/tasks/${id}`));
  }

  // ---- Render ----

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="px-4 py-2 border-b border-border bg-bg-sunken flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink">{selected.size} selected</span>
          <MoveToPopover onMove={bulkMove} />
          {canManage && <AssignPopover users={users} onAssign={bulkAssign} />}
          {canManage && <TagPopover onAddTag={bulkTag} />}
          {canManage && (
            <Button variant="danger" size="sm" onClick={bulkDelete}>
              Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-sunken text-[10px] font-semibold tracking-widest text-muted uppercase">
            <tr>
              {/* Select-all */}
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={(e) => toggleAll(e.target.checked)}
                  className="accent-[var(--color-accent)] cursor-pointer"
                  aria-label="Select all tasks"
                />
              </th>
              <th className="px-3 py-2 text-left">Task</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Priority</th>
              <th className="px-3 py-2 text-left">Due</th>
              <th className="px-3 py-2 text-left">Assignee</th>
              <th className="px-3 py-2 text-left">Tags</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted italic">
                  No tasks match these filters.
                </td>
              </tr>
            )}
            {tasks.map((t) => {
              const isRowSelected = selectedId === t.id;
              const isBulkChecked = selected.has(t.id);
              return (
                <tr
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  className={clsx(
                    'border-t border-border cursor-pointer transition-colors',
                    isRowSelected ? 'bg-accent-soft' : 'hover:bg-hover',
                  )}
                >
                  {/* Checkbox cell — stops click from selecting the row */}
                  <td className="px-3 py-2 w-8" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isBulkChecked}
                      onChange={(e) => toggleOne(t.id, e.target.checked)}
                      className="accent-[var(--color-accent)] cursor-pointer"
                      aria-label={`Select task ${shortId(t.id)}`}
                    />
                  </td>

                  {/* Title + shortId */}
                  <td className="px-3 py-2 max-w-xs">
                    <span className="block text-sm font-medium text-ink truncate leading-snug">
                      {t.title}
                    </span>
                    <span className="font-mono text-[11px] text-muted">{shortId(t.id)}</span>
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <TaskStatusBadge status={t.status} />
                  </td>

                  {/* Priority */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <PriorityBadge priority={t.priority} />
                  </td>

                  {/* Due */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {t.due_at ? (
                      <DuePill task={t} />
                    ) : (
                      <span className="font-mono text-[11px] text-muted">—</span>
                    )}
                  </td>

                  {/* Assignee */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {t.assignee ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-ink">
                        <Avatar name={t.assignee.full_name} email={t.assignee.email} size={22} />
                        <span className="truncate max-w-[110px]">
                          {t.assignee.full_name ?? t.assignee.email}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted italic">—</span>
                    )}
                  </td>

                  {/* Tags — up to 3 */}
                  <td className="px-3 py-2">
                    {t.tags && t.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {t.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-hover text-muted font-mono"
                          >
                            #{tag}
                          </span>
                        ))}
                        {t.tags.length > 3 && (
                          <span className="text-[10px] text-faint font-mono">
                            +{t.tags.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
