import { useEffect, useLayoutEffect, useState } from 'react';

export interface TourStep {
  /** Optional CSS selector to spotlight. If absent or not on screen, the
   *  step card is centered instead of anchored. */
  selector?: string;
  title: string;
  body: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Lightweight guided tour. No external library — a dimming overlay with an
 * optional spotlight cut-out around the current step's target, plus a
 * Back / Next / Skip card. When the target selector is missing or scrolled
 * off-screen the card just centers, so the tour never points at nothing.
 *
 * Respects prefers-reduced-motion via the global CSS rules (the .animate-*
 * classes are neutralized there).
 */
export function TourOverlay({
  steps,
  onClose,
  onComplete,
}: {
  steps: TourStep[];
  /** Called when the user skips or closes (tour considered seen). */
  onClose: () => void;
  /** Called when the user finishes the last step. */
  onComplete: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[idx];
  const isLast = idx === steps.length - 1;

  // Measure the target each time the step changes (and on resize/scroll).
  useLayoutEffect(() => {
    if (!step) return;
    function measure() {
      if (!step.selector) {
        setRect(null);
        return;
      }
      const el = document.querySelector(step.selector);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      // Treat fully off-screen / zero-size targets as "no anchor".
      const onScreen =
        r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight;
      setRect(onScreen ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  // Escape closes the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!step) return null;

  const pad = 6;
  const hole: Rect | null = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  // Position the card: below the spotlight if there's room, otherwise above;
  // when there's no anchor, center it.
  const cardWidth = 340;
  let cardStyle: React.CSSProperties;
  if (hole) {
    const below = hole.top + hole.height + 12;
    const wantTop = below + 180 > window.innerHeight ? Math.max(12, hole.top - 12 - 180) : below;
    let left = hole.left;
    if (left + cardWidth > window.innerWidth - 12) left = window.innerWidth - cardWidth - 12;
    if (left < 12) left = 12;
    cardStyle = { top: wantTop, left, width: cardWidth };
  } else {
    cardStyle = {
      top: '50%',
      left: '50%',
      width: cardWidth,
      transform: 'translate(-50%, -50%)',
    };
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Dim layer. With a spotlight we use a big box-shadow on the hole div
          to darken everything except the cut-out; without one, a plain dim. */}
      {hole ? (
        <div
          className="absolute rounded-xl ring-2 ring-white/80 transition-all"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/55" onClick={onClose} />
      )}

      <div
        className="absolute bg-surface rounded-2xl shadow-2xl ring-1 ring-slate-900/5 p-5 animate-scale-in"
        style={cardStyle}
      >
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="text-[11px] font-semibold tracking-widest text-brand-600 uppercase">
            Step {idx + 1} of {steps.length}
          </span>
          <button
            onClick={onClose}
            aria-label="Skip tour"
            className="-mr-1 -mt-1 w-7 h-7 inline-flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-hover"
          >
            ✕
          </button>
        </div>
        <h3 className="text-base font-semibold text-ink">{step.title}</h3>
        <p className="text-sm text-muted mt-1.5 leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button onClick={onClose} className="text-xs text-muted hover:text-ink">
            Skip
          </button>
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <button
                onClick={() => setIdx((i) => i - 1)}
                className="text-sm px-3 py-1.5 rounded-lg border border-border text-ink hover:bg-hover"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? onComplete() : setIdx((i) => i + 1))}
              className="text-sm px-4 py-1.5 rounded-lg bg-ink text-bg hover:opacity-90"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
