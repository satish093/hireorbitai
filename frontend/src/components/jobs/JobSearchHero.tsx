import React from 'react';
import { Button } from '../Button';
import { IconSparkles } from '../Icons';

export function JobSearchHero({
  totalScored,
  aboveThreshold,
  totalRows,
  query,
  onQueryChange,
  onSubmitQuery,
  searchRef,
  onOpenFilters,
  rightSlot,
}: {
  totalScored?: number | null;
  aboveThreshold?: number | null;
  totalRows?: number | null;
  query: string;
  onQueryChange: (s: string) => void;
  onSubmitQuery: () => void;
  searchRef?: React.RefObject<HTMLInputElement>;
  onOpenFilters?: () => void;
  rightSlot?: React.ReactNode;
}): JSX.Element {
  let counterLine: string | null = null;
  if (totalScored != null) {
    counterLine =
      `${totalScored} scored today` +
      (aboveThreshold != null ? ` · ${aboveThreshold} above 85%` : '');
  } else if (totalRows != null) {
    counterLine = `${totalRows.toLocaleString()} live openings`;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 min-h-[60px]">
      {/* LEFT: title + counter */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Jobs</h1>
        {counterLine != null && <p className="text-[12px] text-muted">{counterLine}</p>}
      </div>

      {/* RIGHT: AI search + filters + rightSlot */}
      <div className="flex items-center gap-2">
        {/* AI search field */}
        <div className="relative flex items-center h-9 w-[300px] max-w-[60vw] rounded-lg border border-border-strong bg-surface pl-9 pr-16">
          {/* Sparkle badge */}
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md bg-brand-grad text-white grid place-items-center">
            <IconSparkles size={13} />
          </span>

          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Describe your ideal role…"
            className="w-full bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitQuery();
            }}
          />

          {/* Enter hint */}
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-faint border border-border rounded px-1">
            ↵
          </span>
        </div>

        {/* Filters button */}
        {onOpenFilters != null && (
          <Button variant="outline" size="sm" onClick={onOpenFilters}>
            Filters
          </Button>
        )}

        {rightSlot}
      </div>
    </div>
  );
}
