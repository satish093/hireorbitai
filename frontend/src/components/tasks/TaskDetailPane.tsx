/**
 * TaskDetailPane — slide-in task detail panel for the Tasks workspace.
 *
 * Structure:
 *  1. Fixed top bar      — task ID pill, last-updated, copy-link, close
 *  2. Scroll body        — title (click-to-edit), description, properties card,
 *                          subtasks card, activity log
 *  3. Sticky composer    — textarea + @mention dropdown + Send button
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';

import { Button } from '../Button';
import { Avatar, TaskStatusBadge, PriorityBadge } from '../TaskBits';
import { api } from '../../services/api';
import { invalidate, useInvalidationListener } from '../../hooks/useInvalidate';
import { Popover } from '../ui/Popover';

import { type TaskRow, type Subtask, type TaskActivity, type TaskUser } from './types';
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  TASK_PRIORITIES,
  type TaskStatus,
  type TaskPriority,
} from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatDateValue(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10); // 'YYYY-MM-DD'
}

function describeActivity(activity: TaskActivity): string {
  const p = activity.payload ?? {};
  switch (activity.kind) {
    case 'status_changed':
      return `status → ${String(p.to ?? p.status ?? '')}`;
    case 'priority_changed':
      return `priority → ${String(p.to ?? p.priority ?? '')}`;
    case 'assignee_changed':
      return `assignee → ${String(p.to_name ?? p.assignee ?? 'unassigned')}`;
    case 'created':
      return 'task created';
    case 'subtask_added':
      return `subtask added: ${String(p.label ?? '')}`;
    case 'subtask_completed':
      return `subtask completed: ${String(p.label ?? '')}`;
    default:
      return activity.kind;
  }
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

const IconLink = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7.5 3.5" />
    <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1" />
  </svg>
);

const IconX = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <path d="M3 3l10 10M13 3L3 13" />
  </svg>
);

const IconPaperclip = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13.5 7.5l-5.5 5.5a4 4 0 0 1-5.657-5.657l6.364-6.364a2.5 2.5 0 0 1 3.536 3.536L5.93 10.828a1 1 0 0 1-1.414-1.414L10.5 3.5" />
  </svg>
);

const IconCheck = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 8l4 4 6-7" />
  </svg>
);

// ---------------------------------------------------------------------------
// Inline sub-components
// ---------------------------------------------------------------------------

/** Eyebrow label for sections */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-1">{children}</p>
  );
}

/** Property row inside the properties card */
function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted shrink-0 w-24">{label}</span>
      <span className="flex-1 flex justify-end">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subtask row
// ---------------------------------------------------------------------------

interface SubtaskRowProps {
  subtask: Subtask;
  onToggle: (id: string, done: boolean) => void;
}

