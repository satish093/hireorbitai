import { useEffect, useMemo, useState, DragEvent, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { DateTimePicker } from '../components/DateTimePicker';
import { SelectInput } from '../components/SelectInput';
import {
  PriorityBadge,
  TaskStatusBadge,
  DuePill,
  AssigneeChip,
  Avatar,
  TagPill,
  shortId,
  isOverdue,
} from '../components/TaskBits';
import { GroupBadge } from '../components/GroupBadge';
import { SavedTaskFilters } from '../components/SavedTaskFilters';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUS_LABEL,
  MANAGER_TIER,
  Role,
} from '../types';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import toast from 'react-hot-toast';
import clsx from 'clsx';

type ViewMode = 'board' | 'list';

interface FilterState {
  status?: TaskStatus | '';
  priority?: TaskPriority | '';
  assignee_id?: string;
  consultant_id?: string;
  recruiter_id?: string;
  q?: string;
  overdue?: boolean;
}

// Local FilterState uses '' to represent "no filter" on the select inputs,
// but the saved-filters API stores only the active values. Coerce here so
// the dropdown can summarize / save without seeing those empty strings.
function toCriteria(f: FilterState) {
  return {
    status: f.status || undefined,
    priority: f.priority || undefined,
    assignee_id: f.assignee_id || undefined,
    consultant_id: f.consultant_id || undefined,
    recruiter_id: f.recruiter_id || undefined,
    q: f.q || undefined,
    overdue: f.overdue ? true : undefined,
  };
}

const STATUS_DOT: Record<TaskStatus, string> = {
  BACKLOG: 'bg-slate-400',
  TODO: 'bg-blue-500',
  IN_PROGRESS: 'bg-amber-500',
  BLOCKED: 'bg-red-500',
  REVIEW: 'bg-purple-500',
  COMPLETED: 'bg-emerald-500',
  CANCELLED: 'bg-slate-300',
};

