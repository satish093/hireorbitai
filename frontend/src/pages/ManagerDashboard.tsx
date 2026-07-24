import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { DashboardCard } from '../components/DashboardCard';
import { KpiCard } from '../components/KpiCard';
import { SkeletonMetricGrid } from '../components/Skeleton';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useFeatureFlag } from '../hooks/useFeatureFlags';
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  TaskStatus,
  TASK_PRIORITIES,
  TaskPriority,
  MANAGER_TIER,
} from '../types';

interface Summary {
  consultants_by_status: Record<string, number>;
  recruiters_count: number;
  active_jobs: number;
  last_7_day_applications: number;
  applications_by_status: Record<string, number>;
}

/**
 * Coerce a possibly-partial /reports/manager-summary payload into a fully
 * shaped Summary. The render is gated by `summary &&`, but a truthy-but-partial
 * body (empty {} or a missing map) slipped past that guard and crashed on
 * `summary.consultants_by_status.ACTIVE` — white-screening the whole dashboard.
 * Normalising on set defends every downstream field access at once.
 */
function normalizeSummary(d: unknown): Summary {
  const o = (d ?? {}) as Partial<Summary>;
  const rec = (v: unknown): Record<string, number> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    consultants_by_status: rec(o.consultants_by_status),
    recruiters_count: num(o.recruiters_count),
    active_jobs: num(o.active_jobs),
    last_7_day_applications: num(o.last_7_day_applications),
    applications_by_status: rec(o.applications_by_status),
  };
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
  BACKLOG: 'bg-muted',
  TODO: 'bg-blue-500',
  IN_PROGRESS: 'bg-indigo-500',
  BLOCKED: 'bg-red-500',
  REVIEW: 'bg-purple-500',
  COMPLETED: 'bg-emerald-500',
  CANCELLED: 'bg-muted',
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
      .then((r) => setSummary(normalizeSummary(r.data)))
      .catch((e) =>
        pushError('summary', e?.response?.data?.error ?? 'reports/manager-summary failed'),
      );
    api
      .get('/tasks/metrics')
      .then((r) => {
        const d = r.data;
        if (d && typeof d === 'object' && !Array.isArray(d)) setTasks(d);
      })
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
      {/* Mobile urgent ribbon — only shown below md when there are critical tasks */}
      {tasks && tasks.critical_open > 0 && (
        <div
          className="md:hidden flex items-center gap-3 p-3 rounded-xl mb-4"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)',
          }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
            style={{ background: 'var(--danger)' }}
          />
          <div className="flex-1 text-sm" style={{ color: 'var(--ink)' }}>
            <strong style={{ fontWeight: 700 }}>
              {tasks.critical_open} critical task{tasks.critical_open > 1 ? 's' : ''}
            </strong>{' '}
            need{tasks.critical_open === 1 ? 's' : ''} attention
          </div>
          <Link
            to="/tasks"
            className="text-xs font-semibold shrink-0"
            style={{ color: 'var(--danger)', textDecoration: 'none' }}
          >
            View →
          </Link>
        </div>
      )}

      {/* Greeting */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold tracking-widest text-muted mb-2">{dateStr}</div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            {greeting()}, {firstName(profile)}.
          </h1>
          {tasks ? (
            <p className="text-sm text-muted mt-2">
              Your team has <span className="font-semibold text-ink">{tasks.open} open tasks</span>,{' '}
              <span
                className={
                  tasks.overdue > 0
                    ? 'font-semibold text-red-600 dark:text-red-400'
                    : 'font-semibold text-ink'
                }
              >
                {tasks.overdue} overdue
              </span>
              , and{' '}
              <span
                className={
                  tasks.due_today > 0
                    ? 'font-semibold text-amber-700 dark:text-amber-300'
                    : 'font-semibold text-ink'
                }
              >
                {tasks.due_today} due today
              </span>
              .
            </p>
          ) : (
            <p className="text-sm text-muted mt-2">Welcome to your control center.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/jobs"
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm hover:bg-hover inline-flex items-center gap-1.5"
          >
            <span className="text-muted">↻</span> Manage jobs
          </Link>
          <Link
            to="/tasks"
            className="bg-ink text-bg rounded-lg px-3 py-1.5 text-sm hover:opacity-90 inline-flex items-center gap-1.5"
          >
            <span>+</span> New task
          </Link>
        </div>
      </div>

      {/* Diagnostic banner — only shown when an endpoint failed */}
      {errors.length > 0 && (
        <div className="mb-6 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
          <div className="font-semibold text-amber-900 text-sm mb-1">Some panels couldn't load</div>
          <ul className="text-xs text-amber-800 dark:text-amber-300 space-y-0.5">
            {errors.map((e) => (
              <li key={e.key}>• {e.message}</li>
            ))}
          </ul>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
            Pending SQL migrations: <span className="font-mono">database/tasks.sql</span>,{' '}
            <span className="font-mono">database/tasks-tags.sql</span>,{' '}
            <span className="font-mono">database/jobs-extras.sql</span>,{' '}
            <span className="font-mono">database/job-ingestion.sql</span>.
          </p>
        </div>
      )}

      {/* First-run quick actions for admin.
          Gating rules (fixes the "card never disappears" + "CTA flickers
          between Manage sources / Open Jobs" bug):
          - Wait until jobsCount has loaded (!== null) before rendering, so the
            "Pull live jobs" CTA doesn't flash "Open Jobs" then snap to
            "Manage sources" on every reload.
          - Only count tasks as a pending setup step when the metrics actually
            loaded AND came back 0. When the tasks feature is disabled,
            /tasks/metrics 403s and `tasks` stays null forever — treating null
            as "needs setup" kept this card pinned open permanently. */}
      {profile?.role &&
        (MANAGER_TIER as readonly string[]).includes(profile.role) &&
        jobsCount !== null &&
        (jobsCount === 0 || (tasks !== null && tasks.total === 0)) && (
          <QuickActions hasJobs={jobsCount > 0} hasTasks={!!tasks && tasks.total > 0} />
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
          <KpiCard
            label="Open tasks"
            value={tasks?.open ?? 0}
            delta={tasks ? `${tasks.total} total` : 'Run tasks migration'}
            accent="slate"
          />
          <KpiCard
            label="Overdue"
            value={tasks?.overdue ?? 0}
            delta={tasks?.critical_open ? `${tasks.critical_open} critical` : undefined}
            accent="red"
          />
          <KpiCard
            label="Due this week"
            value={tasks?.due_this_week ?? 0}
            delta={summary ? `${summary.recruiters_count} recruiters` : undefined}
            accent="amber"
          />
          <KpiCard
            label="Completed (7d)"
            value={tasks?.completed_last_7_days ?? 0}
            delta="last 7 days"
            up
            accent="green"
          />
        </div>
      )}

      {/* Tasks by status + by priority */}
      {tasks && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2 bg-surface border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-ink">Tasks by status</h3>
              <span className="text-xs text-muted">across team</span>
            </div>
            <p className="text-xs text-muted mb-4">Last 30 days</p>
            <StackedBar metrics={tasks} />
            <div className="grid grid-cols-3 md:grid-cols-7 gap-3 mt-4">
              {TASK_STATUSES.map((s) => (
                <div key={s} className="text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${STATUS_DOT_COLOR[s]}`} />
                    <span className="text-[11px] text-muted uppercase tracking-wide">
                      {TASK_STATUS_LABEL[s]}
                    </span>
                  </div>
                  <div className="text-lg font-semibold mt-0.5 tabular-nums text-ink">
                    {tasks.by_status[s] ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-5">
            <div>
              <h3 className="font-semibold text-ink">By priority</h3>
              <p className="text-xs text-muted mb-4">All tasks</p>
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
                          <span className="text-ink">{p.charAt(0) + p.slice(1).toLowerCase()}</span>
                        </span>
                        <span className="text-ink font-medium tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 bg-hover rounded-full overflow-hidden">
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
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-ink">Applications by status</h3>
            <span className="text-xs text-muted">last 7 days</span>
          </div>
          {Object.keys(summary.applications_by_status).length === 0 ? (
            <p className="text-sm text-muted italic">No applications in the last 7 days.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {Object.entries(summary.applications_by_status).map(([k, v]) => (
                <div key={k} className="border border-border rounded-lg px-3 py-2.5">
                  <div className="text-muted text-[10px] uppercase tracking-widest font-semibold">
                    {k.replace(/_/g, ' ')}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-ink mt-0.5">{v}</div>
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
  // Don't surface the "Create your first task" card when the tasks feature is
  // turned off for the workspace — clicking it would land on the
  // feature-disabled panel, which is confusing as a "first step".
  const tasksEnabled = useFeatureFlag('tasks');
  return (
    <div className="mb-6 bg-gradient-to-br from-brand-50 to-violet-50 border border-brand-100 rounded-xl p-5">
      <div className="text-[10px] font-semibold tracking-widest text-brand-700 uppercase mb-1">
        First steps
      </div>
      <h3 className="text-lg font-semibold text-ink">Set up your workspace</h3>
      <p className="text-sm text-muted mt-1 mb-4">
        A few one-click actions to get the rest of the portal populated.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <QuickActionCard
          done={hasJobs}
          title="Pull live jobs"
          desc="Sync real-time listings from LinkedIn, Dice, Monster, and CareerBuilder."
          to="/jobs"
          cta={hasJobs ? 'Manage sources →' : 'Open Jobs →'}
        />
        {tasksEnabled && (
          <QuickActionCard
            done={hasTasks}
            title="Create your first task"
            desc="Assign work to a recruiter or consultant on the ADO-style board."
            to="/tasks"
            cta={hasTasks ? 'Open board →' : 'New task →'}
          />
        )}
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
      className="block bg-surface rounded-lg border border-border p-3 hover:border-border hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between">
        <div className="font-medium text-ink text-sm">{title}</div>
        {done && (
          <span className="text-[10px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/20 px-1.5 py-0.5 rounded">
            Done
          </span>
        )}
      </div>
      <p className="text-xs text-muted mt-1">{desc}</p>
      <div className="text-xs text-brand-700 hover:underline mt-2">{cta}</div>
    </Link>
  );
}

function StackedBar({ metrics }: { metrics: TaskMetrics }) {
  const total = TASK_STATUSES.reduce((s, k) => s + (metrics.by_status[k] ?? 0), 0);
  if (total === 0) return <div className="h-2 bg-hover rounded-full" />;
  return (
    <div className="h-2 rounded-full bg-hover overflow-hidden flex">
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
