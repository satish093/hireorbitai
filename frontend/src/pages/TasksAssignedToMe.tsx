import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import {
  PriorityBadge,
  TaskStatusBadge,
  DuePill,
  Avatar,
  TagPill,
  shortId,
  isOverdue,
} from '../components/TaskBits';
import { Task } from '../types';
import { useInvalidationListener } from '../hooks/useInvalidate';
import toast from 'react-hot-toast';

const SECTION_ORDER = ['overdue', 'today', 'this_week', 'later', 'no_due'] as const;
type SectionKey = (typeof SECTION_ORDER)[number];
const SECTION_LABEL: Record<SectionKey, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  this_week: 'This week',
  later: 'Later',
  no_due: 'No due date',
};
const SECTION_DOT: Record<SectionKey, string> = {
  overdue: 'bg-red-500',
  today: 'bg-amber-500',
  this_week: 'bg-blue-500',
  later: 'bg-slate-400',
  no_due: 'bg-slate-300',
};

function bucketize(tasks: Task[]): Record<SectionKey, Task[]> {
  const buckets: Record<SectionKey, Task[]> = {
    overdue: [],
    today: [],
    this_week: [],
    later: [],
    no_due: [],
  };
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const endOfTodayMs = endOfToday.getTime();
  const inSevenDays = now + 7 * 24 * 3600 * 1000;

  for (const t of tasks) {
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') continue;
    if (!t.due_at) {
      buckets.no_due.push(t);
      continue;
    }
    const d = new Date(t.due_at).getTime();
    if (d < now) buckets.overdue.push(t);
    else if (d <= endOfTodayMs) buckets.today.push(t);
    else if (d <= inSevenDays) buckets.this_week.push(t);
    else buckets.later.push(t);
  }
  return buckets;
}

export function TasksAssignedToMe() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    try {
      const r = await api.get('/tasks/assigned-to-me', { signal });
      if (signal?.aborted) return;
      setTasks(r.data ?? []);
    } catch (e: any) {
      if (e?.code === 'ERR_CANCELED') return;
      toast.error(e?.response?.data?.error ?? 'Failed to load tasks');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  // Bumped by the cross-page invalidation channel so a status change made
  // from Tasks board / TaskDetail / dashboard refetches us automatically.
  const [reloadTick, setReloadTick] = useState(0);
  useInvalidationListener('tasks', () => setReloadTick((n) => n + 1));

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [reloadTick]);

  const buckets = useMemo(() => bucketize(tasks), [tasks]);
  const active = tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED');
  const overdueCount = buckets.overdue.length;
  const dueThisWeek = buckets.today.length + buckets.this_week.length;
  const nextUp: Task | undefined = useMemo(() => {
    const open = active.filter((t) => t.due_at);
    if (open.length === 0) return active[0];
    open.sort((a, b) => {
      const pri = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
      if (pri[a.priority] !== pri[b.priority]) return pri[a.priority] - pri[b.priority];
      return new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime();
    });
    return open[0];
  }, [active]);

  return (
    <Layout
      title="Assigned to me"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Tasks', to: '/tasks' },
        { label: 'Assigned to me' },
      ]}
    >
      <div className="flex items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My tasks</h1>
          <p className="text-sm text-slate-600 mt-1">
            <span className="font-semibold text-slate-900">{active.length} active</span>
            {' · '}
            <span className={overdueCount > 0 ? 'font-semibold text-red-600' : ''}>
              {overdueCount} overdue
            </span>
            {' · '}
            <span className="font-semibold text-slate-900">{dueThisWeek} due this week</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Static date pill — purely informational, not a button. The
              previous render used <button> with no onClick which looked
              clickable but did nothing. */}
          <span className="border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-sm text-slate-700">
            📅 Today ·{' '}
            {new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
          {/* "Log daily activity" link removed — it pointed at /reports which
              requires MANAGER_TIER and 403'd for every recruiter who clicked
              it. When a recruiter-accessible activity-log route exists, wire
              it back. */}
        </div>
      </div>

      {/* Next up hero */}
      {nextUp && (
        <Link
          to={`/tasks/${nextUp.id}`}
          className="block bg-gradient-to-br from-brand-600 to-violet-700 text-white rounded-2xl p-6 mb-6 shadow-sm hover:shadow-md transition relative overflow-hidden"
        >
          <div className="absolute -top-12 -right-8 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          <div className="text-[10px] font-semibold tracking-widest text-white/70 mb-2">
            NEXT UP · {shortId(nextUp.id)}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full text-xs px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              {nextUp.priority.toLowerCase()} priority
            </span>
            {nextUp.due_at && (
              <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full text-xs px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                {humanDue(nextUp.due_at)}
              </span>
            )}
            {(nextUp.tags ?? []).slice(0, 2).map((tg) => (
              <span
                key={tg}
                className="inline-flex items-center bg-white/15 backdrop-blur-sm rounded-full text-[10px] font-medium uppercase tracking-wide px-2 py-0.5"
              >
                {tg}
              </span>
            ))}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{nextUp.title}</h2>
          {nextUp.description && (
            <p className="text-sm text-white/80 mt-2 line-clamp-2">{nextUp.description}</p>
          )}
          <div className="mt-4 inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 text-sm">
            Open task <span>→</span>
          </div>
        </Link>
      )}

      {/* Sections */}
      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : active.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
          🎉 You're all caught up. No tasks assigned to you right now.
        </div>
      ) : (
        <div className="space-y-6">
          {SECTION_ORDER.map((key) => {
            const list = buckets[key];
            if (list.length === 0) return null;
            return (
              <section key={key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${SECTION_DOT[key]}`} />
                  <h3 className="text-sm font-semibold text-slate-900">{SECTION_LABEL[key]}</h3>
                  <span className="text-xs text-slate-500 tabular-nums">{list.length}</span>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {list.map((t) => (
                    <RowCard key={t.id} task={t} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

function RowCard({ task }: { task: Task }) {
  return (
    <Link
      to={`/tasks/${task.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl"
    >
      {/* The dead checkbox column was removed — no onChange, no state, no
          backend wiring. When a "mark complete" inline-action is needed,
          wire it to PATCH /tasks/:id/status with status=COMPLETED and add
          invalidate('tasks'). */}
      <span className="text-[11px] font-mono text-slate-400 shrink-0">{shortId(task.id)}</span>
      <span className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-900 truncate">{task.title}</div>
        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
          {task.assignee && (
            <span className="inline-flex items-center gap-1">
              <Avatar name={task.assignee.full_name} email={task.assignee.email} size={16} />
              <span className="truncate max-w-[100px]">
                {task.assignee.full_name ?? task.assignee.email}
              </span>
            </span>
          )}
          {(task.tags ?? []).slice(0, 1).map((tg) => (
            <TagPill key={tg} tag={`#${tg}`} />
          ))}
        </div>
      </span>
      <TaskStatusBadge status={task.status} />
      <PriorityBadge priority={task.priority} />
      <DuePill task={task} />
    </Link>
  );
}

function humanDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(d);
  startDue.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startDue.getTime() - startToday.getTime()) / (24 * 3600 * 1000));
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays > 0 && diffDays <= 7) return `Due in ${diffDays}d`;
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Avoid unused-import warning when isOverdue isn't needed in this file.
void isOverdue;
