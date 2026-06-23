import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Pill, PillTone } from './Pill';

// Tone for each known status string. Exported as a standalone, importable map
// so any surface (mobile entity cards, KPI chips, custom inline chips) can reuse
// the exact same tone families WITHOUT rendering the full StatusBadge component.
// Falls back to a neutral slate tone when the backend ships an unknown status.
// Dark mode uses pale `/15` chip fills (never glowing pastels) per the handoff.
export const STATUS_TONES: Record<string, PillTone> = {
  ACTIVE: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  PAUSED: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  PLACED: {
    bg: 'bg-blue-50 dark:bg-blue-500/15',
    text: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  DEACTIVATED: {
    bg: 'bg-slate-100 dark:bg-slate-500/15',
    text: 'text-slate-600 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  SUBMITTED: { bg: 'bg-hover', text: 'text-ink', dot: 'bg-muted' },
  SCREENING: {
    bg: 'bg-sky-50 dark:bg-sky-500/15',
    text: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  INTERVIEW: {
    bg: 'bg-indigo-50 dark:bg-indigo-500/15',
    text: 'text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500',
  },
  OFFER: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  REJECTED: {
    bg: 'bg-red-50 dark:bg-red-500/15',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  WITHDRAWN: { bg: 'bg-hover', text: 'text-muted', dot: 'bg-muted' },
  SCHEDULED: {
    bg: 'bg-indigo-50 dark:bg-indigo-500/15',
    text: 'text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500',
  },
  COMPLETED: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  CANCELLED: {
    bg: 'bg-red-50 dark:bg-red-500/15',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  NO_SHOW: {
    bg: 'bg-red-50 dark:bg-red-500/15',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  SENT: {
    bg: 'bg-sky-50 dark:bg-sky-500/15',
    text: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  DONE: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  EXPIRED: {
    bg: 'bg-red-50 dark:bg-red-500/15',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  ACCEPTED: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  REVOKED: { bg: 'bg-hover', text: 'text-muted', dot: 'bg-muted' },
};

export const DEFAULT_STATUS_TONE: PillTone = {
  bg: 'bg-hover',
  text: 'text-ink',
  dot: 'bg-muted',
};

// Statuses that benefit from a slow ambient pulse on the dot (active states
// the user wants to *notice*).
export const STATUS_PULSING = new Set(['SCHEDULED', 'INTERVIEW', 'PENDING', 'SCREENING', 'ACTIVE']);

/**
 * Standalone, importable tone helper. Returns the {@link PillTone} for a status
 * string (or the neutral default for unknown statuses). Use this to colour a
 * bare dot, a custom chip, or any surface that needs the status palette without
 * the full StatusBadge chrome — the single source of truth for status colour.
 */
export function statusTone(status: string): PillTone {
  return STATUS_TONES[status] ?? DEFAULT_STATUS_TONE;
}

export function StatusBadge({ status }: { status: string }) {
  const prev = useRef(status);
  const [pop, setPop] = useState(false);

  // Trigger a small "pop" whenever the status string changes — gives the user
  // visual feedback after an inline status edit (e.g. on the Consultants page).
  useEffect(() => {
    if (prev.current !== status) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 220);
      prev.current = status;
      return () => clearTimeout(t);
    }
  }, [status]);

  if (!status) return <span className="text-muted text-xs italic">—</span>;
  return (
    <Pill
      tone={statusTone(status)}
      pulseDot={STATUS_PULSING.has(status)}
      className={clsx(pop && 'animate-pop')}
    >
      {status.replace(/_/g, ' ')}
    </Pill>
  );
}

// Semantic alias — the mobile + desktop "status chip" in the handoff IS the
// StatusBadge. Exported under the design-system name so call sites can import
// either name; both render identically and reuse the same tone map.
export const StatusChip = StatusBadge;
