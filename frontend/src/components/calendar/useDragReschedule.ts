import { useCallback, useRef, useState } from 'react';
import type { CalEvent } from './types';

export interface DragPreview {
  id: string;
  /** Vertical px offset to apply to the dragged block. */
  offsetPx: number;
  /** Live snapped target start. */
  newStart: Date;
  /** Short label shown on the ghost (e.g. "2:15 PM"). */
  label: string;
}

interface DragState {
  id: string;
  origStart: number; // ms
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  moved: boolean;
}

const MOVE_THRESHOLD = 4; // px before a press becomes a drag
const SNAP_MIN = 15; // minutes

/**
 * Pointer-driven drag-to-reschedule for time-grid calendar views (Week/Day).
 *
 * Attach `onEventPointerDown(e, ev)` to each event block (no `onClick` — this
 * hook fires `onSelect` on a tap that didn't move, and `onReschedule` on a
 * real drag). Vertical movement changes the time (snapped to 15 min). For
 * Week view, pass `resolveDayFromPoint` to also let horizontal movement move
 * the event to another day column.
 *
 * Only `interview` events are reschedulable; other kinds (reminders) still get
 * tap-to-select but never move. Works with touch (Pointer Events).
 */
export function useDragReschedule(opts: {
  hourHeight: number;
  resolveDayFromPoint?: (x: number, y: number) => Date | null;
  onReschedule: (ev: CalEvent, newStartIso: string) => void;
  onSelect: (id: string) => void;
  /** When false, blocks tap-to-select only (no reschedule). Default true. */
  enabled?: boolean;
}) {
  const { hourHeight, resolveDayFromPoint, onReschedule, onSelect, enabled = true } = opts;
  const canDrag = useCallback((ev: CalEvent) => enabled && ev.kind === 'interview', [enabled]);

  const [preview, setPreview] = useState<DragPreview | null>(null);
  const stateRef = useRef<DragState | null>(null);
  const evRef = useRef<CalEvent | null>(null);

  const snapMin = useCallback(
    (dyPx: number) => Math.round(((dyPx / hourHeight) * 60) / SNAP_MIN) * SNAP_MIN,
    [hourHeight],
  );

  const computeNewStart = useCallback(
    (st: DragState, x: number, y: number): Date => {
      const dMin = snapMin(y - st.startY);
      let d = new Date(st.origStart + dMin * 60_000);
      const day = resolveDayFromPoint?.(x, y);
      if (day) {
        const nd = new Date(d);
        nd.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
        d = nd;
      }
      return d;
    },
    [snapMin, resolveDayFromPoint],
  );

  const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const onMove = useCallback(
    (e: PointerEvent) => {
      const st = stateRef.current;
      const ev = evRef.current;
      if (!st || !ev) return;
      st.curX = e.clientX;
      st.curY = e.clientY;
      if (
        Math.abs(e.clientX - st.startX) > MOVE_THRESHOLD ||
        Math.abs(e.clientY - st.startY) > MOVE_THRESHOLD
      ) {
        st.moved = true;
      }
      // Only draggable interviews show a live ghost / reschedule.
      if (!st.moved || !canDrag(ev)) return;
      e.preventDefault();
      const newStart = computeNewStart(st, e.clientX, e.clientY);
      const offsetPx = (snapMin(e.clientY - st.startY) / 60) * hourHeight;
      setPreview({ id: st.id, offsetPx, newStart, label: fmtTime(newStart) });
    },
    [computeNewStart, snapMin, hourHeight, canDrag],
  );

  const onUp = useCallback(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const st = stateRef.current;
    const ev = evRef.current;
    stateRef.current = null;
    evRef.current = null;
    setPreview(null);
    if (!st || !ev) return;
    // A tap (no real movement) or a non-draggable kind → just select.
    if (!st.moved || !canDrag(ev)) {
      onSelect(ev.id);
      return;
    }
    const newStart = computeNewStart(st, st.curX, st.curY);
    if (Math.abs(newStart.getTime() - st.origStart) < 60_000) return; // no real change
    onReschedule(ev, newStart.toISOString());
  }, [onMove, computeNewStart, onReschedule, onSelect, canDrag]);

  const onEventPointerDown = useCallback(
    (e: React.PointerEvent, ev: CalEvent) => {
      // Left button / touch / pen only.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      stateRef.current = {
        id: ev.id,
        origStart: new Date(ev.start).getTime(),
        startX: e.clientX,
        startY: e.clientY,
        curX: e.clientX,
        curY: e.clientY,
        moved: false,
      };
      evRef.current = ev;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [onMove, onUp],
  );

  /** True while this event id is being dragged (for styling/offset). */
  const isDragging = (id: string) => preview?.id === id;

  return { preview, isDragging, onEventPointerDown };
}
