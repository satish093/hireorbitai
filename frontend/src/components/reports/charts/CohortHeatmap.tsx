import { EmptyChart } from '../EmptyChart';
import type { Cohort } from '../types';

export function CohortHeatmap({ cohorts }: { cohorts: Cohort[] }): JSX.Element {
  if (!cohorts?.length) {
    return <EmptyChart />;
  }

  const maxCols = Math.min(Math.max(...cohorts.map((c) => c.cells.length), 0), 8);

  const colLabels = Array.from({ length: maxCols }, (_, i) => `W+${i}`);

  return (
    <div className="overflow-x-auto" tabIndex={0}>
      <div className="inline-flex flex-col gap-1 min-w-full">
        {/* Header row */}
        <div className="flex items-center gap-1">
          {/* spacer matching the week label width */}
          <div className="w-12 shrink-0" />
          {colLabels.map((label) => (
            <div
              key={label}
              className="h-7 flex-1 min-w-[28px] grid place-items-center text-[10px] font-mono text-muted"
            >
              {label}
            </div>
          ))}
          {/* spacer matching the n= label */}
          <div className="w-16 ml-2" />
        </div>

        {/* Data rows */}
        {cohorts.map((cohort) => (
          <div key={cohort.week} className="flex items-center gap-1">
            {/* Week label */}
            <div className="w-12 shrink-0 text-[11px] text-muted truncate">{cohort.week}</div>

            {/* Cells */}
            {colLabels.map((_, colIdx) => {
              const raw = cohort.cells[colIdx];
              const isNull = raw == null;
              const pct = isNull ? 0 : Math.round(raw as number);

              if (isNull) {
                return (
                  <div
                    key={colIdx}
                    className="h-7 flex-1 min-w-[28px] rounded-[3px] grid place-items-center text-[10px] bg-bg-sunken"
                  />
                );
              }

              return (
                <div
                  key={colIdx}
                  className="h-7 flex-1 min-w-[28px] rounded-[3px] grid place-items-center text-[10px]"
                  style={{
                    backgroundColor: `color-mix(in oklch, var(--accent) ${pct}%, var(--bg-sunken))`,
                  }}
                >
                  <span className={pct >= 20 ? 'text-ink' : 'text-ink-2'}>{pct}</span>
                </div>
              );
            })}

            {/* n= label */}
            <div className="w-16 ml-2 text-[11px] font-mono text-muted text-left shrink-0">
              n={cohort.size}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
