import { Button } from '../Button';
import { TONE_STYLES, type CalEvent } from './types';

// ---------------------------------------------------------------------------
// Helper: format "Tue 2:00 – 3:00 PM" from an ISO start + duration in minutes
// ---------------------------------------------------------------------------

function fmtRange(startIso: string, durationMin: number): string {
  try {
    const start = new Date(startIso);
    if (isNaN(start.getTime())) return '';

    const end = new Date(start.getTime() + durationMin * 60_000);

    const weekday = start.toLocaleDateString('en-US', { weekday: 'short' }); // "Tue"

    // Build start time parts
    const startH = start.getHours();
    const startM = start.getMinutes();
    const endH = end.getHours();
    const endM = end.getMinutes();

    const endSuffix = endH < 12 ? 'AM' : 'PM';
    const startSuffix = startH < 12 ? 'AM' : 'PM';

    const fmt12 = (h: number, m: number) => {
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const mm = m === 0 ? '00' : String(m).padStart(2, '0');
      return `${h12}:${mm}`;
    };

    // Show AM/PM on start only when it differs from end's suffix
    const startStr =
      startSuffix === endSuffix ? fmt12(startH, startM) : `${fmt12(startH, startM)} ${startSuffix}`;
    const endStr = `${fmt12(endH, endM)} ${endSuffix}`;

    return `${weekday} ${startStr} – ${endStr}`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Close X SVG
// ---------------------------------------------------------------------------

const CloseIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
    <path
      d="M11 3L7 7m0 0L3 11m4-4L3 3m4 4l4 4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ---------------------------------------------------------------------------
// EventDetailBar
// ---------------------------------------------------------------------------

export function EventDetailBar({
  event,
  onClose,
  onBrief,
  onFeedback,
}: {
  event: CalEvent;
  onClose: () => void;
  onBrief?: () => void;
  onFeedback?: () => void;
}): JSX.Element {
  const toneStyles = TONE_STYLES[event.tone];

  const timeRange = fmtRange(event.start, event.durationMin);
  const metaLine = [timeRange, event.attendee ? event.attendee : null].filter(Boolean).join(' · ');

  const showFeedback = event.kind === 'interview' && typeof onFeedback === 'function';
  const showBrief = event.kind === 'interview' && typeof onBrief === 'function';
  const showMatch = event.kind === 'interview' && typeof event.matchScore === 'number';
  const showJoin = Boolean(event.meetingUrl);

  return (
    <div className="border-t border-border bg-bg-elev animate-fade-in-up">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Left tone bar */}
        <div className={`w-1 self-stretch rounded-full ${toneStyles.bar}`} aria-hidden="true" />

        {/* Title + meta column */}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink truncate leading-snug">{event.title}</p>
          {metaLine && <p className="text-[12px] text-muted leading-snug mt-0.5">{metaLine}</p>}
        </div>

        {/* Match score badge */}
        {showMatch && (
          <span className="text-[11px] font-mono font-semibold text-success bg-success-soft rounded px-1.5 py-0.5 shrink-0">
            {event.matchScore}% MATCH
          </span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {showFeedback && (
            <Button variant="outline" size="sm" onClick={onFeedback}>
              Feedback
            </Button>
          )}

          {showBrief && (
            <Button variant="outline" size="sm" onClick={onBrief}>
              Brief
            </Button>
          )}

          {showJoin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(event.meetingUrl!, '_blank', 'noopener')}
            >
              Join Zoom
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Close"
            leftIcon={CloseIcon}
            onClick={onClose}
          />
        </div>
      </div>
    </div>
  );
}
