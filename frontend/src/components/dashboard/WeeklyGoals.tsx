import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { FormInput } from '../FormInput';
import type { DashApplication, DashConsultant } from './types';

type GoalType = 'submissions' | 'interviews' | 'offers' | 'bench_refresh';
type Targets = Record<GoalType, number>;
const DEFAULT_TARGETS: Targets = { submissions: 10, interviews: 4, offers: 2, bench_refresh: 100 };

const GOAL_META: { key: GoalType; label: string }[] = [
  { key: 'submissions', label: 'Submissions' },
  { key: 'interviews', label: 'Interviews scheduled' },
  { key: 'offers', label: 'Offers received' },
  { key: 'bench_refresh', label: 'Bench refresh target (%)' },
];

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

  // Inline target editor (persists via PUT /recruiter-goals).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<GoalType, string>>({
    submissions: '',
    interviews: '',
    offers: '',
    bench_refresh: '',
  });
  const [saving, setSaving] = useState(false);

  function openEditor() {
    setDraft({
      submissions: String(targets.submissions),
      interviews: String(targets.interviews),
      offers: String(targets.offers),
      bench_refresh: String(targets.bench_refresh),
    });
    setEditing(true);
  }

  async function saveGoals() {
    const next = {
      submissions: clampInt(draft.submissions),
      interviews: clampInt(draft.interviews),
      offers: clampInt(draft.offers),
      bench_refresh: clampInt(draft.bench_refresh),
    };
    setSaving(true);
    try {
      await api.put('/recruiter-goals', {
        goals: GOAL_META.map((m) => ({ goal_type: m.key, target: next[m.key] })),
      });
      setTargets(next);
      setEditing(false);
      toast.success('Goals updated');
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save goals';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const goals = computeGoals(consultants, apps, targets);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-ink">Weekly goals</p>
        <Button variant="ghost" size="sm" onClick={openEditor}>
          Edit
        </Button>
      </div>

      <div className="flex flex-col">
        {goals.map((goal, i) => (
          <div key={goal.label} className={i > 0 ? 'mt-3' : ''}>
            <GoalRow goal={goal} />
          </div>
        ))}
      </div>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit weekly goals"
        description="Set your targets. Progress is tracked automatically from your pipeline."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={saveGoals}>
              Save goals
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {GOAL_META.map((m) => (
            <FormInput
              key={m.key}
              label={m.label}
              type="number"
              min={0}
              inputMode="numeric"
              value={draft[m.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
            />
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** Parse an input string to a non-negative bounded integer. */
function clampInt(v: string): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100_000, n);
}
