/**
 * CompBandCard — Compensation band visualizer.
 *
 * Renders a horizontal track spanning the market range with an overlaid role
 * band segment and an optional ask-value marker pinned at the interpolated
 * position of `askValue` within the market range.
 *
 * Color tokens used: bg-surface, border-border, text-muted, bg-bg-sunken,
 * bg-accent-soft, border-accent, bg-ink, text-ink, text-ink-2.
 */

/** Format a compensation number.
 *  - Values < 1000 are treated as hourly → "$N/hr"
 *  - Values >= 1000 are treated as annual salary → "$NNNk"
 */
function fmt(n: number): string {
  if (n < 1_000) {
    return `$${Math.round(n)}/hr`;
  }
  return `$${Math.round(n / 1_000)}k`;
}

/** Linear-interpolate `value` into a [0, 1] percentage within [min, max].
 *  Clamped to [0, 1] so out-of-range values sit at the edges. */
function pct(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function CompBandCard({
  marketRange,
  roleRange,
  askValue,
  candidateName,
}: {
  marketRange: [number, number];
  roleRange: [number, number];
  askValue?: number | null;
  candidateName?: string | null;
}): JSX.Element {
  const [mMin, mMax] = marketRange;
  const [rMin, rMax] = roleRange;

  const rolePctLeft = pct(rMin, mMin, mMax);
  const rolePctRight = pct(rMax, mMin, mMax);
  const roleWidth = rolePctRight - rolePctLeft;

  const showAsk = askValue != null;
  const askPct = showAsk ? pct(askValue!, mMin, mMax) : 0;
  const askLabel = showAsk ? `${candidateName?.trim() || 'Ask'}: ${fmt(askValue!)}` : '';

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {/* Eyebrow */}
      <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">Compensation</p>

      {/* Ask label — floated above the track */}
      {showAsk && (
        <div className="relative h-5 mb-1">
          {/* Position the label centered on the marker, clamped so it doesn't
              overflow the card edges. We use inline style for the dynamic left
              percentage since arbitrary Tailwind percentages aren't in the config. */}
          <span
            className="absolute -translate-x-1/2 text-[11px] font-medium text-ink whitespace-nowrap"
            style={{
              left: `${Math.min(Math.max(askPct * 100, 10), 90)}%`,
              bottom: 0,
            }}
          >
            {askLabel}
          </span>
        </div>
      )}

      {/* Track */}
      <div className="relative h-2 rounded-full bg-bg-sunken overflow-visible">
        {/* Role band overlay */}
        <div
          className="absolute top-0 h-full rounded-full bg-accent-soft border border-accent"
          style={{
            left: `${rolePctLeft * 100}%`,
            width: `${Math.max(roleWidth * 100, 2)}%`,
          }}
          aria-label={`Role band: ${fmt(rMin)} – ${fmt(rMax)}`}
        />

        {/* Ask marker — 2 px wide, 16 px tall, centered on the track */}
        {showAsk && (
          <div
            className="absolute bg-ink rounded-sm"
            style={{
              left: `${askPct * 100}%`,
              width: '2px',
              height: '16px',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            aria-label={`Ask value: ${fmt(askValue!)}`}
          />
        )}
      </div>

      {/* Min / max labels under the track */}
      <div className="flex justify-between mt-1.5">
        <span className="text-[11px] text-muted">{fmt(mMin)}</span>
        <span className="text-[11px] text-muted">{fmt(mMax)}</span>
      </div>

      {/* Role band caption */}
      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="inline-block w-3 h-2 rounded-sm bg-accent-soft border border-accent"
          aria-hidden="true"
        />
        <span className="text-[11px] text-ink-2">
          Role band: {fmt(rMin)} – {fmt(rMax)}
        </span>
      </div>
    </div>
  );
}
