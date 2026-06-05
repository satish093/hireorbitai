import clsx from 'clsx';

/**
 * Color band for a match score — a distinct hue per range so the number reads
 * at a glance: emerald (excellent) → sky (good) → amber (fair) → orange (weak)
 * → rose (poor); muted when there's no signal (0). Shared by the ring + the
 * "why this score" panel so the dot/label/arc all agree.
 */
export function matchTone(score: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  if (pct <= 0) return 'text-muted';
  if (pct >= 85) return 'text-emerald-500';
  if (pct >= 70) return 'text-sky-500';
  if (pct >= 55) return 'text-amber-500';
  if (pct >= 40) return 'text-orange-500';
  return 'text-rose-500';
}

/** Jobright-style word band for a match score, paired with {@link matchTone}. */
export function matchBand(score: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  if (pct <= 0) return 'Not scored';
  if (pct >= 85) return 'Strong match';
  if (pct >= 70) return 'Good match';
  if (pct >= 55) return 'Fair match';
  if (pct >= 40) return 'Partial match';
  return 'Weak match';
}

/**
 * Circular AI-match score ring (Jobright-style). Pure SVG, no deps. The track +
 * progress arc both use currentColor via {@link matchTone} so it themes
 * correctly in light/dark and shifts hue across the score range.
 */
export function MatchRing({
  score,
  size = 46,
  stroke = 4,
  label = 'match',
}: {
  score: number;
  size?: number;
  stroke?: number;
  /** Tiny caption under the number; pass '' to hide. */
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const tone = matchTone(pct);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`AI match score ${pct} percent`}
      title={`AI match score: ${pct}%`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="currentColor"
          className="text-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="currentColor"
          className={clsx('transition-[stroke-dasharray] duration-500', tone)}
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className={clsx('font-mono font-semibold tabular-nums', tone)}
          style={{ fontSize: size * 0.28 }}
        >
          {pct}
        </span>
        {label && (
          <span className="text-muted" style={{ fontSize: size * 0.16 }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
