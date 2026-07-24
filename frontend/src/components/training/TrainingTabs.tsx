import clsx from 'clsx';
import { TRAINING_TABS, type TrainingTab } from './types';

/**
 * Underlined tab nav for the training workspace. Right-aligned hours-logged
 * lives on the same row (mono), so the eye gets nav + a quick "how much have I
 * done" signal together.
 */
export function TrainingTabs({
  active,
  onTab,
  hoursLogged,
}: {
  active: TrainingTab;
  onTab: (t: TrainingTab) => void;
  hoursLogged?: number | null;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border mb-5">
      <nav className="flex items-center gap-1 -mb-px" role="tablist">
        {TRAINING_TABS.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => onTab(t.key)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                on
                  ? 'border-accent text-ink'
                  : 'border-transparent text-muted hover:text-ink hover:border-border',
              )}
            >
              {t.sparkle && (
                <span aria-hidden="true" className={on ? 'text-accent' : 'text-muted'}>
                  ✦
                </span>
              )}
              {t.label}
            </button>
          );
        })}
      </nav>
      {hoursLogged != null && (
        <span className="ml-auto text-[12px] font-mono text-muted">
          {hoursLogged.toFixed(1)}h logged
        </span>
      )}
    </div>
  );
}
