import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../Button';
import { SkeletonCard } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { downloadCsv } from './exportUtils';
import toast from 'react-hot-toast';

/**
 * Submissions reports — submissions grouped by consultant and by recruiter, with
 * daily / weekly / monthly / custom range filters. Self-fetching tab (like the
 * Daily log) — the backend is the source of truth (applications table) and
 * applies role scoping (admin all, group lead → group, recruiter → own). Date
 * boundaries are computed here in the BROWSER's timezone and passed as explicit
 * from/to instants, so the windows are timezone-correct for the viewer.
 */

type Period = 'daily' | 'weekly' | 'monthly' | 'custom';

interface Agg {
  id: string;
  name: string;
  total: number;
  by_status: Record<string, number>;
  interviews: number;
  offers: number;
  rejections: number;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'custom', label: 'Custom' },
];

/** Local-timezone [from, to] ISO instants for the chosen period. */
function rangeFor(
  period: Period,
  custom: { from: string; to: string },
): { from: string; to: string } {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  if (period === 'daily') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else {
    // custom — interpret the date inputs as local start/end of day
    const f = custom.from ? new Date(custom.from + 'T00:00:00') : new Date(now.getFullYear(), 0, 1);
    const t = custom.to ? new Date(custom.to + 'T23:59:59') : now;
    return { from: f.toISOString(), to: t.toISOString() };
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

function SubmissionTable({ title, rows }: { title: string; rows: Agg[] }) {
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
        <EmptyState
          compact
          title="No submissions in this range"
          description="Try a wider date range."
        />
      </div>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-hover text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2">Submitted</th>
              <th className="text-right px-3 py-2">Interviews</th>
              <th className="text-right px-3 py-2">Offers</th>
              <th className="text-right px-3 py-2">Rejected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-hover">
                <td className="px-3 py-2 text-ink">{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{r.total}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.by_status.SUBMITTED ?? 0}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.interviews}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.offers}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.rejections}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SubmissionsReport({ showByRecruiter = true }: { showByRecruiter?: boolean } = {}) {
  const [period, setPeriod] = useState<Period>('weekly');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [byConsultant, setByConsultant] = useState<Agg[]>([]);
  const [byRecruiter, setByRecruiter] = useState<Agg[]>([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => rangeFor(period, custom), [period, custom]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { from: range.from, to: range.to };
    Promise.all([
      api.get('/reports/submissions/by-consultant', { params }),
      api.get('/reports/submissions/by-recruiter', { params }),
    ])
      .then(([c, r]) => {
        if (cancelled) return;
        setByConsultant(c.data?.consultants ?? []);
        setByRecruiter(r.data?.recruiters ?? []);
      })
      .catch((e) => {
        if (!cancelled)
          toast.error(e?.response?.data?.error ?? 'Failed to load submissions report');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  function exportCsv() {
    const header = ['Group', 'Name', 'Total', 'Submitted', 'Interviews', 'Offers', 'Rejected'];
    const rows: (string | number)[][] = [header];
    for (const c of byConsultant)
      rows.push([
        'Consultant',
        c.name,
        c.total,
        c.by_status.SUBMITTED ?? 0,
        c.interviews,
        c.offers,
        c.rejections,
      ]);
    for (const r of byRecruiter)
      rows.push([
        'Recruiter',
        r.name,
        r.total,
        r.by_status.SUBMITTED ?? 0,
        r.interviews,
        r.offers,
        r.rejections,
      ]);
    downloadCsv(`submissions-${period}.csv`, rows);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={
                'px-3 py-1.5 text-sm transition ' +
                (period === p.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface text-ink hover:bg-hover')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={custom.from}
              onChange={(e) => setCustom((s) => ({ ...s, from: e.target.value }))}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
              aria-label="From date"
            />
            <span className="text-muted text-sm">to</span>
            <input
              type="date"
              value={custom.to}
              onChange={(e) => setCustom((s) => ({ ...s, to: e.target.value }))}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
              aria-label="To date"
            />
          </div>
        )}
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={loading}>
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <SkeletonCard />
      ) : (
        <div className="grid gap-6">
          <SubmissionTable title="Submissions by consultant" rows={byConsultant} />
          {showByRecruiter && (
            <SubmissionTable title="Submissions by recruiter" rows={byRecruiter} />
          )}
        </div>
      )}
    </div>
  );
}
