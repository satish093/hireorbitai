import { createPortal } from 'react-dom';
import { TONE_STYLES, type CalEvent } from './types';

function fmtRange(startIso: string, durationMin: number): string {
  const start = new Date(startIso);
  if (isNaN(start.getTime())) return '';
  const end = new Date(start.getTime() + durationMin * 60_000);
  const day = start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const t = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${t(start)} – ${t(end)}`;
}

/**
 * Lightweight desktop hover preview for a calendar event. Rendered in a portal
 * and positioned just above/below the hovered block via its bounding rect, so
 * it never gets clipped by the scrolling grid. Pointer-events-none so it never
 * eats the underlying click/drag.
 */
export function EventHoverCard({ event, rect }: { event: CalEvent; rect: DOMRect }): JSX.Element {
  const tone = TONE_STYLES[event.tone];
  const margin = 8;
  const width = 240;
  // Prefer above the block; flip below if there isn't room.
  const above = rect.top > 160;
  const top = above ? rect.top - margin : rect.bottom + margin;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[70] animate-fade-in"
      style={{ top, left, width, transform: above ? 'translateY(-100%)' : undefined }}
    >
      <div className="rounded-xl border border-border bg-surface p-3 shadow-2xl ring-1 ring-slate-900/10">
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 h-3 w-1 shrink-0 rounded-full ${tone.bar}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">{event.title}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {fmtRange(event.start, event.durationMin)}
            </p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {event.attendee && (
            <span className="rounded bg-bg-sunken px-1.5 py-0.5 text-[11px] text-ink-2">
              {event.attendee}
            </span>
          )}
          {event.status && (
            <span className="rounded bg-bg-sunken px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted">
              {event.status}
            </span>
          )}
          {typeof event.matchScore === 'number' && (
            <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-mono font-semibold text-success">
              {event.matchScore}% match
            </span>
          )}
          {event.meetingUrl && (
            <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success">
              Video
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
