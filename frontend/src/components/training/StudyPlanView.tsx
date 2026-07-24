import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { Button } from '../Button';
import { SkeletonCard } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { AiProgressCard } from '../AiProgressCard';
import { fmtMinutes, type PlanItem, type StudyPlan } from './types';

function Donut({ pct }: { pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative" style={{ width: 72, height: 72 }}>
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-mono font-semibold text-ink">
        {pct}%
      </span>
    </div>
  );
}

const TYPE_TONE: Record<string, string> = {
  Course: 'bg-accent-soft text-accent',
  Lesson: 'bg-bg-sunken text-ink-2',
  Quiz: 'bg-warn-soft text-warn',
  Read: 'bg-success-soft text-success',
  Live: 'bg-danger-soft text-danger',
};

export function StudyPlanView({
  assignmentsByCourseId = {},
}: {
  assignmentsByCourseId?: Record<string, string>;
}) {
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/training/plans/active')
      .then((r) => setPlan(r.data ?? null))
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/training/plans/generate');
      toast.success('Study plan ready');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not generate a plan');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: PlanItem) {
    // Optimistic flip.
    setPlan((p) =>
      p
        ? {
            ...p,
            items: p.items.map((i) => (i.id === item.id ? { ...i, completed: !i.completed } : i)),
          }
        : p,
    );
    try {
      await api.patch(`/training/plans/items/${item.id}`, { completed: !item.completed });
    } catch {
      load(); // revert to server truth
    }
  }

  const weeks = useMemo(() => {
    if (!plan) return [];
    const map = new Map<number, PlanItem[]>();
    for (const it of plan.items) {
      if (!map.has(it.week_no)) map.set(it.week_no, []);
      map.get(it.week_no)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [plan]);

  const planOverlay = (
    <AiProgressCard
      open={busy}
      title="Building your study plan"
      stages={[
        'Reviewing your enrolled courses…',
        'Finding the lessons you have left…',
        'Laying out a weekly plan…',
      ]}
    />
  );

  if (loading) return <SkeletonCard lines={8} />;

  if (!plan) {
    return (
      <>
        {planOverlay}
        <EmptyState
          icon="✦"
          title="No study plan yet"
          description="Generate a plan from the lessons you still have left across your enrolled courses."
          action={
            <Button variant="primary" onClick={generate} loading={busy}>
              ✦ Generate study plan
            </Button>
          }
        />
      </>
    );
  }

  const total = plan.items.length;
  const done = plan.items.filter((i) => i.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  // Current week = first week with an incomplete item.
  const currentWeek =
    weeks.find(([, items]) => items.some((i) => !i.completed))?.[0] ?? weeks.length;

  // Real focus-area breakdown (no fabricated severities).
  const focus = (() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const it of plan.items) {
      const k = it.focus_area ?? 'General';
      const e = m.get(k) ?? { total: 0, done: 0 };
      e.total++;
      if (it.completed) e.done++;
      m.set(k, e);
    }
    return Array.from(m.entries()).slice(0, 5);
  })();

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] items-start">
      {planOverlay}
      <div className="space-y-4 min-w-0">
        {/* Banner */}
        <div className="rounded-xl bg-accent-soft border border-accent/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-wider text-accent mb-1">
                ✦ Your study plan
              </div>
              <h2 className="text-lg font-semibold text-ink">{plan.title}</h2>
              {plan.rationale && <p className="text-sm text-ink-2 mt-1">{plan.rationale}</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={generate} loading={busy}>
              Regenerate
            </Button>
          </div>
        </div>

        {/* Week cards */}
        {weeks.map(([weekNo, items]) => {
          const mins = items.reduce((a, i) => a + (i.duration_min ?? 0), 0);
          const active = weekNo === currentWeek;
          return (
            <div key={weekNo} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <span
                  className={
                    'grid place-items-center w-7 h-7 rounded-full text-[12px] font-semibold ' +
                    (active
                      ? 'bg-accent text-white dark:text-bg'
                      : 'border border-border text-muted')
                  }
                >
                  {weekNo}
                </span>
                <span className="text-sm font-semibold text-ink">
                  {items[0]?.week_label ?? `Week ${weekNo}`}
                </span>
                {items[0]?.focus_area && (
                  <span className="text-[12px] text-muted">· {items[0].focus_area}</span>
                )}
                <span className="ml-auto text-[11px] font-mono text-muted">{fmtMinutes(mins)}</span>
              </div>
              <ul className="space-y-1.5">
                {items.map((it) => {
                  const assignmentId = it.course_id
                    ? assignmentsByCourseId[it.course_id]
                    : undefined;
                  return (
                    <li key={it.id} className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={it.completed}
                        onChange={() => toggle(it)}
                        className="accent-[color:var(--accent)] w-4 h-4 shrink-0"
                      />
                      <span
                        className={
                          'text-sm truncate flex-1 ' +
                          (it.completed ? 'text-muted line-through' : 'text-ink')
                        }
                      >
                        {it.title}
                      </span>
                      <span
                        className={
                          'text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 ' +
                          (TYPE_TONE[it.item_type] ?? 'bg-bg-sunken text-muted')
                        }
                      >
                        {it.item_type}
                      </span>
                      {it.duration_min ? (
                        <span className="text-[11px] font-mono text-faint shrink-0 w-10 text-right">
                          {fmtMinutes(it.duration_min)}
                        </span>
                      ) : null}
                      {assignmentId && !it.completed ? (
                        <Link
                          to={`/training/assignments/${assignmentId}`}
                          className="shrink-0 text-[11px] text-accent hover:underline font-medium"
                          title="Open lesson"
                        >
                          Open →
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Sidebar */}
      <aside className="space-y-4">
        <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-4">
          <Donut pct={pct} />
          <div>
            <div className="text-sm font-semibold text-ink">
              {done} of {total} done
            </div>
            <div className="text-[12px] text-muted">
              On week {currentWeek} of {weeks.length}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">
            Focus areas
          </div>
          <ul className="space-y-2.5">
            {focus.map(([area, e]) => (
              <li key={area}>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-ink truncate">{area}</span>
                  <span className="font-mono text-muted text-[11px]">
                    {e.done}/{e.total}
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-bg-sunken overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full"
                    style={{ width: `${Math.round((e.done / e.total) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
