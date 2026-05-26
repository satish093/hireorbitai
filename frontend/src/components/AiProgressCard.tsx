import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Show the card while a long AI operation runs. */
  open: boolean;
  /** Headline, e.g. "Processing your resume". */
  title: string;
  /**
   * Ordered pipeline stages cycled through while the op runs. The backend is a
   * single blocking request that emits no progress, so we advance these on a
   * timer to convey real-time activity, then hold on the last one until the
   * request resolves (which unmounts the card).
   */
  stages: string[];
  /** ms each stage is shown before advancing. Default 4500. */
  stageMs?: number;
  /** Small footnote under the bar, e.g. "This can take up to a minute." */
  note?: string;
}

/**
 * Non-blocking progress card for long-running (10–70s) AI operations —
 * upload/extraction, profile parse, tailoring, study-plan generation. Floats in
 * the bottom-right corner with an animated indicator, a cycling stage label, an
 * advancing (capped) progress bar, and an elapsed timer, so the user can see
 * it's still working while the page behind stays fully scrollable/clickable.
 *
 * The wrapper is `pointer-events-none` so clicks pass straight through;
 * `prefers-reduced-motion` neutralizes the animations globally (see index.css).
 */
export function AiProgressCard({ open, title, stages, stageMs = 4500, note }: Props) {
  const [stageIndex, setStageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!open) return;
    setStageIndex(0);
    setElapsed(0);
    startRef.current = Date.now();

    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    // Advance through the stages, then hold on the last one.
    const advance = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, stages.length - 1));
    }, stageMs);

    return () => {
      clearInterval(tick);
      clearInterval(advance);
    };
  }, [open, stageMs, stages.length]);

  if (!open) return null;

  // Cap below 100% — completion unmounts the card; we never imply "done".
  const pct = Math.min(92, Math.round(((stageIndex + 1) / stages.length) * 100));

  return (
    <div
      className="pointer-events-none fixed left-4 right-4 z-[60] sm:left-auto sm:w-80"
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="animate-scale-in rounded-2xl bg-surface p-4 shadow-2xl ring-1 ring-slate-900/10">
        <div className="flex items-center gap-3">
          {/* Animated indicator: a pulsing spark over a spinning ring. */}
          <div className="relative grid h-9 w-9 shrink-0 place-items-center">
            <span className="absolute inset-0 rounded-full border-[2.5px] border-accent/25 border-t-accent animate-spin" />
            <span className="text-sm text-accent animate-pulse" aria-hidden="true">
              ✦
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight text-ink">{title}</div>
            {/* Cycling stage label — keyed so each change re-triggers the fade. */}
            <p key={stageIndex} className="animate-fade-in truncate text-xs text-muted">
              {stages[stageIndex] ?? stages[stages.length - 1]}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{elapsed}s</span>
        </div>

        {/* Capped progress bar. */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-hover">
          <div
            className="h-full rounded-full bg-accent transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

        {note && <p className="mt-1.5 text-[11px] text-faint">{note}</p>}
      </div>
    </div>
  );
}
