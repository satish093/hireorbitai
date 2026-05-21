import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import {
  PIPELINE_STAGES,
  stageForStatus,
  type DashApplication,
  type DashConsultant,
  type PipelineStage,
} from './types';

// ---------------------------------------------------------------------------
// Local augmentation — DashApplication.job may carry source + client fields
// that the narrow shared type omits. We read them defensively so TS stays
// happy without mutating the shared types file.
// ---------------------------------------------------------------------------
interface RichJob {
  id?: string;
  title?: string | null;
  source?: string | null;
  client?: { company_name?: string | null } | null;
}

type View = 'funnel' | 'source' | 'client';

// Status → URL param mapping for navigation
const STAGE_TO_STATUS: Partial<Record<PipelineStage, string>> = {
  Submitted: 'SUBMITTED',
  Screening: 'SCREENING',
  Interview: 'INTERVIEW',
  Offer: 'OFFER',
  Placed: 'PLACED',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a count map { stage → n } for a given set of apps + consultants.
 *  "Sourced" is always consultants.length for the full funnel, but for
 *  sub-funnel (by-source / by-client) we treat it as the app count for that
 *  group, because we don't have per-source consultant data. */
function buildCounts(apps: DashApplication[], sourcedCount: number): Record<PipelineStage, number> {
  const counts: Record<PipelineStage, number> = {
    Sourced: sourcedCount,
    Submitted: 0,
    Screening: 0,
    Interview: 0,
    Offer: 0,
    Placed: 0,
  };
  for (const app of apps) {
    const stage = stageForStatus(app.status);
    if (stage && stage !== 'Sourced') {
      counts[stage]++;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Stage row — shared by all three views
// ---------------------------------------------------------------------------
interface StageRowProps {
  stage: PipelineStage;
  count: number;
  maxCount: number;
  total: number;
  prevCount: number | null;
  onClickRow: () => void;
  compact?: boolean;
}

function StageRow({
  stage,
  count,
  maxCount,
  total,
  prevCount,
  onClickRow,
  compact,
}: StageRowProps) {
  const pct = Math.round((count / Math.max(total, 1)) * 100);
  const fillPct = (count / Math.max(maxCount, 1)) * 100;

  let dropoff: string;
  if (prevCount === null) {
    dropoff = '';
  } else if (prevCount === 0) {
    dropoff = '—';
  } else {
    const d = Math.round(((prevCount - count) / prevCount) * 100);
    dropoff = d > 0 ? `-${d}%` : `0%`;
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClickRow();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClickRow}
      onKeyDown={handleKeyDown}
      className={`flex items-center gap-3 cursor-pointer hover:bg-hover rounded-md px-1 ${compact ? 'py-1' : 'py-1.5'}`}
    >
      {/* Stage name */}
      <span className="w-24 shrink-0 text-[13px] text-ink">{stage}</span>

      {/* Bar track */}
      <div className="flex-1 h-5 rounded-md bg-bg-sunken relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-md bg-accent-soft transition-all duration-300"
          style={{ width: `${fillPct}%` }}
        >
          {count > 0 && (
            <span className="text-[11px] font-mono text-ink absolute left-2 top-1/2 -translate-y-1/2 select-none">
              {count}
            </span>
          )}
        </div>
        {count === 0 && (
          <span className="text-[11px] font-mono text-faint absolute left-2 top-1/2 -translate-y-1/2 select-none">
            0
          </span>
        )}
      </div>

      {/* % of total */}
      <span className="w-12 text-right text-[12px] font-mono text-muted tabular-nums">{pct}%</span>

      {/* Drop-off vs previous stage */}
      <span className="w-14 text-right text-[11px] font-mono text-faint tabular-nums">
        {dropoff}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini funnel block — used in By Source + By Client views
// ---------------------------------------------------------------------------
interface MiniFunnelProps {
  apps: DashApplication[];
  sourcedCount: number;
}

function MiniFunnel({ apps, sourcedCount }: MiniFunnelProps) {
  const navigate = useNavigate();
  const counts = buildCounts(apps, sourcedCount);
  const maxCount = Math.max(...PIPELINE_STAGES.map((s) => counts[s]), 1);

  return (
    <div className="mt-1">
      {PIPELINE_STAGES.map((stage, i) => {
        const count = counts[stage];
        const prevStage = i > 0 ? PIPELINE_STAGES[i - 1] : null;
        const prevCount = prevStage ? counts[prevStage] : null;

        const handleClick = () => {
          const statusParam = STAGE_TO_STATUS[stage];
          if (statusParam) {
            navigate(`/applications?status=${statusParam}`);
          } else {
            navigate('/applications');
          }
        };

        return (
          <StageRow
            key={stage}
            stage={stage}
            count={count}
            maxCount={maxCount}
            total={sourcedCount}
            prevCount={prevCount}
            onClickRow={handleClick}
            compact
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function PipelineCard({
  apps,
  consultants,
}: {
  apps: DashApplication[];
  consultants: DashConsultant[];
}): JSX.Element {
  const [view, setView] = useState<View>('funnel');
  const navigate = useNavigate();

  // ── Funnel counts ──────────────────────────────────────────────────────────
  const funnelCounts = buildCounts(apps, consultants.length);
  const funnelMax = Math.max(...PIPELINE_STAGES.map((s) => funnelCounts[s]), 1);
  const funnelTotal = consultants.length;

  // ── Group by source ────────────────────────────────────────────────────────
  const bySource = new Map<string, DashApplication[]>();
  for (const app of apps) {
    const richJob = app.job as RichJob | null | undefined;
    const key = richJob?.source ?? 'Unknown';
    const list = bySource.get(key) ?? [];
    list.push(app);
    bySource.set(key, list);
  }
  const sourceEntries = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);

  // ── Group by client ────────────────────────────────────────────────────────
  const byClient = new Map<string, DashApplication[]>();
  for (const app of apps) {
    const richJob = app.job as RichJob | null | undefined;
    const key = richJob?.client?.company_name ?? 'Unassigned';
    const list = byClient.get(key) ?? [];
    list.push(app);
    byClient.set(key, list);
  }
  const clientEntries = [...byClient.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-ink">Pipeline</span>
        <ButtonGroup>
          <ButtonGroupItem pressed={view === 'funnel'} onClick={() => setView('funnel')}>
            Funnel
          </ButtonGroupItem>
          <ButtonGroupItem pressed={view === 'source'} onClick={() => setView('source')}>
            By source
          </ButtonGroupItem>
          <ButtonGroupItem pressed={view === 'client'} onClick={() => setView('client')}>
            By client
          </ButtonGroupItem>
        </ButtonGroup>
      </div>

      {/* ── FUNNEL VIEW ── */}
      {view === 'funnel' && (
        <div>
          {/* Column header row */}
          <div className="flex items-center gap-3 px-1 mb-0.5">
            <span className="w-24 shrink-0 text-[11px] text-faint">Stage</span>
            <span className="flex-1 text-[11px] text-faint">Distribution</span>
            <span className="w-12 text-right text-[11px] text-faint">% total</span>
            <span className="w-14 text-right text-[11px] text-faint">Drop-off</span>
          </div>

          {PIPELINE_STAGES.map((stage, i) => {
            const count = funnelCounts[stage];
            const prevStage = i > 0 ? PIPELINE_STAGES[i - 1] : null;
            const prevCount = prevStage ? funnelCounts[prevStage] : null;

            const handleClick = () => {
              const statusParam = STAGE_TO_STATUS[stage];
              if (statusParam) {
                navigate(`/applications?status=${statusParam}`);
              } else {
                // Sourced → all applications
                navigate('/applications');
              }
            };

            return (
              <StageRow
                key={stage}
                stage={stage}
                count={count}
                maxCount={funnelMax}
                total={funnelTotal}
                prevCount={prevCount}
                onClickRow={handleClick}
              />
            );
          })}
        </div>
      )}

      {/* ── BY SOURCE VIEW ── */}
      {view === 'source' && (
        <div className="space-y-4">
          {sourceEntries.length === 0 ? (
            <p className="text-[13px] text-muted py-2">No source data yet.</p>
          ) : (
            sourceEntries.map(([source, groupApps]) => (
              <div key={source}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-medium text-ink-2">{source}</span>
                  <span className="text-[11px] font-mono text-faint">
                    {groupApps.length} app{groupApps.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <MiniFunnel apps={groupApps} sourcedCount={groupApps.length} />
              </div>
            ))
          )}
        </div>
      )}

      {/* ── BY CLIENT VIEW ── */}
      {view === 'client' && (
        <div className="space-y-4">
          {clientEntries.length === 0 ? (
            <p className="text-[13px] text-muted py-2">No client data yet.</p>
          ) : (
            clientEntries.map(([client, groupApps]) => (
              <div key={client}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-medium text-ink-2">{client}</span>
                  <span className="text-[11px] font-mono text-faint">
                    {groupApps.length} app{groupApps.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <MiniFunnel apps={groupApps} sourcedCount={groupApps.length} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
