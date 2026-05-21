import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Pill, PillTone } from './Pill';

// Tones for each known status string. Falls back to a neutral slate tone when
// the backend ships a status we don't know about yet.
const tone: Record<string, PillTone> = {
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

const DEFAULT_TONE: PillTone = {
  bg: 'bg-hover',
  text: 'text-ink',
  dot: 'bg-muted',
};

// Statuses that benefit from a slow ambient pulse on the dot (active states
// the user wants to *notice*).
const PULSING = new Set(['SCHEDULED', 'INTERVIEW', 'PENDING', 'SCREENING', 'ACTIVE']);

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
  const t = tone[status] ?? DEFAULT_TONE;
  return (
    <Pill tone={t} pulseDot={PULSING.has(status)} className={clsx(pop && 'animate-pop')}>
      {status.replace(/_/g, ' ')}
    </Pill>
  );
}
