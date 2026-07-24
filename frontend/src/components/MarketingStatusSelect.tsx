import clsx from 'clsx';
import { Popover } from './ui/Popover';

// Shared marketing-status vocabulary for the bench. Consultants and recruiters
// both use the same four states so the two directory pages stay in lockstep —
// edit the option/tone maps here and both surfaces update together.
export type MarketingStatus = 'ACTIVE' | 'PAUSED' | 'PLACED' | 'DEACTIVATED';

// Chip tone for the inline editor button. Dark mode uses pale `/15` fills per
// the design handoff. DEACTIVATED is a muted slate — visibly "switched off"
// without reading as an error (which red would imply).
const STATUS_TONE: Record<MarketingStatus, string> = {
  ACTIVE:
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 focus:ring-emerald-500/30',
  PAUSED:
    'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 focus:ring-amber-500/30',
  PLACED:
    'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30 focus:ring-blue-500/30',
  DEACTIVATED:
    'bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-500/30 focus:ring-slate-500/30',
};

export const MARKETING_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active', dot: 'bg-emerald-500' },
  { value: 'PAUSED', label: 'Paused', dot: 'bg-amber-400' },
  { value: 'PLACED', label: 'Placed', dot: 'bg-blue-500' },
  { value: 'DEACTIVATED', label: 'Deactivated', dot: 'bg-slate-400' },
] as const;

export const MARKETING_STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

/** Inline status editor — a pill that opens a popover of the four states. */
export function MarketingStatusSelect({
  value,
  onChange,
}: {
  value: MarketingStatus;
  onChange: (v: string) => void;
}) {
  // Fall back to ACTIVE for an unknown/undefined status so the chip always renders.
  const opt =
    MARKETING_STATUS_OPTIONS.find((o) => o.value === value) ?? MARKETING_STATUS_OPTIONS[0];
  const tone = STATUS_TONE[value] ?? STATUS_TONE.ACTIVE;
  return (
    <Popover
      align="left"
      button={(open) => (
        <button
          className={clsx(
            'inline-flex items-center gap-1.5 text-[11px] font-medium pl-2.5 pr-2 py-1 rounded-full border cursor-pointer focus:outline-none focus:ring-2 transition',
            tone,
          )}
        >
          {opt.label}
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={clsx('transition-transform', open && 'rotate-180')}
          >
            <path d="M1 1l4 4 4-4" />
          </svg>
        </button>
      )}
    >
      {(close) => (
        <div className="py-1 min-w-[120px]">
          {MARKETING_STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-ink hover:bg-hover transition cursor-pointer',
                o.value === value && 'bg-hover',
              )}
            >
              <span className={clsx('w-2 h-2 rounded-full shrink-0', o.dot)} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Status filter pills (desktop toolbar + mobile sheet). */
export function MarketingStatusPills({
  active,
  onChange,
}: {
  active: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {MARKETING_STATUS_FILTER_OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'h-8 px-3 rounded-full text-[13px] font-semibold border transition-colors',
            o.value === active
              ? 'bg-ink text-bg border-ink'
              : 'bg-surface text-ink-2 border-border hover:border-border-strong',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
