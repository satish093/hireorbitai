import { EmptyChart } from '../EmptyChart';
import type { AreaPoint } from '../types';

interface StackedAreaChartProps {
  data: AreaPoint[];
  labels?: {
    submissions: string;
    interviews: string;
    offers: string;
  };
}

const DEFAULT_LABELS = {
  submissions: 'Submissions',
  interviews: 'Interviews',
  offers: 'Offers',
};

/** Build a closed SVG area path from top-edge points + baseline points in reverse. */
function buildAreaPath(topPoints: [number, number][], basePoints: [number, number][]): string {
  if (topPoints.length === 0) return '';

  const moveTo = `M ${topPoints[0][0].toFixed(3)} ${topPoints[0][1].toFixed(3)}`;
  const topLine = topPoints
    .slice(1)
    .map(([x, y]) => `L ${x.toFixed(3)} ${y.toFixed(3)}`)
    .join(' ');

  // Close back along the base in reverse
  const bottomLine = [...basePoints]
    .reverse()
    .map(([x, y]) => `L ${x.toFixed(3)} ${y.toFixed(3)}`)
    .join(' ');

  return `${moveTo} ${topLine} ${bottomLine} Z`;
}

/** Build a stroke-only polyline path from a series of points. */
function buildLinePath(points: [number, number][]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return (
    `M ${first[0].toFixed(3)} ${first[1].toFixed(3)} ` +
    rest.map(([x, y]) => `L ${x.toFixed(3)} ${y.toFixed(3)}`).join(' ')
  );
}

export function StackedAreaChart({ data, labels }: StackedAreaChartProps): JSX.Element {
  if (!data?.length) {
    return <EmptyChart />;
  }

  const resolvedLabels = { ...DEFAULT_LABELS, ...labels };

  const W = 100;
  const H = 60; // viewBox height units

  const n = data.length;

  // Compute stacked totals per data point (submissions at bottom, interviews on top, offers topmost)
  const stacked = data.map((d) => ({
    sub: d.submissions,
    subInt: d.submissions + d.interviews,
    subIntOff: d.submissions + d.interviews + d.offers,
  }));

  const maxStacked = Math.max(...stacked.map((s) => s.subIntOff), 1);

  function xAt(i: number): number {
    return n === 1 ? W / 2 : (i / (n - 1)) * W;
  }

  function yAt(value: number): number {
    return H - (value / maxStacked) * H;
  }

  // Zero baseline (bottom of chart)
  const baselinePoints: [number, number][] = data.map((_, i) => [xAt(i), H]);

  // Top edge of submissions band
  const subTopPoints: [number, number][] = stacked.map((s, i) => [xAt(i), yAt(s.sub)]);

  // Top edge of interviews band (base = subTopPoints)
  const intTopPoints: [number, number][] = stacked.map((s, i) => [xAt(i), yAt(s.subInt)]);

  // Top edge of offers band (base = intTopPoints)
  const offTopPoints: [number, number][] = stacked.map((s, i) => [xAt(i), yAt(s.subIntOff)]);

  // Paths
  const submissionsArea = buildAreaPath(subTopPoints, baselinePoints);
  const interviewsArea = buildAreaPath(intTopPoints, subTopPoints);
  const offersArea = buildAreaPath(offTopPoints, intTopPoints);

  // Top stroke lines
  const submissionsLine = buildLinePath(subTopPoints);
  const interviewsLine = buildLinePath(intTopPoints);
  const offersLine = buildLinePath(offTopPoints);

  // Guide lines at 25 / 50 / 75 % of y-axis
  const guideYs = [0.25, 0.5, 0.75].map((frac) => yAt(maxStacked * frac));

  const seriesColors = {
    submissions: 'var(--brand-from)',
    interviews: 'var(--brand-to)',
    offers: 'var(--success)',
  };

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[220px]"
        aria-hidden
      >
        {/* Dashed horizontal guide lines */}
        {guideYs.map((gy, gi) => (
          <line
            key={gi}
            x1={0}
            y1={gy.toFixed(3)}
            x2={W}
            y2={gy.toFixed(3)}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Filled area bands — bottom to top (submissions widest, offers narrowest) */}
        <path d={submissionsArea} fill="var(--brand-from)" fillOpacity={0.5} stroke="none" />
        <path d={interviewsArea} fill="var(--brand-to)" fillOpacity={0.3} stroke="none" />
        <path d={offersArea} fill="var(--success)" fillOpacity={0.15} stroke="none" />

        {/* Top-edge strokes */}
        <path
          d={submissionsLine}
          fill="none"
          stroke="var(--brand-from)"
          strokeWidth="0.6"
          strokeOpacity={1}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={interviewsLine}
          fill="none"
          stroke="var(--brand-to)"
          strokeWidth="0.6"
          strokeOpacity={1}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={offersLine}
          fill="none"
          stroke="var(--success)"
          strokeWidth="0.6"
          strokeOpacity={1}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-[11px] text-muted flex-wrap">
        {(
          [
            ['submissions', seriesColors.submissions, resolvedLabels.submissions],
            ['interviews', seriesColors.interviews, resolvedLabels.interviews],
            ['offers', seriesColors.offers, resolvedLabels.offers],
          ] as [string, string, string][]
        ).map(([key, color, label]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: color }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
