import { useCallback, useState } from 'react';

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface EntityListState<F extends Record<string, unknown>> {
  query: string;
  setQuery: (q: string) => void;
  filters: F;
  setFilter: <K extends keyof F>(key: K, value: F[K]) => void;
  resetFilters: () => void;
  sort: SortState;
  setSort: (key: string) => void;
}

/**
 * Shared search + filter + sort state consumed by both desktop (DataTable
 * toolbar) and mobile (entity cards + BottomSheet) views of the same page.
 * Pure state — no API calls. The consuming page passes the state into its
 * fetch logic (useMemo / useEffect deps).
 */
export function useEntityList<F extends Record<string, unknown>>(
  defaultFilters: F,
  defaultSort: SortState = { key: 'created_at', dir: 'desc' },
): EntityListState<F> {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<F>(defaultFilters);
  const [sort, setRawSort] = useState<SortState>(defaultSort);

  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(defaultFilters);
    setQuery('');
  }, [defaultFilters]);

  const setSort = useCallback((key: string) => {
    setRawSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }, []);

  return { query, setQuery, filters, setFilter, resetFilters, sort, setSort };
}
