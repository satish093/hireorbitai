import { KpiRow } from './KpiCard';
import { EmptyChart } from './EmptyChart';
import { Pill } from '../Pill';
import type { PillTone } from '../Pill';
import type { SourcesPayload } from './types';

// ---------------------------------------------------------------------------
// Row type cast
// ---------------------------------------------------------------------------

type HealthStatus = 'healthy' | 'degraded' | 'failing';

interface SourceRow {
  source: string;
  jobs: number;
  matchAvg: number;
  subs: number;
  latency: string;
  health: HealthStatus;
}

function castRow(r: Record<string, unknown>): SourceRow {
  const raw = String(r.health ?? 'healthy').toLowerCase();
  const health: HealthStatus =
    raw === 'degraded' ? 'degraded' : raw === 'failing' ? 'failing' : 'healthy';
  return {
    source: String(r.source ?? ''),
    jobs: Number(r.jobs ?? 0),
    matchAvg: Number(r.matchAvg ?? 0),
    subs: Number(r.subs ?? 0),
    latency: String(r.latency ?? '—'),
    health,
  };
}

// ---------------------------------------------------------------------------
// Health pill tones
// ---------------------------------------------------------------------------

const TONE: Record<HealthStatus, PillTone> = {
  healthy: {
    bg: 'bg-success-soft',
    text: 'text-success',
    dot: 'bg-success',
  },
  degraded: {
    bg: 'bg-warn-soft',
    text: 'text-warn',
    dot: 'bg-warn',
  },
  failing: {
    bg: 'bg-danger-soft',
    text: 'text-danger',
    dot: 'bg-danger',
  },
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  failing: 'Failing',
};

// ---------------------------------------------------------------------------
// SourcesReport — public export
// ---------------------------------------------------------------------------

export function SourcesReport({
  data,
  loading,
}: {
  data: SourcesPayload | null;
  loading: boolean;
}): JSX.Element {
  if (loading) return <EmptyChart message="Loading…" />;
  if (!data) return <EmptyChart />;

  const rows = data.table.map(castRow);

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <KpiRow kpis={data.kpis} />

      {/* Table card */}
      <div className="rounded-xl border border-border bg-surface">
        {/* Card header */}
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-ink">Source performance</h3>
        </div>

        {/* Horizontally scrollable table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-sunken">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide">
                  Source
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide">
                  Jobs
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Match avg
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide">
                  Subs
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide">
                  Latency
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide">
                  Health
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted text-sm">
                    No sources in this range
                  </td>
                </tr>
              )}
              {rows.map((row, idx) => (
                <tr
                  key={`${row.source}-${idx}`}
                  className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                >
                  {/* Source name */}
                  <td className="px-3 py-2.5 font-medium text-ink whitespace-nowrap">
                    {row.source}
                  </td>

                  {/* Jobs */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                    {row.jobs.toLocaleString()}
                  </td>

                  {/* Match avg */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                    {row.matchAvg}%
                  </td>

                  {/* Subs */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{row.subs}</td>

                  {/* Latency */}
                  <td className="px-3 py-2.5 text-right tabular-nums font-mono text-ink-2">
                    {row.latency}
                  </td>

                  {/* Health pill */}
                  <td className="px-3 py-2.5">
                    <Pill tone={TONE[row.health]} pulseDot={row.health === 'healthy'}>
                      {HEALTH_LABEL[row.health]}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
