import type { ReactNode } from 'react';
import { KpiRow } from './KpiCard';
import { EmptyChart } from './EmptyChart';
import { DonutBreakdown } from './charts/DonutBreakdown';
import type { ConsultantsPayload } from './types';

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
// ConsultantReport — public export
// ---------------------------------------------------------------------------

export function ConsultantReport({
  data,
  loading,
}: {
  data: ConsultantsPayload | null;
  loading: boolean;
}): JSX.Element {
  if (loading) return <EmptyChart message="Loading…" />;
  if (!data) return <EmptyChart />;

  return (
    <div className="space-y-6">
      {/* 1. KPI strip */}
      <KpiRow kpis={data.kpis} />

      {/* 2. Visa mix + Status mix side-by-side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Visa mix">
          <DonutBreakdown data={data.charts.visaMix} centerLabel="consultants" />
        </Card>
        <Card title="Status mix">
          <DonutBreakdown data={data.charts.statusMix} centerLabel="total" />
        </Card>
      </div>
    </div>
  );
}