export function Tasks() {
  const { profile } = useAuth();
  // Use the shared MANAGER_TIER constant so DIRECTOR / CTO / CEO / HR_MANAGER
  // / DEVELOPER also get the create button + assignee filter. The narrow
  // `=== 'SUPER_ADMIN' || === 'MANAGER'` check used to lock those roles out
  // even though the backend tasks.controller.ts allows the full tier.
  const isManager = !!profile && (MANAGER_TIER as Role[]).includes(profile.role);
  const [params, setParams] = useSearchParams();
  const view: ViewMode = (params.get('view') as ViewMode) ?? 'board';

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<
    { id: string; full_name?: string; email: string; role: string }[]
  >([]);
  const [filters, setFilters] = useState<FilterState>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  // Bumped by the cross-page invalidation channel so a sibling page mutation
  // (TaskDetail edit, TasksAssignedToMe complete, etc.) refetches us without
  // a hard reload.
  const [reloadTick, setReloadTick] = useState(0);
  useInvalidationListener('tasks', () => setReloadTick((n) => n + 1));

  function buildQuery(f: FilterState): Record<string, string> {
    const out: Record<string, string> = {};
    if (f.status) out.status = f.status;
    if (f.priority) out.priority = f.priority;
    if (f.assignee_id) out.assignee_id = f.assignee_id;
    if (f.consultant_id) out.consultant_id = f.consultant_id;
    if (f.recruiter_id) out.recruiter_id = f.recruiter_id;
    if (f.q) out.q = f.q;
    if (f.overdue) out.overdue = 'true';
    return out;
  }

  async function load(signal?: AbortSignal) {
    setLoading(true);
    try {
      const r = await api.get('/tasks', { params: buildQuery(filters), signal });
      setTasks(r.data ?? []);
    } catch (e: any) {
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return;
      toast.error(e?.response?.data?.error ?? 'Failed to load tasks');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  // Debounce the search query so each keystroke doesn't fire a request;
  // abort in-flight requests when filters change to prevent out-of-order
  // responses from clobbering newer state.
  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(
      () => {
        load(controller.signal);
      },
      filters.q ? 300 : 0,
    );
    return () => {
      clearTimeout(t);
      controller.abort();
    };
    // eslint-disable-next-line
  }, [JSON.stringify(filters), reloadTick]);

  useEffect(() => {
    if (!isManager) return;
    Promise.all([
      api.get('/recruiters').catch(() => ({ data: [] })),
      api.get('/consultants').catch(() => ({ data: [] })),
    ]).then(([recs, cons]) => {
      const seen = new Map<string, any>();
      for (const r of recs.data ?? []) {
        if (r.user_id)
          seen.set(r.user_id, {
            id: r.user_id,
            full_name: r.user?.full_name,
            email: r.user?.email,
            role: 'RECRUITER',
          });
      }
      for (const c of cons.data ?? []) {
        if (c.user_id)
          seen.set(c.user_id, {
            id: c.user_id,
            full_name: c.user?.full_name,
            email: c.user?.email,
            role: 'CONSULTANT',
          });
      }
      if (profile)
        seen.set(profile.id, {
          id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          role: profile.role,
        });
      setUsers(Array.from(seen.values()));
    });
  }, [isManager, profile]);

  async function quickStatusChange(taskId: string, newStatus: TaskStatus) {
    const prev = tasks;
    setTasks(tasks.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
    try {
      await api.patch(`/tasks/${taskId}/status`, { status: newStatus });
      // Notify TaskDetail / TasksAssignedToMe / dashboard cards.
      invalidate('tasks');
    } catch (e: any) {
      setTasks(prev);
      toast.error(e?.response?.data?.error ?? 'Status update failed');
    }
  }

  return (
    <Layout
      title="Tasks"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Tasks', to: '/tasks' },
        { label: view === 'board' ? 'Board' : 'List' },
      ]}
    >
      {/* Page heading row — wraps on narrow viewports so the toolbar doesn't
          overflow horizontally. Title + count stays as a unit; toggle and
          actions can break to their own line on mobile. */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 truncate">
            Team tasks
          </h1>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
            {tasks.length} total
          </span>
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
          <ViewToggleBtn active={view === 'board'} onClick={() => setParams({ view: 'board' })}>
            Board
          </ViewToggleBtn>
          <ViewToggleBtn active={view === 'list'} onClick={() => setParams({ view: 'list' })}>
            List
          </ViewToggleBtn>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/tasks/me"
            className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 whitespace-nowrap"
          >
            <span className="hidden sm:inline">Assigned to me</span>
            <span className="sm:hidden">Mine</span>
            <span>→</span>
          </Link>
          {isManager && (
            <button
              onClick={() => setCreateOpen(true)}
              className="bg-slate-900 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>+</span>
              <span className="hidden sm:inline">New task</span>
              <span className="sm:hidden">New</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter row — saved-filters dropdown drops below the chip bar on
          narrow viewports rather than fighting it for horizontal space. */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            users={users}
            isManager={isManager}
          />
        </div>
        <SavedTaskFilters
          current={toCriteria(filters)}
          onApply={(c) => setFilters(c as FilterState)}
          onLoadDefault={(c) => setFilters(c as FilterState)}
        />
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 mt-6">Loading…</div>
      ) : (
        <div className="mt-5">
          {view === 'board' ? (
            <BoardView tasks={tasks} onStatusChange={quickStatusChange} />
          ) : (
            <ListView tasks={tasks} />
          )}
        </div>
      )}

      {createOpen && (
        <CreateTaskModal
          users={users}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />
      )}
    </Layout>
  );
}

function ViewToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-3 py-1 rounded-md transition',
        active
          ? 'bg-white text-slate-900 shadow-sm font-medium'
          : 'text-slate-600 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Filter bar — pill style
