import clsx from 'clsx';
import { Button } from '../Button';
import { SOURCE_LABEL, SOURCE_TONE } from './sourceTokens';
import type { JobRow } from './types';

export function SourceBreakdown({
  rows,
  active,
  onClick,
}: {
  rows: JobRow[];
  active: string;
  onClick: (s: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.source) continue;
    counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const ordered = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-semibold tracking-widest text-muted uppercase">
        By source
      </span>
      {ordered.map(([source, n]) => (
        <Button
          key={source}
          variant="ghost"
          size="sm"
          pill
          onClick={() => onClick(source)}
          className={clsx(
            'border',
            active === source
              ? 'bg-ink text-bg border-ink hover:bg-ink'
              : (SOURCE_TONE[source] ?? 'bg-hover text-ink border-border') + ' hover:opacity-80',
          )}
        >
          <span className="font-medium">{SOURCE_LABEL[source] ?? source}</span>
          <span className="tabular-nums opacity-90 ml-1">{n}</span>
        </Button>
      ))}
      <span className="ml-auto text-xs text-muted tabular-nums">{rows.length} total</span>
    </div>
  );
}
