import clsx from 'clsx';
import { MatchRing, matchTone } from './MatchRing';

/** Small check glyph for matched-skill chips. */
function Check() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
    >
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function band(pct: number): string {
  if (pct <= 0) return 'Not scored yet';
  if (pct >= 85) return 'Excellent match';
  if (pct >= 70) return 'Strong match';
  if (pct >= 55) return 'Fair match';
  if (pct >= 40) return 'Partial match';
  return 'Weak match';
}

/**
 * "Why this score" explainer — the answer to a clicked card's match number.
 * Leads with the color-banded ring + a one-word band label, the engine's
 * one-line `why`, and the concrete skills overlap (matched green ✓ vs missing
 * muted). The matched/missing data comes from the recommended feed row, so this
 * only renders meaningfully when a consultant was in context for the score.
 */
export function MatchExplain({
  score,
  why,
  matched = [],
  missing = [],
  className,
}: {
  score: number;
  why?: string | null;
  matched?: string[];
  missing?: string[];
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const tone = matchTone(pct);
  const total = matched.length + missing.length;

  return (
    <div className={clsx('rounded-2xl border border-border bg-surface p-4 shadow-sm', className)}>
      <div className="flex items-center gap-3">
        <MatchRing score={pct} size={56} label="" />
        <div className="min-w-0">
          <div className={clsx('text-sm font-semibold', tone)}>
            {band(pct)} · {pct}%
          </div>
          <div className="text-[12px] text-muted">
            {total > 0
              ? `Skills overlap: ${matched.length} of ${total} required`
              : 'AI match score for this role'}
          </div>
        </div>
      </div>

      {why && <p className="mt-2.5 text-[13px] leading-snug text-ink-2">{why}</p>}

      {total > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {matched.map((s) => (
            <span
              key={`m-${s}`}
              className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-soft px-2 py-0.5 text-[11px] text-success"
              title={`Has: ${s}`}
            >
              <span className="shrink-0">
                <Check />
              </span>
              <span className="truncate max-w-[160px]">{s}</span>
            </span>
          ))}
          {missing.map((s) => (
            <span
              key={`x-${s}`}
              className="inline-flex items-center rounded-full border border-border bg-bg-sunken px-2 py-0.5 text-[11px] text-muted"
              title={`Missing: ${s}`}
            >
              <span className="truncate max-w-[160px]">{s}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