// ---------------------------------------------------------------------------
function FilterBar({
  filters,
  setFilters,
  users,
  isManager,
}: {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  users: { id: string; full_name?: string; email: string; role: string }[];
  isManager: boolean;
}) {
  const pill =
    'border border-slate-200 bg-white rounded-full pl-3 pr-2.5 py-1 text-sm text-slate-700 inline-flex items-center gap-1.5 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500/40';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={pill}>
        <span className="text-slate-400">⌕</span>
        <input
          type="text"
          placeholder="Search title…"
          value={filters.q ?? ''}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          className="bg-transparent outline-none text-sm w-40"
        />
      </div>
      <PillSelect
        label="Status"
        value={filters.status ?? ''}
        onChange={(v) => setFilters({ ...filters, status: (v || '') as TaskStatus | '' })}
        options={[
          { value: '', label: 'Open' },
          ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] })),
        ]}
      />
      <PillSelect
        label="Priority"
        value={filters.priority ?? ''}
        onChange={(v) => setFilters({ ...filters, priority: (v || '') as TaskPriority | '' })}
        options={[
          { value: '', label: 'All' },
          ...TASK_PRIORITIES.map((p) => ({ value: p, label: p })),
        ]}
      />
      {isManager && (
        <PillSelect
          label="Assignee"
          value={filters.assignee_id ?? ''}
          onChange={(v) => setFilters({ ...filters, assignee_id: v || undefined })}
          options={[
            { value: '', label: 'All' },
            ...users.map((u) => ({ value: u.id, label: `${u.full_name ?? u.email}` })),
          ]}
        />
      )}
      <button
        onClick={() => setFilters({ ...filters, overdue: !filters.overdue })}
        className={clsx(
          'rounded-full border px-3 py-1 text-sm',
          filters.overdue
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
        )}
      >
        {filters.overdue ? '⚠ Overdue only' : 'Overdue'}
      </button>
    </div>
  );
}

function PillSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 border border-slate-200 bg-white rounded-full pl-3 pr-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
      <span className="text-slate-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-sm font-medium text-slate-900 outline-none pr-1"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Board view
