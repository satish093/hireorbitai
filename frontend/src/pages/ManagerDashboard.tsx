import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { DashboardCard } from '../components/DashboardCard';
import { SkeletonMetricGrid } from '../components/Skeleton';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  TaskStatus,
  TASK_PRIORITIES,
  TaskPriority,
} from '../types';

interface Summary {
  consultants_by_status: Record<string, number>;
  recruiters_count: number;
  active_jobs: number;
  last_7_day_applications: number;
  applications_by_status: Record<string, number>;
}

interface TaskMetrics {
  total: number;
  open: number;
  critical_open: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  overdue: number;
  due_today: number;
  due_this_week: number;
  completed_last_7_days: number;
}

const STATUS_BAR_COLOR: Record<TaskStatus, string> = {
  BACKLOG: 'bg-slate-400',
  TODO: 'bg-blue-500',
  IN_PROGRESS: 'bg-indigo-500',
  BLOCKED: 'bg-red-500',
  REVIEW: 'bg-purple-500',
  COMPLETED: 'bg-emerald-500',
  CANCELLED: 'bg-slate-300',
};

const STATUS_DOT_COLOR: Record<TaskStatus, string> = STATUS_BAR_COLOR;

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-amber-500',
  MEDIUM: 'bg-yellow-400',
  LOW: 'bg-blue-400',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(profile: { full_name?: string; email: string } | null): string {
  if (!profile) return 'there';
  if (profile.full_name) return profile.full_name.split(' ')[0]!;
  return profile.email.split('@')[0]!;
}

