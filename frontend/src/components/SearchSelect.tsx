import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { FormInput } from './FormInput';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

export interface SearchSelectItem {
  value: string;
  label: string;
  /** Optional second line (e.g. company name) shown muted under the label. */
  sublabel?: string;
}

interface Props {
  label?: string;
  placeholder?: string;
  /** Currently selected value ('' = none). */
  value: string;
  /**
   * The selected item, so its row stays pinned + visible even when it's no
   * longer in the current (server-searched) result set.
   */
  selected?: SearchSelectItem | null;
  onSelect: (item: SearchSelectItem | null) => void;
  /**
   * Returns matching items for a query. May be sync (client-side filter over
   * an in-memory list) or async (server-backed search). Stale async results
   * are discarded.
   */
  search: (query: string) => Promise<SearchSelectItem[]> | SearchSelectItem[];
  /** Debounce before calling `search`. Default 300ms. */
  debounceMs?: number;
  emptyText?: string;
}

/**
 * Inline searchable picker: a search box plus a scrollable result list. The
 * chosen item is pinned to the top so it survives result-set changes. Mirrors
 * the markup/styling of the "Tailor with AI" job picker (TailorLauncher) so a
 * row of [search] [list] reads consistently across the app. Suited to lists
 * too large for a native <select> (e.g. thousands of jobs).
 */
export function SearchSelect({
  label,
  placeholder,
  value,
  selected,
  onSelect,
  search,
  debounceMs = 300,
  emptyText = 'No results found',
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchSelectItem[] | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    const t = setTimeout(() => {
      Promise.resolve(searchRef.current(query.trim()))
        .then((items) => !cancelled && setResults(items))
        .catch(() => !cancelled && setResults([]));
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, debounceMs]);

  // Pin the selected item, then any results that aren't the selected one.
  const rows = selected ? [selected, ...(results ?? []).filter((r) => r.value !== value)] : results;

  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-ink mb-1.5">{label}</span>}
      <FormInput
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {results === null && (
          <div className="p-3 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}
        {results !== null && (!rows || rows.length === 0) && (
          <EmptyState compact title={emptyText} description="Try a different search." />
        )}
        {results !== null &&
          rows?.map((item) => {
            const isSelected = item.value === value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onSelect(isSelected ? null : item)}
                className={clsx(
                  'w-full text-left px-3 py-2 transition flex items-center justify-between gap-2',
                  isSelected ? 'bg-accent-soft' : 'hover:bg-hover',
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm text-ink truncate">{item.label}</span>
                  {item.sublabel && (
                    <span className="block text-xs text-muted truncate">{item.sublabel}</span>
                  )}
                </span>
                {isSelected && <span className="text-accent text-xs shrink-0">✓</span>}
              </button>
            );
          })}
      </div>
    </label>
  );
}