function SubtaskRow({ subtask, onToggle }: SubtaskRowProps) {
  const [optimistic, setOptimistic] = useState(subtask.done);

  // Keep in sync if parent refetches
  useEffect(() => {
    setOptimistic(subtask.done);
  }, [subtask.done]);

  function toggle() {
    const next = !optimistic;
    setOptimistic(next);
    onToggle(subtask.id, next);
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={optimistic ? 'Mark incomplete' : 'Mark complete'}
        onClick={toggle}
        className={clsx(
          '!w-[18px] !h-[18px] !rounded border shrink-0 transition-colors',
          optimistic
            ? 'bg-accent border-accent text-white'
            : 'border-border bg-surface text-transparent hover:border-border-strong',
        )}
        leftIcon={optimistic ? <IconCheck /> : undefined}
      />
      <span
        className={clsx(
          'text-[13px] flex-1',
          optimistic ? 'line-through text-muted' : 'text-ink-2',
        )}
      >
        {subtask.label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// @mention dropdown
// ---------------------------------------------------------------------------

interface MentionDropdownProps {
  users: TaskUser[];
  query: string;
  onSelect: (user: TaskUser) => void;
}

function MentionDropdown({ users, query, onSelect }: MentionDropdownProps) {
  const filtered = users
    .filter((u) => (u.full_name ?? u.email).toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-1 left-0 z-40 bg-bg-elev border border-border rounded-lg shadow-btn-hover py-1 min-w-[200px] max-h-48 overflow-y-auto">
      {filtered.map((u) => (
        <button
          key={u.id}
          type="button"
          className="flex items-center gap-2 px-3 py-1.5 w-full text-left text-[13px] text-ink hover:bg-hover transition-colors"
          onMouseDown={(e) => {
            e.preventDefault(); // keep textarea focus
            onSelect(u);
          }}
        >
          <Avatar name={u.full_name} email={u.email} size={20} />
          <span className="truncate">{u.full_name ?? u.email}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function TaskDetailPane({
  taskId,
  onClose,
  users,
  onChanged,
}: {
  taskId: string;
  onClose: () => void;
  users: TaskUser[];
  onChanged: () => void;
}): JSX.Element {
  // ---- data state ----------------------------------------------------------
  const [task, setTask] = useState<TaskRow | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- edit state: title ---------------------------------------------------
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // ---- edit state: description ---------------------------------------------
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  // ---- subtask add ---------------------------------------------------------
  const [newSubtaskLabel, setNewSubtaskLabel] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  // A flag so we only show the "endpoint unavailable" toast once per session
  const subtaskUnavailableShown = useRef(false);

  // ---- comment composer ----------------------------------------------------
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // ---- fetch ---------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, subtasksRes, activityRes] = await Promise.all([
        api.get<TaskRow>(`/tasks/${taskId}`).catch(() => ({ data: null })),
        api.get<Subtask[]>(`/tasks/${taskId}/subtasks`).catch(() => ({ data: [] })),
        api
          .get<TaskActivity[]>(`/tasks/${taskId}/activity`, { params: { limit: 50 } })
          .catch(() => ({ data: [] })),
      ]);
      if (taskRes.data) setTask(taskRes.data);
      setSubtasks(subtasksRes.data ?? []);
      setActivity(activityRes.data ?? []);
    } catch {
      // ignore — individual try/catches above already guard
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // Fetch on mount and taskId change
  useEffect(() => {
    setTask(null);
    setSubtasks([]);
    setActivity([]);
    setEditingTitle(false);
    setEditingDesc(false);
    setComment('');
    fetchAll();
  }, [taskId, fetchAll]);

  // Live-update from cross-page invalidation
  useInvalidationListener('tasks', fetchAll);

  // Escape key closes pane
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // If editing, cancel the edit instead of closing
        if (editingTitle) {
          setEditingTitle(false);
          return;
        }
        if (editingDesc) {
          setEditingDesc(false);
          return;
        }
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, editingTitle, editingDesc]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      const len = titleRef.current.value.length;
      titleRef.current.setSelectionRange(len, len);
    }
  }, [editingTitle]);

  // ---- mutations -----------------------------------------------------------

  async function patchTask(payload: Record<string, unknown>) {
    try {
      const r = await api.patch<TaskRow>(`/tasks/${taskId}`, payload);
      setTask(r.data);
      onChanged();
      invalidate('tasks');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to update task';
      toast.error(msg);
    }
  }

  async function patchStatus(status: TaskStatus) {
    // Optimistic
    setTask((prev) => (prev ? { ...prev, status } : prev));
    try {
      await api.patch(`/tasks/${taskId}/status`, { status });
      onChanged();
      invalidate('tasks');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to update status';
      toast.error(msg);
      fetchAll(); // revert
    }
  }

  // ---- title edit ----------------------------------------------------------

  function startEditTitle() {
    if (!task) return;
    setTitleDraft(task.title);
    setEditingTitle(true);
  }

  async function commitTitle() {
    if (!task) return;
    setEditingTitle(false);
    if (titleDraft.trim() === task.title) return;
    if (!titleDraft.trim()) return;
    await patchTask({ title: titleDraft.trim() });
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitTitle();
    }
  }

  // ---- description edit ----------------------------------------------------

  function startEditDesc() {
    if (!task) return;
    setDescDraft(task.description ?? '');
    setEditingDesc(true);
  }

  async function commitDesc() {
    if (!task) return;
    setEditingDesc(false);
    if (descDraft === (task.description ?? '')) return;
    await patchTask({ description: descDraft });
  }

  // ---- subtask actions -----------------------------------------------------

  async function toggleSubtask(sid: string, done: boolean) {
    try {
      await api.patch(`/subtasks/${sid}`, { done });
      // Optimistic already done in SubtaskRow; refetch for server truth
      const r = await api.get<Subtask[]>(`/tasks/${taskId}/subtasks`).catch(() => ({ data: [] }));
      setSubtasks(r.data ?? []);
      onChanged();
      invalidate('tasks');
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404 && !subtaskUnavailableShown.current) {
        subtaskUnavailableShown.current = true;
        toast.error('Subtasks endpoint not available yet');
      }
      // revert optimistic on error by refetching
      const r = await api.get<Subtask[]>(`/tasks/${taskId}/subtasks`).catch(() => ({ data: [] }));
      setSubtasks(r.data ?? []);
    }
  }

  async function addSubtask() {
    const label = newSubtaskLabel.trim();
    if (!label) return;
    setAddingSubtask(true);
    try {
      await api.post(`/tasks/${taskId}/subtasks`, { label });
      setNewSubtaskLabel('');
      const r = await api.get<Subtask[]>(`/tasks/${taskId}/subtasks`).catch(() => ({ data: [] }));
      setSubtasks(r.data ?? []);
      onChanged();
      invalidate('tasks');
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404 && !subtaskUnavailableShown.current) {
        subtaskUnavailableShown.current = true;
        toast.error('Subtasks endpoint not available yet');
      } else {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to add subtask';
        toast.error(msg);
      }
    } finally {
      setAddingSubtask(false);
    }
  }

  // ---- comment compose -----------------------------------------------------

  function handleCommentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setComment(val);
    // Detect @-mention trigger at the end
    const match = /@(\w*)$/.exec(val);
    setMentionQuery(match ? (match[1] ?? '') : null);
  }

  function insertMention(user: TaskUser) {
    const name = user.full_name ?? user.email;
    const replaced = comment.replace(/@(\w*)$/, `@${name} `);
    setComment(replaced);
    setMentionQuery(null);
    composerRef.current?.focus();
  }

  async function sendComment() {
    const body = comment.trim();
    if (!body) return;
    setPosting(true);
    try {
      await api.post(`/tasks/${taskId}/comments`, { body });
      setComment('');
      setMentionQuery(null);
      // Refetch activity
      const r = await api
        .get<TaskActivity[]>(`/tasks/${taskId}/activity`, { params: { limit: 50 } })
        .catch(() => ({ data: [] }));
      setActivity(r.data ?? []);
      onChanged();
      invalidate('tasks');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to post comment';
      toast.error(msg);
    } finally {
      setPosting(false);
    }
  }

  // ---- related-to ----------------------------------------------------------

  function RelatedTo() {
    if (!task) return <span className="text-muted">—</span>;
    if (task.consultant?.user) {
      const name = task.consultant.user.full_name ?? task.consultant.user.email;
      return (
        <Link to="/consultants" className="text-accent hover:underline text-[13px]">
          {name}
        </Link>
      );
    }
    if (task.recruiter?.user) {
      const name = task.recruiter.user.full_name ?? task.recruiter.user.email;
      return (
        <Link to="/recruiters" className="text-accent hover:underline text-[13px]">
          {name}
        </Link>
      );
    }
    return <span className="text-muted">—</span>;
  }

  // ---- derived -------------------------------------------------------------
  const subtaskDone = subtasks.filter((s) => s.done).length;
  const subtaskTotal = subtasks.length;

  const sortedActivity = [...activity].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const shortTaskId = task ? `TASK-${task.id.slice(0, 8)}` : `TASK-${taskId.slice(0, 8)}`;

  // ---- skeleton while loading ----------------------------------------------
  if (loading && !task) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-bg-elev">
        <div className="shrink-0 border-b border-border px-4 py-3 flex items-center gap-2">
          <span className="h-5 w-20 rounded bg-hover animate-pulse" />
          <span className="h-4 w-24 rounded bg-hover animate-pulse ml-2" />
          <span className="flex-1" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <div className="h-7 w-3/4 rounded bg-hover animate-pulse" />
          <div className="h-4 w-full rounded bg-hover animate-pulse" />
          <div className="h-4 w-2/3 rounded bg-hover animate-pulse" />
          <div className="h-28 w-full rounded-xl bg-hover animate-pulse" />
        </div>
      </div>
    );
  }

  // ---- render --------------------------------------------------------------
  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-elev">
      {/* ----------------------------------------------------------------- */}
      {/* 1. Top bar                                                         */}
      {/* ----------------------------------------------------------------- */}
      <div className="shrink-0 border-b border-border px-4 py-3 flex items-center gap-2">
        {/* Task ID pill */}
        <span className="text-[11px] font-mono bg-accent-soft text-accent rounded px-1.5 py-0.5 shrink-0">
          {shortTaskId}
        </span>

        {/* Last updated */}
        {task?.updated_at && (
          <span className="text-[11px] font-mono text-muted truncate">
            {relativeTime(task.updated_at)}
          </span>
        )}

        <span className="flex-1" />

        {/* Copy link */}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Copy link"
          leftIcon={<IconLink />}
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href);
            toast.success('Link copied');
          }}
        />

        {/* Close */}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Close"
          leftIcon={<IconX />}
          onClick={onClose}
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* 2. Scroll body                                                     */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        {/* ---- Title ---- */}
        <div>
          {editingTitle ? (
            <textarea
              ref={titleRef}
              className="w-full text-base font-semibold text-ink bg-bg-sunken rounded-lg px-2 py-1.5 resize-none border border-border-strong focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              rows={2}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
            />
          ) : (
            <h2
              className="text-base font-semibold text-ink cursor-text hover:bg-hover rounded px-1 py-0.5 -mx-1 transition-colors"
              onClick={startEditTitle}
              title="Click to edit"
            >
              {task?.title ?? '—'}
            </h2>
          )}
        </div>

        {/* ---- Description ---- */}
        <div>
          <SectionLabel>Description</SectionLabel>
          {editingDesc ? (
            <div className="space-y-2">
              <textarea
                className="w-full text-[13px] text-ink-2 bg-bg-sunken rounded-lg px-2 py-1.5 resize-y border border-border-strong focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent min-h-[80px]"
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="Add a description…"
              />
              <div className="flex gap-2">
                <Button variant="accent" size="sm" onClick={commitDesc}>
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingDesc(false);
                    setDescDraft('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="cursor-text hover:bg-hover rounded px-1 py-0.5 -mx-1 transition-colors"
              onClick={startEditDesc}
              title="Click to edit"
            >
              {task?.description ? (
                <p className="text-[13px] text-ink-2 whitespace-pre-wrap">{task.description}</p>
              ) : (
                <p className="text-[13px] text-muted italic">No description</p>
              )}
            </div>
          )}
        </div>

        {/* ---- Properties card ---- */}
        {task && (
          <div className="rounded-xl border border-border bg-surface p-3 space-y-2">
            {/* Status */}
            <PropRow label="Status">
              <Popover
                align="right"
                button={(open) => (
                  <button
                    type="button"
                    className={clsx(
                      'focus:outline-none rounded',
                      open && 'ring-2 ring-accent ring-offset-1',
                    )}
                  >
                    <TaskStatusBadge status={task.status} />
                  </button>
                )}
              >
                {(close) => (
                  <div className="space-y-0.5">
                    {TASK_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={clsx(
                          'flex items-center w-full px-2 py-1.5 rounded-md text-[13px] text-ink hover:bg-hover transition-colors gap-2',
                          s === task.status && 'bg-accent-soft text-accent',
                        )}
                        onClick={() => {
                          close();
                          patchStatus(s as TaskStatus);
                        }}
                      >
                        <TaskStatusBadge status={s as TaskStatus} />
                        <span className="ml-1">{TASK_STATUS_LABEL[s as TaskStatus]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            </PropRow>

            {/* Priority */}
            <PropRow label="Priority">
              <Popover
                align="right"
                button={(open) => (
                  <button
                    type="button"
                    className={clsx(
                      'focus:outline-none rounded',
                      open && 'ring-2 ring-accent ring-offset-1',
                    )}
                  >
                    <PriorityBadge priority={task.priority} />
                  </button>
                )}
              >
                {(close) => (
                  <div className="space-y-0.5">
                    {TASK_PRIORITIES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={clsx(
                          'flex items-center w-full px-2 py-1.5 rounded-md text-[13px] text-ink hover:bg-hover transition-colors gap-2',
                          p === task.priority && 'bg-accent-soft text-accent',
                        )}
                        onClick={() => {
                          close();
                          patchTask({ priority: p as TaskPriority });
                        }}
                      >
                        <PriorityBadge priority={p as TaskPriority} />
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            </PropRow>

            {/* Assignee */}
            <PropRow label="Assignee">
              <Popover
                align="right"
                button={() => (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 focus:outline-none rounded hover:bg-hover px-1 py-0.5 transition-colors"
                  >
                    {task.assignee ? (
                      <>
                        <Avatar
                          name={task.assignee.full_name}
                          email={task.assignee.email}
                          size={20}
                        />
                        <span className="text-[13px] text-ink truncate max-w-[120px]">
                          {task.assignee.full_name ?? task.assignee.email}
                        </span>
                      </>
                    ) : (
                      <span className="text-[13px] text-muted italic">Unassigned</span>
                    )}
                  </button>
                )}
              >
                {(close) => (
                  <div className="space-y-0.5">
                    {/* Unassign option */}
                    <button
                      type="button"
                      className={clsx(
                        'flex items-center w-full px-2 py-1.5 rounded-md text-[13px] text-muted italic hover:bg-hover transition-colors',
                        !task.assignee_id && 'bg-accent-soft text-accent',
                      )}
                      onClick={() => {
                        close();
                        patchTask({ assignee_id: null });
                      }}
                    >
                      Unassign
                    </button>
                    {users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className={clsx(
                          'flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[13px] text-ink hover:bg-hover transition-colors',
                          u.id === task.assignee_id && 'bg-accent-soft text-accent',
                        )}
                        onClick={() => {
                          close();
                          patchTask({ assignee_id: u.id });
                        }}
                      >
                        <Avatar name={u.full_name} email={u.email} size={20} />
                        <span className="truncate">{u.full_name ?? u.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            </PropRow>

            {/* Due date */}
            <PropRow label="Due">
              <input
                type="date"
                value={formatDateValue(task.due_at)}
                className="text-[13px] text-ink bg-transparent border border-border rounded px-1.5 py-0.5 focus:outline-none focus:border-accent cursor-pointer hover:border-border-strong transition-colors"
                onChange={(e) => {
                  const val = e.target.value;
                  patchTask({ due_at: val ? `${val}T00:00:00.000Z` : null });
                }}
              />
            </PropRow>

            {/* Related to */}
            <PropRow label="Related to">
              <RelatedTo />
            </PropRow>
          </div>
        )}

        {/* ---- Subtasks card ---- */}
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="flex items-center justify-between mb-2">
            <SectionLabel>
              Subtasks {subtaskTotal > 0 ? `${subtaskDone}/${subtaskTotal}` : ''}
            </SectionLabel>
            {subtaskTotal > 0 && (
              <div className="h-1 flex-1 ml-3 bg-hover rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all"
                  style={{
                    width:
                      subtaskTotal > 0
                        ? `${Math.round((subtaskDone / subtaskTotal) * 100)}%`
                        : '0%',
                  }}
                />
              </div>
            )}
          </div>

          <div className="space-y-0.5">
            {subtasks.map((s) => (
              <SubtaskRow key={s.id} subtask={s} onToggle={toggleSubtask} />
            ))}
          </div>

          {/* Add subtask row */}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
            <input
              type="text"
              className="flex-1 text-[13px] text-ink bg-bg-sunken rounded-md px-2 py-1 border border-border focus:outline-none focus:border-accent transition-colors placeholder:text-faint"
              placeholder="+ Add subtask…"
              value={newSubtaskLabel}
              onChange={(e) => setNewSubtaskLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSubtask();
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              loading={addingSubtask}
              onClick={addSubtask}
              disabled={!newSubtaskLabel.trim()}
            >
              Add
            </Button>
          </div>
        </div>

        {/* ---- Activity log ---- */}
        <div>
          <SectionLabel>Activity</SectionLabel>
          {sortedActivity.length === 0 ? (
            <p className="text-[13px] text-muted italic">No activity yet.</p>
          ) : (
            <div className="space-y-3">
              {sortedActivity.map((a) => {
                if (a.kind === 'comment') {
                  const body = String((a.payload?.body as string | undefined) ?? '');
                  return (
                    <div key={a.id} className="flex gap-2">
                      <Avatar name={a.actor?.full_name} email={a.actor?.email} size={24} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-[13px] font-medium text-ink">
                            {a.actor?.full_name ?? a.actor?.email ?? 'Unknown'}
                          </span>
                          <span className="text-[11px] font-mono text-muted">
                            {relativeTime(a.created_at)}
                          </span>
                        </div>
                        <div className="bg-bg-sunken rounded-lg p-2 text-[13px] text-ink-2 whitespace-pre-wrap break-words">
                          {body}
                        </div>
                      </div>
                    </div>
                  );
                }
                // Non-comment activity
                return (
                  <div key={a.id} className="flex items-center gap-1.5">
                    <span className="text-muted text-[12px]">•</span>
                    <span className="text-[12px] font-mono text-muted">
                      {a.actor?.full_name ?? a.actor?.email ?? 'System'}
                    </span>
                    <span className="text-[12px] text-muted">{describeActivity(a)}</span>
                    <span className="text-[11px] font-mono text-faint ml-auto shrink-0">
                      {relativeTime(a.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* 3. Sticky comment composer                                         */}
      {/* ----------------------------------------------------------------- */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="relative">
          {/* @mention dropdown */}
          {mentionQuery !== null && (
            <MentionDropdown users={users} query={mentionQuery} onSelect={insertMention} />
          )}

          <textarea
            ref={composerRef}
            className="w-full text-[13px] text-ink bg-bg-sunken rounded-lg px-3 py-2 border border-border focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent resize-none placeholder:text-faint mb-2"
            rows={2}
            placeholder="Add a comment… (@mention, #tag)"
            value={comment}
            onChange={handleCommentChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendComment();
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Attach file"
            leftIcon={<IconPaperclip />}
            onClick={() => toast('File attachments coming soon')}
          />
          <Button variant="accent" size="sm" loading={posting} onClick={sendComment}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
