import type { ReactNode } from 'react';
import { KpiRow } from './KpiCard';
import { EmptyChart } from './EmptyChart';
import { StackedAreaChart } from './charts/StackedAreaChart';
import { HorizontalBars } from './charts/HorizontalBars';
import type { AIUsagePayload } from './types';

// ---------------------------------------------------------------------------
// Local card shell helper
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
// AIUsageReport — public export
// ---------------------------------------------------------------------------

export function AIUsageReport({
  data,
  loading,
}: {
  data: AIUsagePayload | null;
  loading: boolean;
}): JSX.Element {
  if (loading) return <EmptyChart message="Loading…" />;
  if (!data) return <EmptyChart />;

  return (
    <div className="space-y-6">
      {/* 1. KPI strip */}
      <KpiRow kpis={data.kpis} />

      {/* 2. Usage over time (wider) + Token spend side-by-side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        <Card title="Usage over time">
          <StackedAreaChart
            data={data.charts.series}
            labels={{
              submissions: 'AI scores',
              interviews: 'Resume sessions',
              offers: 'Vendor emails',
            }}
          />
        </Card>
        <Card title="Token spend">
          <HorizontalBars data={data.charts.tokenSpend} />
        </Card>
      </div>
    </div>
  );
}
