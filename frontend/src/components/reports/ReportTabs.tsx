import clsx from 'clsx';
import { useReportContext } from './ReportContext';
import { REPORT_TABS, type ReportTab } from './types';

/** Underline-style tab nav with a right-aligned mono echo of the date range. */
export function ReportTabs({ tab, onTab }: { tab: ReportTab; onTab: (t: ReportTab) => void }) {
  const { resolved } = useReportContext();
  return (
    <div className="flex items-end justify-between gap-4 border-b border-border overflow-x-auto">
      <div className="flex items-end gap-5">
        {REPORT_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTab(t.key)}
            className={clsx(
              'relative pb-2.5 -mb-px text-sm whitespace-nowrap transition-colors focus:outline-none focus-visible:text-ink',
              tab === t.key ? 'text-ink font-semibold' : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
            <span
              aria-hidden
              className={clsx(
                'absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-ink origin-center transition-transform duration-200 ease-out',
                tab === t.key ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </button>
        ))}
      </div>
      <span className="hidden sm:block shrink-0 pb-2.5 text-[11px] font-mono text-faint">
        {resolved.label}
      </span>
    </div>
  );
}
