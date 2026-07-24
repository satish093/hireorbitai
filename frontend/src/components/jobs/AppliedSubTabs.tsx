import clsx from 'clsx';
import { APPLIED_SUB_TABS, matchSubTab } from './types';
import type { AppliedSubTab, JobRow } from './types';

export function AppliedSubTabs({
  rows,
  active,
  onChange,
}: {
  rows: JobRow[];
  active: AppliedSubTab;
  onChange: (k: AppliedSubTab) => void;
}) {
  // Bucket once.
  const counts: Record<AppliedSubTab, number> = {
    applied: 0,
    interviewing: 0,
    offer: 0,
    rejected: 0,
    archived: 0,
  };
  for (const r of rows) counts[matchSubTab(r.application_status ?? 'SUBMITTED')]++;
  return (
    <div className="border-b border-border mb-5 flex items-center gap-4 flex-wrap">
      {APPLIED_SUB_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'pb-2 text-sm flex items-center gap-1.5 border-b-2 transition -mb-px',
            active === t.key
              ? 'border-ink text-ink font-semibold'
              : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          <span
            className={clsx(
              'text-[10px] font-semibold tabular-nums rounded-full px-1.5 py-0.5',
              active === t.key ? 'bg-ink text-bg' : 'bg-hover text-muted',
            )}
          >
            {counts[t.key]}
          </span>
        </button>
      ))}
    </div>
  );
}
