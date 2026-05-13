import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import {
  PriorityBadge, TaskStatusBadge, DuePill, Avatar, TagPill, shortId,
} from '../components/TaskBits';
import { SelectInput } from '../components/SelectInput';
import { DateTimePicker } from '../components/DateTimePicker';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Task, TaskComment, TaskAttachment,
  TASK_STATUSES, TASK_PRIORITIES, TASK_STATUS_LABEL, TaskStatus, TaskPriority,
} from '../types';
import toast from 'react-hot-toast';

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isManager = profile?.role === 'SUPER_ADMIN' || profile?.role === 'MANAGER';

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadAll() {
    if (!id) return;
    const [t, c, a] = await Promise.all([
      api.get(`/tasks/${id}`),
      api.get(`/tasks/${id}/comments`),
      api.get(`/tasks/${id}/attachments`),
    ]);
    setTask(t.data); setComments(c.data ?? []); setAttachments(a.data ?? []);
  }

  useEffect(() => {
    loadAll().catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load'));
    // eslint-disable-next-line
  }, [id]);

  if (!task) {
    return <Layout title="Task"><div className="text-sm text-slate-500">Loading…</div></Layout>;
  }

  const isAssignee = task.assignee_id === profile?.id;
  const canEdit = isManager;
  const canChangeStatus = isManager || isAssignee;

  async function patch(payload: Partial<Task>) {
    try {
      const r = await api.patch(`/tasks/${id}`, payload);
      setTask(r.data);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Update failed');
    }
  }

  async function changeStatus(status: TaskStatus) {
    try {
      const r = await api.patch(`/tasks/${id}/status`, { status });
      setTask(r.data);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Status update failed');
    }
  }

  async function postComment() {
    if (!newComment.trim()) return;
    setPosting(true);
    try {
      const r = await api.post(`/tasks/${id}/comments`, { body: newComment });
      setComments([...comments, r.data]); setNewComment('');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to comment');
    } finally { setPosting(false); }
  }

  async function deleteComment(cid: string) {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.delete(`/tasks/comments/${cid}`);
      setComments(comments.filter(c => c.id !== cid));
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to delete');
    }
  }

  async function uploadFile(file: File) {
    const fd = new FormData(); fd.append('file', file);
    try {
      // Let axios pick the multipart boundary — manual Content-Type strips it.
      await api.post(`/tasks/${id}/attachments`, fd);
      const r = await api.get(`/tasks/${id}/attachments`);
      setAttachments(r.data ?? []); toast.success('Uploaded');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Upload failed');
    }
  }

  async function deleteAttachment(aid: string) {
    if (!confirm('Delete this attachment?')) return;
    try {
      await api.delete(`/tasks/attachments/${aid}`);
      setAttachments(attachments.filter(a => a.id !== aid));
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed to delete'); }
  }

  async function deleteTask() {
    if (!confirm('Delete this task permanently?')) return;
    try {
      await api.delete(`/tasks/${id}`);
      toast.success('Task deleted'); navigate('/tasks');
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Delete failed'); }
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
    if (tags.includes(t)) { setTagInput(''); return; }
    const newTags = [...tags, t];
    patch({ tags: newTags });
    setTagInput('');
  }
  function removeTag(t: string) {
    if (!task) return;
    const newTags = (task.tags ?? []).filter(x => x !== t);
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            {/* ID row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{sid}</span>
                <span className="text-slate-400">›</span>
                {task.tags && task.tags.length > 0 ? <TagPill tag={task.tags[0]!} /> : <span className="text-xs text-slate-400">No tag</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={copyLink} className="text-xs text-slate-600 hover:text-slate-900 border border-slate-200 px-2 py-1 rounded-md inline-flex items-center gap-1 hover:bg-slate-50">
                  <span>⧉</span> Copy link
                </button>
              </div>
            </div>

            {/* Title */}
            {canEdit ? (
              <input
                value={task.title}
                onChange={(e) => setTask({ ...task, title: e.target.value })}
                onBlur={(e) => patch({ title: e.target.value })}
                className="w-full text-2xl font-semibold tracking-tight text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-brand-500 focus:outline-none pb-1"
              />
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{task.title}</h1>
            )}

            {/* Meta row */}
            <p className="text-xs text-slate-500 mt-3">
              Created by{' '}
              <span className="text-slate-700 font-medium">{task.creator?.full_name ?? task.creator?.email ?? '—'}</span>
              {' · '}{new Date(task.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              {' · '}
              Updated <span className="text-slate-700">{relative(task.updated_at)}</span>
            </p>

            {/* Description */}
            <div className="mt-5">
              <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">Description</div>
              {canEdit ? (
                <textarea
                  rows={4}
                  value={task.description ?? ''}
                  onChange={(e) => setTask({ ...task, description: e.target.value })}
                  onBlur={(e) => patch({ description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:bg-white"
                  placeholder="Add a description…"
                />
              ) : (
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{task.description || <span className="text-slate-400 italic">No description</span>}</p>
              )}
            </div>
          </div>

          {/* Comments */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Comments <span className="text-slate-400 font-normal">({comments.length})</span>
            </h3>
            <div className="space-y-3 mb-3">
              {comments.length === 0 && <p className="text-sm text-slate-400 italic">No comments yet</p>}
              {comments.map(c => (
                <div key={c.id} className="flex items-start gap-2.5">
                  <Avatar name={c.author?.full_name} email={c.author?.email} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-slate-900">{c.author?.full_name ?? c.author?.email ?? 'Unknown'}</span>
                      <span className="text-slate-400">{relative(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap mt-0.5">{c.body}</p>
                    {(c.author_id === profile?.id || isManager) && (
                      <button onClick={() => deleteComment(c.id)} className="text-[11px] text-slate-400 hover:text-red-600 mt-1">Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 pt-3 border-t border-slate-100">
              <Avatar name={profile?.full_name} email={profile?.email} size={28} />
              <textarea
                rows={2} value={newComment} onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment…"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
              <button onClick={postComment} disabled={posting}
                className="bg-slate-900 text-white text-sm px-3 py-2 rounded-lg disabled:opacity-50">
                {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>

          {/* Attachments */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-900">Attachments <span className="text-slate-400 font-normal">({attachments.length})</span></h3>
              <input ref={fileRef} type="file" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); if (fileRef.current) fileRef.current.value = ''; }} />
              <button onClick={() => fileRef.current?.click()}
                className="text-xs text-slate-600 hover:text-slate-900 border border-slate-200 px-2 py-1 rounded-md inline-flex items-center gap-1 hover:bg-slate-50">
                <span>📎</span> Upload
              </button>
            </div>
            <div className="space-y-1">
              {attachments.length === 0 && <p className="text-sm text-slate-400 italic">No attachments</p>}
              {attachments.map(a => (
                <div key={a.id} className="flex items-center justify-between text-sm border-b border-slate-100 last:border-0 py-1.5">
                  <a href={a.download_url ?? '#'} target="_blank" rel="noopener noreferrer"
                    className="text-brand-700 hover:underline truncate max-w-[60%] inline-flex items-center gap-1.5">
                    <span className="text-slate-400">📄</span>{a.file_name}
                  </a>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{a.uploader?.full_name ?? a.uploader?.email ?? '—'}</span>
                    {(a.uploaded_by === profile?.id || isManager) && (
                      <button onClick={() => deleteAttachment(a.id)} className="text-red-600 hover:underline">Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar / properties */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-3.5 items-center text-sm">
              <span className="text-slate-500">Status</span>
              <div>
                {canChangeStatus ? (
                  <SelectInput value={task.status}
                    onChange={(e) => changeStatus(e.target.value as TaskStatus)}
                    options={TASK_STATUSES.map(s => ({ value: s, label: TASK_STATUS_LABEL[s] }))}
                  />
                ) : <TaskStatusBadge status={task.status} />}
              </div>

              <span className="text-slate-500">Priority</span>
              <div>
                {canEdit ? (
                  <SelectInput value={task.priority}
                    onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
                    options={TASK_PRIORITIES.map(p => ({ value: p, label: p }))}
                  />
                ) : <PriorityBadge priority={task.priority} />}
              </div>

              <span className="text-slate-500">Assignee</span>
              <div>
                {task.assignee ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-900">
                    <Avatar name={task.assignee.full_name} email={task.assignee.email} size={22} />
                    {task.assignee.full_name ?? task.assignee.email}
                  </span>
                ) : <span className="text-slate-400 italic text-xs">Unassigned</span>}
              </div>

              {task.consultant && (
                <>
                  <span className="text-slate-500">Consultant</span>
                  <span className="inline-flex items-center gap-1.5 text-slate-900">
                    <Avatar name={task.consultant.user?.full_name} email={task.consultant.user?.email} size={22} />
                    {task.consultant.user?.full_name ?? task.consultant.user?.email}
                  </span>
                </>
              )}

              <span className="text-slate-500">Due date</span>
              <div>
                {canEdit ? (
                  <DateTimePicker
                    value={task.due_at ? isoToLocalInput(task.due_at) : ''}
                    onChange={(v) => patch({ due_at: v ? new Date(v).toISOString() : null })}
                    hidePresets
                  />
                ) : <DuePill task={task} />}
              </div>

              <span className="text-slate-500">Created</span>
              <span className="text-slate-700">{new Date(task.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>

              <span className="text-slate-500 self-start mt-0.5">Tags</span>
              <div className="flex flex-wrap items-center gap-1">
                {(task.tags ?? []).map(t => (
                  <span key={t} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    {t}
                    {canEdit && <button onClick={() => removeTag(t)} className="text-slate-400 hover:text-slate-700">×</button>}
                  </span>
                ))}
                {canEdit && (
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                    }}
                    placeholder="+ Add"
                    className="text-[11px] border border-slate-200 rounded-full px-2 py-0.5 outline-none w-20 focus:ring-2 focus:ring-brand-500/30"
                  />
                )}
              </div>
            </div>
          </div>

          {task.consultant && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-3">Linked record</div>
              <div className="flex items-center gap-3">
                <Avatar name={task.consultant.user?.full_name} email={task.consultant.user?.email} size={36} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{task.consultant.user?.full_name ?? task.consultant.user?.email}</div>
                  <div className="text-xs text-slate-500">Consultant</div>
                </div>
              </div>
              <div className="mt-3">
                <Link to="/consultants" className="text-xs text-brand-700 hover:underline">Open consultant profile →</Link>
              </div>
            </div>
          )}

          {canEdit && (
            <button onClick={deleteTask}
              className="w-full bg-white border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg hover:bg-red-50">
              Delete task
            </button>
          )}
        </div>
      </div>
    </Layout>
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
