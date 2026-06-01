import { ReactNode, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import {
  PriorityBadge,
  TaskStatusBadge,
  DuePill,
  Avatar,
  TagPill,
  shortId,
} from '../components/TaskBits';
import { SelectInput } from '../components/SelectInput';
import { DateTimePicker } from '../components/DateTimePicker';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Task,
  TaskComment,
  TaskAttachment,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUS_LABEL,
  TaskStatus,
  TaskPriority,
  MANAGER_TIER,
  Role,
} from '../types';
import { invalidate } from '../hooks/useInvalidate';
import toast from 'react-hot-toast';

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  // Use the shared MANAGER_TIER tier so DIRECTOR / CTO / CEO / HR_MANAGER /
  // DEVELOPER can edit tasks too — backend tasks.controller.ts allows them.
  const isManager = !!profile && (MANAGER_TIER as Role[]).includes(profile.role);

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // Assignable users for the reassign picker (manager-tier only) — same source
  // and backend scoping the board's detail pane uses (admin → all, lead → group).
  const [assignees, setAssignees] = useState<
    Array<{ id: string; full_name: string | null; email: string }>
  >([]);
  useEffect(() => {
    if (!isManager) return;
    api
      .get('/tasks/assignees')
      .then((r) => setAssignees(r.data ?? []))
      .catch(() => {});
  }, [isManager]);

  async function loadAll() {
    if (!id) return;
    const [t, c, a] = await Promise.all([
      api.get(`/tasks/${id}`),
      api.get(`/tasks/${id}/comments`),
      api.get(`/tasks/${id}/attachments`),
    ]);
    setTask(t.data);
    setComments(c.data ?? []);
    setAttachments(a.data ?? []);
  }

  const [loadError, setLoadError] = useState<{ status?: number; message?: string } | null>(null);
  useEffect(() => {
    setLoadError(null);
    loadAll().catch((e) => {
      // Track the error so the page can render an EmptyState instead of an
      // infinite SkeletonCard. The toast still fires for transient errors
      // (network blip, timeout), but a 404/403 lands the user on a clear
      // "not found" panel with a way back to the task list.
      const status = e?.response?.status as number | undefined;
      const message = (e?.response?.data?.error as string | undefined) ?? 'Failed to load';
      setLoadError({ status, message });
      toast.error(message);
    });
    // eslint-disable-next-line
  }, [id]);

  if (loadError && !task) {
    const isNotFound = loadError.status === 404 || loadError.status === 403;
    return (
      <Layout title="Task">
        <div className="max-w-3xl">
          <EmptyState
            title={isNotFound ? 'Task not found' : 'Could not load task'}
            description={
              isNotFound
                ? 'This task may have been deleted or moved out of your scope.'
                : (loadError.message ?? 'Please try again in a moment.')
            }
            action={
              <Link
                to="/tasks"
                className="text-sm px-4 py-2 rounded-lg bg-ink text-bg hover:opacity-90"
              >
                Back to tasks
              </Link>
            }
          />
        </div>
      </Layout>
    );
  }

  if (!task) {
    return (
      <Layout title="Task">
        <div className="max-w-3xl">
          <SkeletonCard lines={6} />
        </div>
      </Layout>
    );
  }

  const isAssignee = task.assignee_id === profile?.id;
  const canEdit = isManager;
  const canChangeStatus = isManager || isAssignee;

  async function patch(payload: Partial<Task>) {
    try {
      const r = await api.patch(`/tasks/${id}`, payload);
      setTask(r.data);
      // Notify Tasks board / TasksAssignedToMe / dashboard cards.
      invalidate('tasks');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Update failed');
    }
  }

  async function changeStatus(status: TaskStatus) {
    try {
      const r = await api.patch(`/tasks/${id}/status`, { status });
      setTask(r.data);
      invalidate('tasks');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Status update failed');
    }
  }

  async function postComment() {
    if (!newComment.trim()) return;
    setPosting(true);
    try {
      const r = await api.post(`/tasks/${id}/comments`, { body: newComment });
      setComments([...comments, r.data]);
      setNewComment('');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to comment');
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment(cid: string) {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.delete(`/tasks/comments/${cid}`);
      setComments(comments.filter((c) => c.id !== cid));
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to delete');
    }
  }

  async function uploadFile(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      // Let axios pick the multipart boundary — manual Content-Type strips it.
      await api.post(`/tasks/${id}/attachments`, fd);
      const r = await api.get(`/tasks/${id}/attachments`);
      setAttachments(r.data ?? []);
      toast.success('Uploaded');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Upload failed');
    }
  }

  async function deleteAttachment(aid: string) {
    if (!confirm('Delete this attachment?')) return;
    try {
      await api.delete(`/tasks/attachments/${aid}`);
      setAttachments(attachments.filter((a) => a.id !== aid));
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to delete');
    }
  }

  async function deleteTask() {
    if (!confirm('Delete this task permanently?')) return;
    try {
      await api.delete(`/tasks/${id}`);
      toast.success('Task deleted');
      invalidate('tasks');
      navigate('/tasks');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Delete failed');
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}/tasks/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      window.prompt('Copy this link', url);
    }
  }

  function addTag() {
    if (!task) return;
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    const tags = task.tags ?? [];
    if (tags.includes(t)) {
      setTagInput('');
      return;
    }
    const newTags = [...tags, t];
    patch({ tags: newTags });
    setTagInput('');
  }
  function removeTag(t: string) {
    if (!task) return;
    const newTags = (task.tags ?? []).filter((x) => x !== t);
    patch({ tags: newTags });
  }

  const sid = shortId(task.id);

  return (
    <Layout
      title={sid}
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Tasks', to: '/tasks' },
        { label: 'Board', to: '/tasks?view=board' },
        { label: sid },
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 max-w-6xl">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface rounded-xl border border-border p-4 sm:p-6">
            {/* ID row — flex-wrap so the Copy-link button doesn't crowd the
                short-id pill on narrow viewports. */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted bg-hover px-1.5 py-0.5 rounded">
                  {sid}
                </span>
                <span className="text-muted">›</span>
                {task.tags && task.tags.length > 0 ? (
                  <TagPill tag={task.tags[0]!} />
                ) : (
                  <span className="text-xs text-muted">No tag</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" leftIcon={<span>⧉</span>} onClick={copyLink}>
                  Copy link
                </Button>
              </div>
            </div>

            {/* Title */}
            {canEdit ? (
              <input
                value={task.title}
                onChange={(e) => setTask({ ...task, title: e.target.value })}
                onBlur={(e) => patch({ title: e.target.value })}
                className="w-full text-2xl font-semibold tracking-tight text-ink border-b border-transparent hover:border-border focus:border-brand-500 focus:outline-none pb-1"
              />
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{task.title}</h1>
            )}

            {/* Meta row */}
            <p className="text-xs text-muted mt-3">
              Created by{' '}
              <span className="text-ink font-medium">
                {task.creator?.full_name ?? task.creator?.email ?? '—'}
              </span>
              {' · '}
              {new Date(task.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
              {' · '}
              Updated <span className="text-ink">{relative(task.updated_at)}</span>
            </p>

            {/* Description */}
            <div className="mt-5">
              <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-1.5">
                Description
              </div>
              {canEdit ? (
                <textarea
                  rows={4}
                  value={task.description ?? ''}
                  onChange={(e) => setTask({ ...task, description: e.target.value })}
                  onBlur={(e) => patch({ description: e.target.value })}
                  className="w-full bg-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:bg-surface"
                  placeholder="Add a description…"
                />
              ) : (
                <p className="text-sm text-ink whitespace-pre-wrap">
                  {task.description || <span className="text-muted italic">No description</span>}
                </p>
              )}
            </div>
          </div>

          {/* Comments */}
          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-ink mb-3">
              Comments <span className="text-muted font-normal">({comments.length})</span>
            </h3>
            <div className="space-y-3 mb-3">
              {comments.length === 0 && (
                <p className="text-sm text-muted italic">No comments yet</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2.5">
                  <Avatar name={c.author?.full_name} email={c.author?.email} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-ink">
                        {c.author?.full_name ?? c.author?.email ?? 'Unknown'}
                      </span>
                      <span className="text-muted">{relative(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-ink whitespace-pre-wrap mt-0.5">{c.body}</p>
                    {(c.author_id === profile?.id || isManager) && (
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        onClick={() => deleteComment(c.id)}
                        className="mt-1"
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 pt-3 border-t border-border">
              <Avatar name={profile?.full_name} email={profile?.email} size={28} />
              <textarea
                rows={2}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment…"
                className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
              <Button variant="primary" size="sm" onClick={postComment} loading={posting}>
                {posting ? 'Posting…' : 'Post'}
              </Button>
            </div>
          </div>

          {/* Attachments */}
          <div className="bg-surface rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-ink">
                Attachments <span className="text-muted font-normal">({attachments.length})</span>
              </h3>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<span>📎</span>}
                onClick={() => fileRef.current?.click()}
              >
                Upload
              </Button>
            </div>
            <div className="space-y-1">
              {attachments.length === 0 && (
                <p className="text-sm text-muted italic">No attachments</p>
              )}
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between text-sm border-b border-border last:border-0 py-1.5"
                >
                  <a
                    href={a.download_url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 hover:underline truncate max-w-[60%] inline-flex items-center gap-1.5"
                  >
                    <span className="text-muted">📄</span>
                    {a.file_name}
                  </a>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{a.uploader?.full_name ?? a.uploader?.email ?? '—'}</span>
                    {(a.uploaded_by === profile?.id || isManager) && (
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        onClick={() => deleteAttachment(a.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar / properties */}
        <div className="space-y-4">
          <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-[10px] font-semibold tracking-widest text-muted uppercase">
              Details
            </div>
            <div className="p-4 space-y-4 text-sm">
              <Field label="Status">
                {canChangeStatus ? (
                  <SelectInput
                    value={task.status}
                    onChange={(e) => changeStatus(e.target.value as TaskStatus)}
                    options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] }))}
                  />
                ) : (
                  <TaskStatusBadge status={task.status} />
                )}
              </Field>

              <Field label="Priority">
                {canEdit ? (
                  <SelectInput
                    value={task.priority}
                    onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
                    options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
                  />
                ) : (
                  <PriorityBadge priority={task.priority} />
                )}
              </Field>

              <Field label="Assignee">
                {canEdit ? (
                  <SelectInput
                    value={task.assignee_id ?? ''}
                    onChange={(e) => patch({ assignee_id: e.target.value || null })}
                    options={[
                      { value: '', label: 'Unassigned' },
                      // Keep the current assignee selectable even if they're
                      // outside the fetched (scoped) list.
                      ...(task.assignee_id && !assignees.some((u) => u.id === task.assignee_id)
                        ? [
                            {
                              value: task.assignee_id,
                              label:
                                task.assignee?.full_name ??
                                task.assignee?.email ??
                                'Current assignee',
                            },
                          ]
                        : []),
                      ...assignees.map((u) => ({ value: u.id, label: u.full_name ?? u.email })),
                    ]}
                  />
                ) : task.assignee ? (
                  <span className="inline-flex items-center gap-1.5 text-ink">
                    <Avatar name={task.assignee.full_name} email={task.assignee.email} size={22} />
                    <span className="truncate">
                      {task.assignee.full_name ?? task.assignee.email}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted italic text-xs">Unassigned</span>
                )}
              </Field>

              {task.consultant && (
                <Field label="Consultant">
                  <span className="inline-flex items-center gap-1.5 text-ink">
                    <Avatar
                      name={task.consultant.user?.full_name}
                      email={task.consultant.user?.email}
                      size={22}
                    />
                    <span className="truncate">
                      {task.consultant.user?.full_name ?? task.consultant.user?.email}
                    </span>
                  </span>
                </Field>
              )}

              <Field label="Due date" align="start">
                {canEdit ? (
                  <DateTimePicker
                    value={task.due_at ? isoToLocalInput(task.due_at) : ''}
                    onChange={(v) => patch({ due_at: v ? new Date(v).toISOString() : null })}
                    hidePresets
                  />
                ) : (
                  <DuePill task={task} />
                )}
              </Field>

              <Field label="Created">
                <span className="text-ink">
                  {new Date(task.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </Field>

              <Field label="Tags" align="start">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(task.tags ?? []).map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100"
                    >
                      {t}
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          onClick={() => removeTag(t)}
                          aria-label={`Remove ${t}`}
                          className="!h-auto !px-0 !rounded-none text-brand-400 hover:text-brand-700"
                        >
                          ×
                        </Button>
                      )}
                    </span>
                  ))}
                  {canEdit && (
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="+ Add"
                      className="text-[11px] border border-border rounded-full px-2 py-0.5 outline-none w-20 focus:ring-2 focus:ring-brand-500/30"
                    />
                  )}
                  {(task.tags ?? []).length === 0 && !canEdit && (
                    <span className="text-xs text-muted italic">None</span>
                  )}
                </div>
              </Field>
            </div>
          </div>

          {task.consultant && (
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-3">
                Linked record
              </div>
              <div className="flex items-center gap-3">
                <Avatar
                  name={task.consultant.user?.full_name}
                  email={task.consultant.user?.email}
                  size={36}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {task.consultant.user?.full_name ?? task.consultant.user?.email}
                  </div>
                  <div className="text-xs text-muted">Consultant</div>
                </div>
              </div>
              {/* The /consultants list is OPERATOR_TIER-only; a viewer who's
                  themselves a consultant would land on /unauthorized. The
                  /users/:id profile route is open server-side, so route there
                  when we know the underlying user id. */}
              {profile?.role !== 'CONSULTANT' && (task.consultant as any)?.user?.id && (
                <div className="mt-3">
                  <Link
                    to={`/users/${(task.consultant as any).user.id}`}
                    className="text-xs text-brand-700 hover:underline"
                  >
                    Open consultant profile →
                  </Link>
                </div>
              )}
            </div>
          )}

          {canEdit && (
            <Button variant="danger" block onClick={deleteTask}>
              Delete task
            </Button>
          )}
        </div>
      </div>
    </Layout>
  );
}

/** A labelled property row in the Details panel — muted uppercase label in a
 *  fixed column, value beside it, consistent vertical rhythm. */
function Field({
  label,
  children,
  align = 'center',
}: {
  label: string;
  children: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={`grid grid-cols-[5.5rem_1fr] gap-3 ${align === 'start' ? 'items-start' : 'items-center'}`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Convert a UTC ISO timestamp to the local YYYY-MM-DDTHH:mm string the
 *  datetime-local input expects. Doing `toISOString().slice(0,16)` is wrong
 *  because it returns UTC, off by the user's TZ offset. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
