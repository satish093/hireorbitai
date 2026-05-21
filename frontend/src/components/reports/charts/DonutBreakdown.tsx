import { EmptyChart } from '../EmptyChart';
import type { DonutDatum } from '../types';

const RADIUS = 15.915;
const CIRCUMFERENCE = 100; // 2π × 15.915 ≈ 100

interface ArcSegment {
  datum: DonutDatum;
  offset: number;
  length: number;
  pct: number;
}

function buildSegments(data: DonutDatum[]): ArcSegment[] {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return [];

  let cursor = 0;
  return data.map((datum) => {
    const length = (datum.value / total) * CIRCUMFERENCE;
    const pct = Math.round((datum.value / total) * 100);
    const seg: ArcSegment = { datum, offset: cursor, length, pct };
    cursor += length;
    return seg;
  });
}

export function DonutBreakdown({
  data,
  total,
  centerLabel,
}: {
  data: DonutDatum[];
  total?: string;
  centerLabel?: string;
}): JSX.Element {
  if (!data?.length) {
    return <EmptyChart />;
  }

  const sum = data.reduce((s, d) => s + d.value, 0);
  const centerValue = total ?? sum.toLocaleString();
  const segments = buildSegments(data);

  return (
    <div className="flex items-center gap-5">
      {/* Donut SVG */}
      <div className="relative shrink-0" style={{ width: 140, height: 140 }}>
        <svg viewBox="0 0 42 42" width="140" height="140" aria-hidden="true" role="img">
          {/* Track circle */}
          <circle
            cx="21"
            cy="21"
            r={RADIUS}
            fill="none"
            stroke="var(--bg-sunken)"
            strokeWidth="5"
          />

          {/* Arc segments — rotate group so first segment starts at top (−90°) */}
          <g transform="rotate(-90 21 21)">
            {segments.map((seg, i) => (
              <circle
                key={i}
                cx="21"
                cy="21"
                r={RADIUS}
                fill="none"
                stroke={seg.datum.color}
                strokeWidth="5"
                strokeLinecap="butt"
                strokeDasharray={`${seg.length} ${CIRCUMFERENCE - seg.length}`}
                strokeDashoffset={-seg.offset}
              />
            ))}
          </g>
        </svg>

        {/* Center label overlay */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          aria-hidden="true"
        >
          <span className="text-lg font-semibold text-ink tabular-nums leading-none">
            {centerValue}
          </span>
          {centerLabel && (
            <span className="text-[10px] text-muted mt-0.5 leading-none">{centerLabel}</span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 min-w-0">
        {segments.map((seg) => (
          <div key={seg.datum.label} className="flex items-center gap-2">
            {/* Swatch */}
            <span
              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: seg.datum.color }}
            />
            {/* Label */}
            <span className="text-[13px] text-ink-2 truncate flex-1 min-w-0">
              {seg.datum.label}
            </span>
            {/* Value + pct */}
            <span className="text-[12px] font-mono text-muted whitespace-nowrap ml-2">
              {seg.datum.value.toLocaleString()} <span className="text-faint">({seg.pct}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