export function ManagerDashboard() {
  const { profile } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tasks, setTasks] = useState<TaskMetrics | null>(null);
  const [jobsCount, setJobsCount] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ key: string; message: string }[]>([]);

  function pushError(key: string, message: string) {
    setErrors((prev) => (prev.find((e) => e.key === key) ? prev : [...prev, { key, message }]));
  }

  useEffect(() => {
    api
      .get('/reports/manager-summary')
      .then((r) => setSummary(r.data))
      .catch((e) =>
        pushError('summary', e?.response?.data?.error ?? 'reports/manager-summary failed'),
      );
    api
      .get('/tasks/metrics')
      .then((r) => setTasks(r.data))
      .catch((e) =>
        pushError(
          'tasks',
          e?.response?.data?.error ?? 'tasks/metrics failed — run database/tasks.sql',
        ),
      );
    api
      .get('/jobs')
      .then((r) => setJobsCount((r.data ?? []).length))
      .catch(() => {});
  }, []);

  const dateStr = useMemo(() => {
    const d = new Date();
    const dow = d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
    const md = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    return `${dow} · ${md.toUpperCase()}`;
  }, []);

  return (
    <Layout title="Manager dashboard">
      {/* Greeting */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold tracking-widest text-slate-500 mb-2">
            {dateStr}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {greeting()}, {firstName(profile)}.
          </h1>
          {tasks ? (
            <p className="text-sm text-slate-600 mt-2">
              Your team has{' '}
              <span className="font-semibold text-slate-900">{tasks.open} open tasks</span>,{' '}
              <span
                className={
                  tasks.overdue > 0 ? 'font-semibold text-red-600' : 'font-semibold text-slate-900'
                }
              >
                {tasks.overdue} overdue
              </span>
              , and{' '}
              <span
                className={
                  tasks.due_today > 0
                    ? 'font-semibold text-amber-700'
                    : 'font-semibold text-slate-900'
                }
              >
                {tasks.due_today} due today
              </span>
              .
            </p>
          ) : (
            <p className="text-sm text-slate-500 mt-2">Welcome to your control center.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/jobs"
            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 inline-flex items-center gap-1.5"
          >
            <span className="text-slate-500">↻</span> Manage jobs
          </Link>
          <Link
            to="/tasks"
            className="bg-slate-900 text-white rounded-lg px-3 py-1.5 text-sm hover:bg-slate-800 inline-flex items-center gap-1.5"
          >
            <span>+</span> New task
          </Link>
        </div>
      </div>

      {/* Diagnostic banner — only shown when an endpoint failed */}
      {errors.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="font-semibold text-amber-900 text-sm mb-1">Some panels couldn't load</div>
          <ul className="text-xs text-amber-800 space-y-0.5">
            {errors.map((e) => (
              <li key={e.key}>• {e.message}</li>
            ))}
          </ul>
          <p className="text-xs text-amber-700 mt-2">
            Pending SQL migrations: <span className="font-mono">database/tasks.sql</span>,{' '}
            <span className="font-mono">database/tasks-tags.sql</span>,{' '}
            <span className="font-mono">database/jobs-extras.sql</span>,{' '}
            <span className="font-mono">database/job-ingestion.sql</span>.
          </p>
        </div>
      )}

      {/* First-run quick actions for admin */}
      {(profile?.role === 'SUPER_ADMIN' || profile?.role === 'MANAGER') &&
        (!jobsCount || jobsCount === 0 || !tasks || tasks.total === 0) && (
          <QuickActions
            hasJobs={!!jobsCount && jobsCount > 0}
            hasTasks={!!tasks && tasks.total > 0}
          />
        )}

      {/* Top metric cards — render skeletons on the very first paint so the
          dashboard doesn't flash a row of em-dashes before /tasks/metrics
          resolves. Once either endpoint returns we show the real grid. */}
      {tasks === null && summary === null && errors.length === 0 ? (
        <div className="mb-6">
          <SkeletonMetricGrid count={4} />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-children">
          <DashboardCard
            label="Open tasks"
            value={tasks?.open ?? '—'}
            accent="slate"
            hint={
              tasks ? (
                <span className="text-slate-500">{tasks.total} total</span>
              ) : (
                <span className="text-slate-400">Run tasks migration</span>
              )
            }
          />
          <DashboardCard
            label="Overdue"
            value={
              <span className={tasks && tasks.overdue > 0 ? 'text-red-600' : ''}>
                {tasks?.overdue ?? '—'}
              </span>
            }
            accent="red"
            hint={
              tasks && tasks.critical_open > 0 ? (
                <span className="text-red-600">{tasks.critical_open} critical</span>
              ) : null
            }
          />
          <DashboardCard
            label="Due this week"
            value={tasks?.due_this_week ?? '—'}
            accent="amber"
            hint={
              summary ? (
                <span className="text-slate-500">across {summary.recruiters_count} recruiters</span>
              ) : null
            }
          />
          <DashboardCard
            label="Completed (7d)"
            value={tasks?.completed_last_7_days ?? '—'}
            accent="green"
            hint={<span className="text-emerald-700">last 7 days</span>}
          />
        </div>
      )}

      {/* Tasks by status + by priority */}
      {tasks && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-slate-900">Tasks by status</h3>
              <span className="text-xs text-slate-500">across team</span>
            </div>
            <p className="text-xs text-slate-500 mb-4">Last 30 days</p>
            <StackedBar metrics={tasks} />
            <div className="grid grid-cols-3 md:grid-cols-7 gap-3 mt-4">
              {TASK_STATUSES.map((s) => (
                <div key={s} className="text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${STATUS_DOT_COLOR[s]}`} />
                    <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                      {TASK_STATUS_LABEL[s]}
                    </span>
                  </div>
                  <div className="text-lg font-semibold mt-0.5 tabular-nums text-slate-900">
                    {tasks.by_status[s] ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div>
              <h3 className="font-semibold text-slate-900">By priority</h3>
              <p className="text-xs text-slate-500 mb-4">All tasks</p>
            </div>
            <div className="space-y-3">
              {TASK_PRIORITIES.slice()
                .reverse()
                .map((p) => {
                  const count = tasks.by_priority[p] ?? 0;
                  const max = Math.max(1, ...TASK_PRIORITIES.map((q) => tasks.by_priority[q] ?? 0));
                  const pct = Math.round((count / max) * 100);
                  return (
                    <div key={p}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${PRIORITY_COLOR[p]}`} />
                          <span className="text-slate-700">
                            {p.charAt(0) + p.slice(1).toLowerCase()}
                          </span>
                        </span>
                        <span className="text-slate-900 font-medium tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${PRIORITY_COLOR[p]}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Existing portfolio metrics */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-children">
          <DashboardCard
            label="Active consultants"
            value={summary.consultants_by_status.ACTIVE ?? 0}
            accent="green"
          />
          <DashboardCard
            label="Paused"
            value={summary.consultants_by_status.PAUSED ?? 0}
            accent="amber"
          />
          <DashboardCard
            label="Placed"
            value={summary.consultants_by_status.PLACED ?? 0}
            accent="blue"
          />
          <DashboardCard label="Active jobs" value={summary.active_jobs} accent="brand" />
        </div>
      )}

      {summary && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Applications by status</h3>
            <span className="text-xs text-slate-500">last 7 days</span>
          </div>
          {Object.keys(summary.applications_by_status).length === 0 ? (
            <p className="text-sm text-slate-400 italic">No applications in the last 7 days.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {Object.entries(summary.applications_by_status).map(([k, v]) => (
                <div key={k} className="border border-slate-200 rounded-lg px-3 py-2.5">
                  <div className="text-slate-500 text-[10px] uppercase tracking-widest font-semibold">
                    {k.replace(/_/g, ' ')}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-900 mt-0.5">
                    {v}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}

function QuickActions({ hasJobs, hasTasks }: { hasJobs: boolean; hasTasks: boolean }) {
  return (
    <div className="mb-6 bg-gradient-to-br from-brand-50 to-violet-50 border border-brand-100 rounded-xl p-5">
      <div className="text-[10px] font-semibold tracking-widest text-brand-700 uppercase mb-1">
        First steps
      </div>
      <h3 className="text-lg font-semibold text-slate-900">Set up your workspace</h3>
      <p className="text-sm text-slate-600 mt-1 mb-4">
        A few one-click actions to get the rest of the portal populated.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <QuickActionCard
          done={hasJobs}
          title="Pull live jobs"
          desc="Sync real-time listings from Greenhouse, Lever, and RemoteOK."
          to="/jobs"
          cta={hasJobs ? 'Manage sources →' : 'Open Jobs →'}
        />
        <QuickActionCard
          done={hasTasks}
          title="Create your first task"
          desc="Assign work to a recruiter or consultant on the ADO-style board."
          to="/tasks"
          cta={hasTasks ? 'Open board →' : 'New task →'}
        />
        <QuickActionCard
          done={false}
          title="Invite your team"
          desc="Send invitation emails — recipients set their own password."
          to="/invitations"
          cta="Invite users →"
        />
      </div>
    </div>
  );
}

function QuickActionCard({
  done,
  title,
  desc,
  to,
  cta,
}: {
  done: boolean;
  title: string;
  desc: string;
  to: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="block bg-white rounded-lg border border-slate-200 p-3 hover:border-slate-300 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between">
        <div className="font-medium text-slate-900 text-sm">{title}</div>
        {done && (
          <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded">
            Done
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">{desc}</p>
      <div className="text-xs text-brand-700 hover:underline mt-2">{cta}</div>
    </Link>
  );
}

function StackedBar({ metrics }: { metrics: TaskMetrics }) {
  const total = TASK_STATUSES.reduce((s, k) => s + (metrics.by_status[k] ?? 0), 0);
  if (total === 0) return <div className="h-2 bg-slate-100 rounded-full" />;
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
      {TASK_STATUSES.map((s) => {
        const n = metrics.by_status[s] ?? 0;
        if (n === 0) return null;
        const pct = (n / total) * 100;
        return (
          <div
            key={s}
            className={STATUS_BAR_COLOR[s]}
            style={{ width: `${pct}%` }}
            title={`${TASK_STATUS_LABEL[s]}: ${n}`}
          />
        );
      })}
    </div>
  );
}
