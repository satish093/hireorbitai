import clsx from 'clsx';
import type { UserKpi } from './types';

type Tone = 'default' | 'success' | 'warn' | 'danger';

const VALUE_TONE: Record<Tone, string> = {
  default: 'text-ink',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
};

/**
 * One KPI card. `tone` recolors the value; `hint='●'` renders a live dot before
 * the label (used by "Online now"). `delta`/`hint` add a small caption line.
 */
export function AdminKpi({
  label,
  value,
  delta,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  delta?: string;
  hint?: string;
  tone?: Tone;
}) {
  const liveDot = hint === '●';
  return (
    <div className="flex-1 min-w-[140px] bg-surface border border-border rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
        {liveDot && (
          <span
            aria-hidden="true"
            className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-soft"
          />
        )}
        {label}
      </div>
      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', VALUE_TONE[tone])}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {(delta || (hint && !liveDot)) && (
        <div className="mt-0.5 text-[11px] text-faint">{delta ?? hint}</div>
      )}
    </div>
  );
}

/**
 * The 5-card KPI strip: Active · Online now · Pending invites · Locked ·
 * Inactive 30d. Counts come from GET /admin/users/kpi.
 */
export function AdminKpiStrip({ kpi, loading }: { kpi: UserKpi | null; loading?: boolean }) {
  if (loading || !kpi) {
    return (
      <div className="flex flex-wrap gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 min-w-[140px] h-[88px] bg-surface border border-border rounded-xl skeleton"
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <AdminKpi label="Active" value={kpi.active} tone="success" />
      <AdminKpi label="Online now" value={kpi.online} hint="●" />
      <AdminKpi label="Pending invites" value={kpi.pending} tone="warn" />
      <AdminKpi label="Locked" value={kpi.locked} tone="danger" delta="suspended / banned" />
      <AdminKpi label="Inactive 30d" value={kpi.inactive} delta="no activity in 30d" />
    </div>
  );
}
