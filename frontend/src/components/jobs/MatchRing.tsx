import clsx from 'clsx';

/**
 * Circular AI-match score ring (Jobright-style). Color bands mirror the old
 * MatchPill so the feed reads consistently:
 *   ≥85 strong (success) · ≥75 good (accent) · else neutral (muted).
 * Pure SVG, no deps. The track + progress arc both use currentColor via a tone
 * class so it themes correctly in light/dark.
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
  const tone =
    pct >= 85 ? 'text-success' : pct >= 75 ? 'text-accent' : pct > 0 ? 'text-ink-2' : 'text-muted';

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
