import clsx from 'clsx';
import { useReportContext } from './ReportContext';
import type { Kpi } from './types';

function TrendArrow({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden
    >
      {dir === 'up' ? (
        <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M7 7l10 10M9 17h8V9" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export interface KpiCardProps {
  label: string;
  value: string;
  prior?: string;
  delta?: string;
  trend?: 'up' | 'down';
  positive?: boolean;
  helpText?: string;
}

/**
 * KPI tile. Shows the prior-period value + a tone-coded delta pill only when
 * the report's "vs. prior period" toggle is on.
 */
export function KpiCard({ label, value, prior, delta, trend, positive, helpText }: KpiCardProps) {
  const { compareToPrior } = useReportContext();
  const showCompare = compareToPrior && (prior != null || delta != null);
  const pill =
    positive === undefined
      ? 'bg-bg-sunken text-muted border-border'
      : positive
        ? 'bg-success-soft text-success border-success/30'
        : 'bg-danger-soft text-danger border-danger/30';

  return (
    <div className="rounded-xl border border-border bg-surface p-4" title={helpText}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</div>
        {showCompare && delta != null && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-mono font-medium',
              pill,
            )}
          >
            {trend && <TrendArrow dir={trend} />}
            {delta}
          </span>
        )}
      </div>
      {showCompare && prior != null && (
        <div className="mt-1 text-[11px] text-muted">
          prior <span className="font-mono">{prior}</span>
        </div>
      )}
    </div>
  );
}

/** Convenience grid for a row of KPIs. */
export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  if (!kpis || kpis.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {kpis.map((k) => (
        <KpiCard key={k.label} {...k} />
      ))}
    </div>
  );
}
