import type { ReactNode } from 'react';
import { KpiRow } from './KpiCard';
import { EmptyChart } from './EmptyChart';
import { HorizontalBars } from './charts/HorizontalBars';
import type { PlacementsPayload } from './types';

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
// PlacementsReport — public export
// ---------------------------------------------------------------------------

export function PlacementsReport({
  data,
  loading,
}: {
  data: PlacementsPayload | null;
  loading: boolean;
}): JSX.Element {
  if (loading) return <EmptyChart message="Loading…" />;
  if (!data) return <EmptyChart />;

  return (
    <div className="space-y-6">
      {/* 1. KPI strip */}
      <KpiRow kpis={data.kpis} />

      {/* 2. Placements by client */}
      <Card title="Placements by client">
        <HorizontalBars data={data.charts.byClient} />
      </Card>
    </div>
  );
}
