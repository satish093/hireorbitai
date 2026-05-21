import { ReactNode } from 'react';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Shared pill primitive used by every status / priority / due / tag badge in
// the app. All variants share the same height, radius, padding, font, and
// gap — only the tone (bg + text + optional dot color + optional border)
// varies. This replaces five near-identical inline pill recipes that were
// previously scattered across StatusBadge.tsx and TaskBits.tsx.
// ---------------------------------------------------------------------------

export interface PillTone {
  bg: string;
  text: string;
  /** Optional left-side dot — when omitted, the pill renders without one. */
  dot?: string;
  /** Optional 1px border — used by PriorityBadge for an extra outline. */
  border?: string;
}

export type PillSize = 'xs' | 'sm';

interface PillProps {
  tone: PillTone;
  size?: PillSize;
  /** Animate the dot with a slow pulse (active/scheduled/in-flight states). */
  pulseDot?: boolean;
  /** Slot before the label — usually a tiny icon. */
  leading?: ReactNode;
  className?: string;
  children: ReactNode;
}

const SIZE_CLASS: Record<PillSize, string> = {
  // Compact — used in dense tables and inline metadata rows. Matches the
  // existing tracked size across StatusBadge/PriorityBadge/TaskStatusBadge.
  xs: 'text-[11px] px-2 py-0.5',
  // Slightly larger for headers and main detail pages.
  sm: 'text-xs px-2.5 py-1',
};

export function Pill({ tone, size = 'xs', pulseDot, leading, className, children }: PillProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full font-medium tracking-tight whitespace-nowrap',
        SIZE_CLASS[size],
        tone.bg,
        tone.text,
        tone.border && `border ${tone.border}`,
        className,
      )}
    >
      {tone.dot && (
        <span
          aria-hidden="true"
          className={clsx(
            'w-1.5 h-1.5 rounded-full shrink-0',
            tone.dot,
            pulseDot && 'animate-pulse-soft',
          )}
        />
      )}
      {leading}
      {children}
    </span>
  );
}

// A "tag" variant — rectangular, monospace, uppercase. Same primitive,
// different shape; exported so TagPill stays one line in TaskBits.
export function TagPillBase({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-hover text-muted font-mono',
        className,
      )}
    >
      {children}
    </span>
  );
}
