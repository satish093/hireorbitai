import clsx from 'clsx';
import type { SegmentKey } from './types';
import type { Segment } from './useUserSegments';

/**
 * Horizontal pill ribbon of saved segments. The active one is ink-filled; the
 * rest are outlined. Each carries an inline count badge. Selecting a segment is
 * the parent's job (it pushes `?segment=` and refetches server-side).
 */
export function UserSegments({
  segments,
  active,
  onSelect,
}: {
  segments: Segment[];
  active: SegmentKey;
  onSelect: (key: SegmentKey) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-4"
      role="tablist"
      aria-label="User segments"
    >
      {segments.map((s) => {
        const on = s.key === active;
        return (
          <button
            key={s.key}
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(s.key)}
            className={clsx(
              'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium border transition-colors press',
              on
                ? 'bg-ink text-bg border-ink'
                : 'bg-surface text-ink-2 border-border hover:bg-hover',
            )}
          >
            {s.label}
            <span
              className={clsx(
                'tabular-nums text-[11px] rounded-full px-1.5 min-w-[1.25rem] text-center',
                on ? 'bg-bg/20 text-bg' : 'bg-hover text-muted',
              )}
            >
              {s.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
