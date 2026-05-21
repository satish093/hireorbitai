import { useEffect, useState } from 'react';
import { Avatar } from '../TaskBits';
import { GroupBadge } from '../GroupBadge';
import { api } from '../../services/api';
import { EmptyChart } from './EmptyChart';
import { useReportContext } from './ReportContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserTimeRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  group_id: string | null;
  last_seen_at: string | null;
  total_seconds: number;
  days_active: number;
  by_day: { date: string; active_seconds: number }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Sparkline — last 14 bars
// ---------------------------------------------------------------------------

function ActivitySparkline({ byDay }: { byDay: UserTimeRow['by_day'] }) {
  const bars = byDay.slice(-14);
  if (!bars.length) return <span className="text-faint text-xs">—</span>;
  const peak = Math.max(1, ...bars.map((b) => b.active_seconds));
  return (
    <span className="inline-flex items-end gap-[1px] h-4">
      {bars.map((b, i) => (
        <span
          key={i}
          className="w-1.5 bg-accent rounded-sm"
          style={{ height: `${Math.max(2, Math.round((b.active_seconds / peak) * 100))}%` }}
          title={`${b.date}: ${formatDuration(b.active_seconds)}`}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TimeInAppReport — public export
// ---------------------------------------------------------------------------

export function TimeInAppReport(): JSX.Element {
  const { resolved } = useReportContext();
  const [rows, setRows] = useState<UserTimeRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    api
      .get('/reports/user-time', { params: { from: ymd(resolved.from), to: ymd(resolved.to) } })
      .then((r) => setRows((r.data?.users ?? []) as UserTimeRow[]))
      .catch(() => setRows([]));
  }, [resolved.from, resolved.to]);

  if (rows === null) return <EmptyChart message="Loading…" />;
  if (rows.length === 0) return <EmptyChart message="No activity recorded in this range." />;

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-ink">Time in app</h3>
      </div>

      {/* Horizontally scrollable table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-sunken">
              <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                User
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                Role
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                Time in app
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                Days active
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                Avg / day
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                Last seen
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap">
                Activity
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.user_id}
                className="border-b border-border last:border-0 hover:bg-hover transition-colors"
              >
                {/* User */}
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Avatar name={r.full_name} email={r.email} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate max-w-[160px] text-ink font-medium">
                        {r.full_name ?? r.email ?? r.user_id}
                      </span>
                      {r.full_name && r.email && (
                        <span className="block truncate max-w-[160px] text-xs text-muted">
                          {r.email}
                        </span>
                      )}
                    </span>
                  </span>
                </td>

                {/* Role + group */}
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                    {r.role && (
                      <span className="bg-bg-sunken text-ink px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wide whitespace-nowrap">
                        {r.role}
                      </span>
                    )}
                    <GroupBadge groupId={r.group_id} compact hideEmpty />
                  </span>
                </td>

                {/* Time in app */}
                <td className="px-3 py-2.5 text-right tabular-nums text-ink font-semibold whitespace-nowrap">
                  {formatDuration(r.total_seconds)}
                </td>

                {/* Days active */}
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{r.days_active}</td>

                {/* Avg / day */}
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-2 whitespace-nowrap">
                  {r.days_active > 0
                    ? formatDuration(Math.round(r.total_seconds / r.days_active))
                    : '—'}
                </td>

                {/* Last seen */}
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-2 whitespace-nowrap">
                  {r.last_seen_at ? relativeTime(r.last_seen_at) : '—'}
                </td>

                {/* Activity sparkline */}
                <td className="px-3 py-2.5">
                  <ActivitySparkline byDay={r.by_day} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
