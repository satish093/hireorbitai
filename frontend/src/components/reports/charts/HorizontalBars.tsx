import { EmptyChart } from '../EmptyChart';
import type { BarRow } from '../types';

export function HorizontalBars({ data }: { data: BarRow[] }): JSX.Element {
  if (!data?.length) {
    return <EmptyChart />;
  }

  const max = Math.max(1, ...data.map(([, value]) => value));

  return (
    <div className="space-y-2">
      {data.map(([label, value, rightLabel], idx) => {
        const widthPct = (value / max) * 100;
        return (
          <div key={idx} className="flex items-center gap-3">
            {/* Left label */}
            <span className="w-36 shrink-0 text-[13px] text-ink-2 truncate">{label}</span>

            {/* Bar track */}
            <div className="flex-1 h-5 rounded-md bg-bg-sunken overflow-hidden relative">
              {/* Fill */}
              <div className="h-full rounded-md bg-accent-soft" style={{ width: `${widthPct}%` }} />
              {/* Value label inside bar */}
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-mono text-ink">
                {value.toLocaleString()}
              </span>
            </div>

            {/* Optional right label */}
            {rightLabel != null && (
              <span className="w-16 text-right text-[12px] font-mono text-muted shrink-0">
                {rightLabel}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
