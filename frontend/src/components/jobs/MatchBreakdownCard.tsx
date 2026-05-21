/**
 * MatchBreakdownCard — per-facet match score breakdown.
 *
 * Renders an eyebrow-titled card with a scored row for every facet:
 *   - Label + score on one line
 *   - Colored fill bar (success / accent / faint by score tier)
 *   - Explanatory "why" sub-line
 *
 * Color tokens used: bg-surface, border-border, text-muted, text-ink,
 * bg-hover, bg-success, bg-accent, bg-faint, text-[11px] eyebrow pattern.
 */

export interface MatchFacet {
  label: string;
  /** 0–100 */
  score: number;
  why: string;
}

/** Pick fill color class by score tier. */
function barFill(score: number): string {
  if (score >= 85) return 'bg-success';
  if (score >= 70) return 'bg-accent';
  return 'bg-faint';
}

export function MatchBreakdownCard({ facets }: { facets: MatchFacet[] }): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {/* Eyebrow */}
      <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">
        Match breakdown
      </p>

      {facets.length === 0 ? (
        <p className="text-[13px] text-muted italic">No breakdown available.</p>
      ) : (
        <ul className="space-y-0">
          {facets.map((facet, i) => (
            <li key={facet.label} className={i > 0 ? 'mt-3' : ''}>
              {/* Label + score */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-medium text-ink leading-none">{facet.label}</span>
                <span className="text-[12px] font-mono text-muted tabular-nums leading-none">
                  {facet.score}%
                </span>
              </div>

              {/* Bar track */}
              <div className="h-1 rounded-full bg-hover overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${barFill(facet.score)}`}
                  style={{ width: `${Math.min(100, Math.max(0, facet.score))}%` }}
                  role="progressbar"
                  aria-valuenow={facet.score}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${facet.label} score: ${facet.score}%`}
                />
              </div>

              {/* Why sub-line */}
              <p className="text-[12px] text-muted mt-0.5 leading-snug">{facet.why}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
