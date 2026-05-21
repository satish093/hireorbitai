import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { DashApplication, DashConsultant } from './types';

type GoalType = 'submissions' | 'interviews' | 'offers' | 'bench_refresh';
type Targets = Record<GoalType, number>;
const DEFAULT_TARGETS: Targets = { submissions: 10, interviews: 4, offers: 2, bench_refresh: 100 };

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type GoalTone = 'accent' | 'success' | 'warning';

interface Goal {
  label: string;
  current: number;
  target: number;
  tone: GoalTone;
  isPercent?: boolean;
}

// ---------------------------------------------------------------------------
// Tone → Tailwind fill colour
// ---------------------------------------------------------------------------

const FILL_CLASS: Record<GoalTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warn',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sevenDaysAgo(): number {
  return Date.now() - 7 * 24 * 60 * 60 * 1000;
}

function withinLast7Days(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const ms = Date.parse(dateStr);
  return !isNaN(ms) && ms >= sevenDaysAgo();
}

function clampPct(value: number, max = 100): number {
  return Math.min(max, Math.max(0, value));
}

function computeGoals(
  consultants: DashConsultant[],
  apps: DashApplication[],
  targets: Targets,
): Goal[] {
  // 1. Submissions: apps submitted in the last 7 days
  const submissions = apps.filter(
    (a) => withinLast7Days(a.submitted_at) || withinLast7Days(a.created_at),
  ).length;

  // 2. Interviews scheduled: apps with status INTERVIEW
  const interviews = apps.filter((a) => a.status === 'INTERVIEW').length;

  // 3. Offers received: apps with status OFFER
  const offers = apps.filter((a) => a.status === 'OFFER').length;

  // 4. Bench refresh: % of consultants updated in last 7 days
  const total = consultants.length;
  const refreshed = consultants.filter((c) => withinLast7Days(c.updated_at)).length;
  const benchPct = total > 0 ? Math.round((refreshed / total) * 100) : 0;

  return [
    { label: 'Submissions', current: submissions, target: targets.submissions, tone: 'accent' },
    {
      label: 'Interviews scheduled',
      current: interviews,
      target: targets.interviews,
      tone: 'accent',
    },
    { label: 'Offers received', current: offers, target: targets.offers, tone: 'success' },
    {
      label: 'Bench refresh',
      current: benchPct,
      target: targets.bench_refresh,
      tone: 'warning',
      isPercent: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// GoalRow sub-component
// ---------------------------------------------------------------------------

function GoalRow({ goal }: { goal: Goal }) {
  const fillPct = goal.isPercent
    ? clampPct(goal.current)
    : clampPct(Math.round((goal.current / goal.target) * 100));

  const valueLabel = goal.isPercent ? `${goal.current}%` : `${goal.current}/${goal.target}`;

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[13px] text-ink">{goal.label}</span>
        <span className="text-[12px] font-mono text-muted">{valueLabel}</span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${FILL_CLASS[goal.tone]}`}
          style={{ width: `${fillPct}%` }}
          role="progressbar"
          aria-valuenow={fillPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={goal.label}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WeeklyGoals({
  consultants,
  apps,
}: {
  consultants: DashConsultant[];
  apps: DashApplication[];
}): JSX.Element {
  // Targets are configurable per recruiter (GET /recruiter-goals); fall back to
  // the defaults if the endpoint/migration isn't available.
  const [targets, setTargets] = useState<Targets>(DEFAULT_TARGETS);
  useEffect(() => {
    let alive = true;
    api
      .get<{ goal_type: GoalType; target: number }[]>('/recruiter-goals')
      .then((r) => {
        if (!alive || !Array.isArray(r.data)) return;
        setTargets((prev) => {
          const next = { ...prev };
          for (const g of r.data) if (g.goal_type in next) next[g.goal_type] = g.target;
          return next;
        });
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      alive = false;
    };
  }, []);

  const goals = computeGoals(consultants, apps, targets);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ink mb-3">Weekly goals</p>

      <div className="flex flex-col">
        {goals.map((goal, i) => (
          <div key={goal.label} className={i > 0 ? 'mt-3' : ''}>
            <GoalRow goal={goal} />
          </div>
        ))}
      </div>
    </div>
  );
}