// ---------------------------------------------------------------------------
function BoardView({
  tasks,
  onStatusChange,
}: {
  tasks: Task[];
  onStatusChange: (id: string, s: TaskStatus) => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = {
      BACKLOG: [],
      TODO: [],
      IN_PROGRESS: [],
      BLOCKED: [],
      REVIEW: [],
      COMPLETED: [],
      CANCELLED: [],
    };
    for (const t of tasks) {
      // Defensive: if the backend ships a new status the frontend doesn't know
      // yet, drop it in BACKLOG rather than crashing on undefined.push.
      const bucket = g[t.status] ?? g.BACKLOG;
      bucket.push(t);
    }
    return g;
  }, [tasks]);

  function onDragStart(e: DragEvent<HTMLElement>, id: string) {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onDrop(e: DragEvent<HTMLDivElement>, status: TaskStatus) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) onStatusChange(id, status);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {TASK_STATUSES.map((status) => (
        <div
          key={status}
          className="w-80 shrink-0 min-h-[200px]"
          onDragOver={onDragOver}
          onDrop={(e) => onDrop(e, status)}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
              <h3 className="text-sm font-semibold text-slate-900">{TASK_STATUS_LABEL[status]}</h3>
              <span className="text-xs font-medium text-slate-500 tabular-nums bg-slate-100 rounded px-1.5">
                {grouped[status].length}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {grouped[status].map((t) => (
              <BoardCard key={t.id} task={t} onDragStart={onDragStart} />
            ))}
            {grouped[status].length === 0 && (
              <div className="text-xs text-slate-400 italic px-1 py-3 text-center">No tasks</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function BoardCard({
  task,
  onDragStart,
}: {
  task: Task;
  onDragStart: (e: DragEvent<HTMLElement>, id: string) => void;
}) {
  return (
    <Link
      to={`/tasks/${task.id}`}
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      className="block bg-white rounded-lg border border-slate-200 p-3 cursor-grab active:cursor-grabbing hover:border-slate-300 hover-lift animate-fade-in-up"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono text-slate-400">{shortId(task.id)}</span>
        {task.tags && task.tags.length > 0 && <TagPill tag={task.tags[0]!} />}
      </div>
      <h4 className="text-sm font-medium text-slate-900 leading-snug line-clamp-2">{task.title}</h4>
      {task.consultant && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-full pl-1 pr-2 py-0.5">
          <Avatar
            name={task.consultant.user?.full_name}
            email={task.consultant.user?.email}
            size={18}
          />
          <span>Consultant · {task.consultant.user?.full_name ?? task.consultant.user?.email}</span>
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between">
        <DuePill task={task} />
        {task.assignee ? (
          <div className="inline-flex items-center gap-1.5">
            <GroupBadge groupId={task.assignee.group_id ?? null} compact hideEmpty />
            <Avatar name={task.assignee.full_name} email={task.assignee.email} size={22} />
          </div>
        ) : (
          <span className="text-[10px] text-slate-400 italic">Unassigned</span>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------
function ListView({ tasks }: { tasks: Task[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
          <tr>
            <th className="px-3 py-2 text-left w-20">ID</th>
            <th className="px-3 py-2 text-left">Title</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Priority</th>
            <th className="px-3 py-2 text-left">Assignee</th>
            <th className="px-3 py-2 text-left">Consultant</th>
            <th className="px-3 py-2 text-left">Due</th>
          </tr>
        </thead>
        <tbody>
          {tasks.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-slate-400 italic">
                No tasks match these filters.
              </td>
            </tr>
          )}
          {tasks.map((t) => (
            <tr
              key={t.id}
              className={clsx(
                'border-t border-slate-100 hover:bg-slate-50',
                isOverdue(t) && 'bg-red-50/30',
              )}
            >
              <td className="px-3 py-2 text-[11px] font-mono text-slate-500">{shortId(t.id)}</td>
              <td className="px-3 py-2">
                <Link to={`/tasks/${t.id}`} className="text-slate-900 hover:underline">
                  {t.title}
                </Link>
                {t.tags && t.tags.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {t.tags.slice(0, 3).map((tg) => (
                      <TagPill key={tg} tag={tg} />
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <TaskStatusBadge status={t.status} />
              </td>
              <td className="px-3 py-2">
                <PriorityBadge priority={t.priority} />
              </td>
              <td className="px-3 py-2">
                <AssigneeChip task={t} />
              </td>
              <td className="px-3 py-2">
                {t.consultant ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-700">
                    <Avatar
                      name={t.consultant.user?.full_name}
                      email={t.consultant.user?.email}
                      size={20}
                    />
                    <span className="truncate max-w-[110px]">
                      {t.consultant.user?.full_name ?? t.consultant.user?.email}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-400 italic text-xs">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                <DuePill task={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create-task modal
// ---------------------------------------------------------------------------
function CreateTaskModal({
  users,
  onClose,
  onCreated,
}: {
  users: { id: string; full_name?: string; email: string; role: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<any>({
    status: 'BACKLOG',
    priority: 'MEDIUM',
    tags: [] as string[],
  });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    if (form.tags.includes(t)) {
      setTagInput('');
      return;
    }
    setForm({ ...form, tags: [...form.tags, t] });
    setTagInput('');
  }
  function removeTag(t: string) {
    setForm({ ...form, tags: form.tags.filter((x: string) => x !== t) });
  }

  async function save() {
    if (!form.title) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload: any = { ...form };
      if (form.due_at) payload.due_at = new Date(form.due_at).toISOString();
      if (!payload.tags?.length) delete payload.tags;
      await api.post('/tasks', payload);
      toast.success('Task created');
      invalidate('tasks');
      onCreated();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to create task');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Create task"
      footer={
        <button
          onClick={save}
          disabled={saving}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : '+ Create task'}
        </button>
      }
    >
      <div className="space-y-3">
        <input
          autoFocus
          placeholder="Title"
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full text-lg font-semibold text-slate-900 placeholder-slate-400 border-0 focus:outline-none px-0"
        />
        <textarea
          placeholder="Description"
          rows={3}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full text-sm text-slate-700 placeholder-slate-400 border-0 focus:outline-none px-0 resize-none"
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectInput
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] }))}
          />
          <SelectInput
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
          <SelectInput
            label="Assignee"
            value={form.assignee_id ?? ''}
            onChange={(e) => setForm({ ...form, assignee_id: e.target.value || null })}
            placeholder="Unassigned"
            options={users.map((u) => ({
              value: u.id,
              label: `${u.full_name ?? u.email} (${u.role})`,
            }))}
          />
          <DateTimePicker
            label="Due date"
            value={form.due_at ?? ''}
            onChange={(v) => setForm({ ...form, due_at: v })}
          />
        </div>

        {/* Tags */}
        <div>
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
            Tags
          </span>
          <div className="flex flex-wrap gap-1.5 items-center">
            {form.tags.map((t: string) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
              >
                {t}
                <button
                  onClick={() => removeTag(t)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              placeholder="+ Add tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
                if (e.key === 'Backspace' && !tagInput && form.tags.length > 0) {
                  removeTag(form.tags[form.tags.length - 1]!);
                }
              }}
              className="border border-slate-200 rounded-full px-2.5 py-0.5 text-xs outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
