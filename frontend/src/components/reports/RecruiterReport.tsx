import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KpiRow } from './KpiCard';
import { EmptyChart } from './EmptyChart';
import { Avatar } from '../TaskBits';
import { Button } from '../Button';
import { Popover } from '../ui/Popover';
import type { RecruitersPayload } from './types';

// ---------------------------------------------------------------------------
// Row type cast
// ---------------------------------------------------------------------------

interface RecruiterRow {
  id: string;
  name: string;
  email: string;
  subs: number;
  screens: number;
  offers: number;
  matchAvg: number;
  timeInApp: string;
  spark: number[];
}

function castRow(r: Record<string, unknown>): RecruiterRow {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    email: String(r.email ?? ''),
    subs: Number(r.subs ?? 0),
    screens: Number(r.screens ?? 0),
    offers: Number(r.offers ?? 0),
    matchAvg: Number(r.matchAvg ?? 0),
    timeInApp: String(r.timeInApp ?? '—'),
    spark: Array.isArray(r.spark) ? (r.spark as number[]) : [],
  };
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey = 'subs' | 'screens' | 'offers' | 'matchAvg';
type SortDir = 'asc' | 'desc';

function sortRows(rows: RecruiterRow[], key: SortKey, dir: SortDir): RecruiterRow[] {
  return [...rows].sort((a, b) => {
    const diff = a[key] - b[key];
    return dir === 'asc' ? diff : -diff;
  });
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

function Sparkline({ spark }: { spark: number[] }) {
  if (!spark.length) return <span className="text-muted text-xs">—</span>;
  const max = Math.max(1, ...spark);
  return (
    <span className="inline-flex items-end gap-[1px] h-5">
      {spark.map((val, i) => (
        <span
          key={i}
          className="w-1 bg-accent rounded-sm"
          style={{ height: `${Math.max(8, (val / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Kebab icon (3 dots)
// ---------------------------------------------------------------------------

function KebabIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="2.5" r="1.25" fill="currentColor" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" />
      <circle cx="7.5" cy="12.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sort header cell
// ---------------------------------------------------------------------------

function SortTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-ink transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center justify-end gap-1">
        {label}
        {active && (
          <span className="text-[10px] leading-none text-ink-2">{dir === 'asc' ? '▲' : '▼'}</span>
        )}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// RecruiterReport — public export
// ---------------------------------------------------------------------------

export function RecruiterReport({
  data,
  loading,
}: {
  data: RecruitersPayload | null;
  loading: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'subs',
    dir: 'desc',
  });

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' },
    );
  }

  if (loading) return <EmptyChart message="Loading…" />;
  if (!data) return <EmptyChart />;

  const rows = sortRows(data.table.map(castRow), sort.key, sort.dir);

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <KpiRow kpis={data.kpis} />

      {/* Table card */}
      <div className="rounded-xl border border-border bg-surface">
        {/* Card header */}
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-ink">Recruiter activity</h3>
        </div>

        {/* Horizontally scrollable table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-sunken">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide w-8">
                  #
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide">
                  Recruiter
                </th>
                <SortTh
                  label="Subs"
                  sortKey="subs"
                  active={sort.key === 'subs'}
                  dir={sort.dir}
                  onSort={handleSort}
                />
                <SortTh
                  label="Screens"
                  sortKey="screens"
                  active={sort.key === 'screens'}
                  dir={sort.dir}
                  onSort={handleSort}
                />
                <SortTh
                  label="Offers"
                  sortKey="offers"
                  active={sort.key === 'offers'}
                  dir={sort.dir}
                  onSort={handleSort}
                />
                <SortTh
                  label="Match avg"
                  sortKey="matchAvg"
                  active={sort.key === 'matchAvg'}
                  dir={sort.dir}
                  onSort={handleSort}
                />
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  Time in app
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                  14d
                </th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-muted text-sm">
                    No recruiters in this range
                  </td>
                </tr>
              )}
              {rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-0 hover:bg-hover transition-colors"
                >
                  {/* Rank */}
                  <td className="px-3 py-2.5 text-xs tabular-nums text-muted w-8">{idx + 1}</td>

                  {/* Recruiter name + avatar */}
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <Avatar name={row.name} email={row.email} size={26} />
                      <span className="truncate max-w-[160px] text-ink font-medium">
                        {row.name || row.email}
                      </span>
                    </span>
                  </td>

                  {/* Subs */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{row.subs}</td>

                  {/* Screens */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{row.screens}</td>

                  {/* Offers */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{row.offers}</td>

                  {/* Match avg */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                    {row.matchAvg}%
                  </td>

                  {/* Time in app */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2 whitespace-nowrap">
                    {row.timeInApp}
                  </td>

                  {/* Sparkline */}
                  <td className="px-3 py-2.5">
                    <Sparkline spark={row.spark} />
                  </td>

                  {/* Actions popover */}
                  <td className="px-2 py-2 w-8">
                    <Popover
                      align="right"
                      button={(open) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label="Actions"
                          leftIcon={<KebabIcon />}
                          aria-expanded={open}
                        />
                      )}
                    >
                      {(close) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          block
                          className="!justify-start"
                          onClick={() => {
                            navigate('/recruiters');
                            close();
                          }}
                        >
                          View profile
                        </Button>
                      )}
                    </Popover>
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
