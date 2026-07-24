import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Positions a floating panel (portaled to <body>) in viewport coordinates,
 * anchored to a trigger element. Used by Popover + DateTimePicker so their
 * menus escape ancestor `overflow-hidden` / `transform` stacking contexts —
 * the menu can never be clipped or painted behind a sibling card again.
 *
 * Returns refs to attach to the trigger and the panel, plus a `style` object
 * the panel must spread. Positioning is recomputed on open and on any
 * scroll/resize (capture-phase scroll catches nested scroll containers).
 *
 * The panel renders `visibility: hidden` for the first synchronous frame so it
 * can be measured, then `useLayoutEffect` places it before the browser paints —
 * no flicker, no layout shift.
 */

type Align = 'left' | 'right';
type Placement = 'bottom' | 'top';

const GAP = 4; // px between trigger and panel (matches the old `mt-1`)

export function useAnchoredPosition(
  open: boolean,
  opts: { align?: Align; placement?: Placement } = {},
): {
  triggerRef: React.RefObject<HTMLDivElement>;
  panelRef: React.RefObject<HTMLDivElement>;
  style: React.CSSProperties;
} {
  const { align = 'left', placement = 'bottom' } = opts;
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    if (!open) return;

    const reposition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const t = trigger.getBoundingClientRect();
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Vertical: place below by default; flip above only when it doesn't fit
      // below and there's more room above. `placement: 'top'` prefers above.
      const fitsBelow = t.bottom + GAP + ph <= vh;
      const roomAbove = t.top - GAP - ph >= GAP;
      const placeAbove = placement === 'top' ? roomAbove : !fitsBelow && t.top > vh - t.bottom;
      const top = placeAbove ? Math.max(GAP, t.top - GAP - ph) : t.bottom + GAP;

      // Horizontal: align the chosen edge to the trigger, then clamp into view.
      let left = align === 'right' ? t.right - pw : t.left;
      left = Math.min(Math.max(GAP, left), Math.max(GAP, vw - pw - GAP));

      setStyle({ position: 'fixed', top, left, visibility: 'visible' });
    };

    reposition();
    // capture: true so we also catch scrolls inside nested scroll containers.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, align, placement]);

  return { triggerRef, panelRef, style };
}
