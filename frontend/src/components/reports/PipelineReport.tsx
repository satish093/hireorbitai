import type { ReactNode } from 'react';
import { KpiRow } from './KpiCard';
import { EmptyChart } from './EmptyChart';
import { FunnelLarge } from './charts/FunnelLarge';
import { StackedAreaChart } from './charts/StackedAreaChart';
import { CohortHeatmap } from './charts/CohortHeatmap';
import type { PipelinePayload } from './types';

// ---------------------------------------------------------------------------
// Local card shell helper — avoids repeating the border/bg/padding everywhere.
// ---------------------------------------------------------------------------

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink mb-3">{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineReport — public export
// ---------------------------------------------------------------------------

export function PipelineReport({
  data,
  loading,
}: {
  data: PipelinePayload | null;
  loading: boolean;
}): JSX.Element {
  if (loading) return <EmptyChart message="Loading…" />;
  if (!data) return <EmptyChart />;

  return (
    <div className="space-y-6">
      {/* 1. KPI strip */}
      <KpiRow kpis={data.kpis} />

      {/* 2. Funnel + Volume side-by-side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        <Card title="Funnel">
          <FunnelLarge stages={data.charts.funnel} />
        </Card>
        <Card title="Volume over time">
          <StackedAreaChart data={data.charts.series} />
        </Card>
      </div>

      {/* 3. Full-width cohort heatmap */}
      <Card title="Submission cohorts">
        <CohortHeatmap cohorts={data.charts.cohorts} />
      </Card>
    </div>
  );
}
