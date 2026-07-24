import { Button } from '../Button';
import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import { Popover } from '../ui/Popover';
import type { TabKey } from './types';

export type JobSortKey = 'match' | 'recent' | 'comp';

const SORT_LABEL: Record<JobSortKey, string> = {
  match: 'Best match',
  recent: 'Most recent',
  comp: 'Highest comp',
};

const TABS: { key: TabKey; label: string }[] = [
  { key: 'recommended', label: 'Top' },
  { key: 'liked', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
];

const SORT_KEYS: JobSortKey[] = ['match', 'recent', 'comp'];

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function JobTabsBar({
  tab,
  counts,
  onTab,
  sort,
  onSort,
}: {
  tab: TabKey;
  counts?: Partial<Record<TabKey, number>>;
  onTab: (t: TabKey) => void;
  sort: JobSortKey;
  onSort: (s: JobSortKey) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      {/* Left: tab selector */}
      <ButtonGroup>
        {TABS.map(({ key, label }) => (
          <ButtonGroupItem key={key} pressed={tab === key} onClick={() => onTab(key)}>
            {label}
            {counts?.[key] != null && (
              <span className="ml-1.5 text-[10px] font-mono tabular-nums text-muted">
                {counts[key]}
              </span>
            )}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>

      {/* Right: sort popover */}
      <Popover
        align="right"
        button={(open) => (
          <Button variant="ghost" size="sm" rightIcon={<ChevronDownIcon open={open} />}>
            {`Sort: ${SORT_LABEL[sort]}`}
          </Button>
        )}
      >
        {(close) => (
          <div className="flex flex-col">
            {SORT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onSort(key);
                  close();
                }}
                className={[
                  'w-full text-left px-2 py-1.5 rounded-md text-[13px] hover:bg-hover',
                  sort === key ? 'text-accent font-medium' : 'text-ink',
                ].join(' ')}
              >
                {SORT_LABEL[key]}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}
