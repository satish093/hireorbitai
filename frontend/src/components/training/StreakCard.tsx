import type { ActivityResp } from './types';

/**
 * 14-day study heatmap.
 * Shows current streak, personal best, total hours this week, and day labels.
 */
export function StreakCard({ activity }: { activity: ActivityResp }) {
  const series = activity.series.slice(-14);
  const max = Math.max(1, ...series.map((s) => s.minutes));

  // Total minutes studied in the last 7 calendar days.
  const thisWeekMins = series.slice(-7).reduce((a, s) => a + s.minutes, 0);
  const thisWeekLabel =
    thisWeekMins >= 60
      ? `${(thisWeekMins / 60).toFixed(1)}h this week`
      : `${thisWeekMins}m this week`;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
          Study streak
        </span>
        <span className="text-[11px] font-mono text-muted">best {activity.best}d</span>
      </div>

      <div className="flex items-baseline gap-3 mb-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-ink tabular-nums">{activity.streak}</span>
          <span className="text-[12px] text-muted">
            day{activity.streak === 1 ? '' : 's'} in a row
          </span>
        </div>
        {thisWeekMins > 0 && (
          <span className="text-[11px] font-mono text-accent ml-auto">{thisWeekLabel}</span>
        )}
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-12" aria-hidden="true">
        {series.map((s, i) => {
          const active = s.minutes > 0;
          const recency = 0.45 + (i / Math.max(1, series.length - 1)) * 0.55;
          const heightPct = active ? 25 + (s.minutes / max) * 75 : 8;
          return (
            <div
              key={s.date}
              title={`${s.date}: ${s.minutes} min`}
              className="flex-1 rounded-sm"
              style={{
                height: `${heightPct}%`,
                background: active ? 'var(--accent)' : 'var(--bg-sunken)',
                opacity: active ? recency : 1,
              }}
            />
          );
        })}
      </div>

      {/* Day-of-week labels — show Mon only to avoid clutter */}
      <div className="flex gap-1 mt-1.5" aria-hidden="true">
        {series.map((s) => {
          const day = new Date(s.date + 'T12:00:00').getDay(); // 0=Sun, 1=Mon
          return (
            <div key={s.date} className="flex-1 text-center">
              {day === 1 ? <span className="text-[9px] font-mono text-faint">M</span> : null}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-0.5 text-[10px] font-mono text-faint">
        <span>14d ago</span>
        <span>today</span>
      </div>
    </div>
  );
}
