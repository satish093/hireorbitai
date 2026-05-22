import type { ActivityResp } from './types';

/**
 * 14-day study heatmap. Days with study time get a filled bar; more recent days
 * read stronger (higher accent opacity) so the eye tracks momentum. Header shows
 * the current streak + personal best.
 */
export function StreakCard({ activity }: { activity: ActivityResp }) {
  const series = activity.series.slice(-14);
  const max = Math.max(1, ...series.map((s) => s.minutes));

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
          Study streak
        </span>
        <span className="text-[11px] font-mono text-muted">best {activity.best}d</span>
      </div>

      <div className="flex items-baseline gap-1.5 mb-3">
        <span className="text-2xl font-semibold text-ink tabular-nums">{activity.streak}</span>
        <span className="text-[12px] text-muted">
          day{activity.streak === 1 ? '' : 's'} in a row
        </span>
      </div>

      <div className="flex items-end gap-1 h-12" aria-hidden="true">
        {series.map((s, i) => {
          const active = s.minutes > 0;
          // More recent → stronger. Opacity ramps across the last few days.
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
      <div className="flex justify-between mt-1.5 text-[10px] font-mono text-faint">
        <span>14d ago</span>
        <span>today</span>
      </div>
    </div>
  );
}
