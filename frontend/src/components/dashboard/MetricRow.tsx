import { KpiCard } from '../KpiCard';
import type { DashApplication, DashConsultant } from './types';

const WEEK = 7 * 24 * 3_600_000;

/** Four headline metrics: consultants · active · submissions (7d) · match avg. */
export function MetricRow({
  consultants,
  apps,
}: {
  consultants: DashConsultant[];
  apps: DashApplication[];
}) {
  const active = consultants.filter((c) => c.marketing_status === 'ACTIVE').length;
  const placed = consultants.filter((c) => c.marketing_status === 'PLACED').length;

  const now = Date.now();
  const subs7d = apps.filter((a) => {
    const t = new Date(a.submitted_at ?? a.created_at ?? 0).getTime();
    return t > 0 && now - t <= WEEK;
  }).length;

  const scored = apps.map((a) => a.match_score).filter((s): s is number => typeof s === 'number');
  const matchAvg = scored.length
    ? Math.round(scored.reduce((sum, s) => sum + s, 0) / scored.length)
    : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
      <KpiCard label="My consultants" value={consultants.length} accent="blue" />
      <KpiCard label="Active" value={active} delta={`${placed} placed`} accent="green" />
      <KpiCard label="Submissions" value={subs7d} delta="Last 7 days" accent="amber" />
      <KpiCard
        label="Match avg"
        value={matchAvg == null ? '—' : `${matchAvg}%`}
        delta={scored.length ? `${scored.length} scored` : 'No scores yet'}
        accent="brand"
      />
    </div>
  );
}
