import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { useInvalidationListener } from '../../hooks/useInvalidate';
import { Role } from '../../types';
import type { UserFilters } from './UserFilterBar';
import {
  type ColumnKey,
  DEFAULT_COLUMNS,
  type GroupLite,
  type LastSeenFilter,
  type ListResponse,
  type SegmentKey,
  type UserKpi,
} from './types';

const COLS_KEY = 'ho-admin-cols';

/** Column visibility, persisted to localStorage. */
export function useColumnPrefs() {
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(() => {
    try {
      const r = localStorage.getItem(COLS_KEY);
      if (r) return { ...DEFAULT_COLUMNS, ...JSON.parse(r) };
    } catch {
      /* ignore */
    }
    return DEFAULT_COLUMNS;
  });
  const toggleColumn = useCallback(
    (k: ColumnKey) =>
      setColumns((c) => {
        const n = { ...c, [k]: !c[k] };
        try {
          localStorage.setItem(COLS_KEY, JSON.stringify(n));
        } catch {
          /* ignore */
        }
        return n;
      }),
    [],
  );
  return { columns, toggleColumn };
}

/**
 * Owns all data + URL state for the admin Users surface: server-paginated
 * list, KPI/segment counts, and the groups lookup. Filters/segment/sort/page
 * live in the URL so the page is shareable; `q` is debounced into it.
 */
export function useAdminUsers() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const role = (params.get('role') as Role | '') || '';
  const group_id = params.get('group_id') ?? '';
  const last_seen = (params.get('last_seen') as LastSeenFilter) || '';
  const segment = (params.get('segment') as SegmentKey) || 'all';
  const sort = params.get('sort') ?? 'created_at';
  const order = (params.get('order') as 'asc' | 'desc') || 'desc';
  const page = Number(params.get('page') ?? 1);

  // Debounce search into the URL so we don't fetch per keystroke.
  const [qInput, setQInput] = useState(q);
  useEffect(() => setQInput(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if ((next.get('q') ?? '') === qInput) return prev;
          if (qInput) next.set('q', qInput);
          else next.delete('q');
          next.set('page', '1');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, setParams]);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.set('page', '1');
        return next;
      });
    },
    [setParams],
  );

  const setFilter = useCallback(
    (patch: Partial<UserFilters>) => {
      if ('q' in patch) setQInput(patch.q ?? '');
      if ('role' in patch) setParam('role', patch.role || null);
      if ('group_id' in patch) setParam('group_id', patch.group_id || null);
      if ('last_seen' in patch) setParam('last_seen', patch.last_seen || null);
    },
    [setParam],
  );

  const setSegment = useCallback(
    (s: SegmentKey) => setParam('segment', s === 'all' ? null : s),
    [setParam],
  );
  const setSort = useCallback(
    (key: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        const curSort = next.get('sort') ?? 'created_at';
        const curOrder = next.get('order') ?? 'desc';
        if (curSort === key) next.set('order', curOrder === 'asc' ? 'desc' : 'asc');
        else {
          next.set('sort', key);
          next.set('order', 'asc');
        }
        return next;
      }),
    [setParams],
  );
  const setPage = useCallback((p: number) => setParam('page', String(p)), [setParam]);
  const resetFilters = useCallback(() => {
    setQInput('');
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      ['q', 'role', 'group_id', 'last_seen'].forEach((k) => next.delete(k));
      next.set('page', '1');
      return next;
    });
  }, [setParams]);

  const [data, setData] = useState<ListResponse | null>(null);
  const [kpi, setKpi] = useState<UserKpi | null>(null);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);
  useInvalidationListener('users', reload);

  useEffect(() => {
    api
      .get<GroupLite[]>('/user-groups')
      .then((r) => setGroups(r.data ?? []))
      .catch(() => {});
  }, []);

  const queryString = useMemo(() => {
    const p: Record<string, string> = { page: String(page), page_size: '50', sort, order };
    if (q) p.q = q;
    if (role) p.role = role;
    if (group_id) p.group_id = group_id;
    if (last_seen) p.last_seen = last_seen;
    if (segment !== 'all') p.segment = segment;
    return p;
  }, [q, role, group_id, last_seen, segment, sort, order, page]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    api
      .get<ListResponse>('/admin/users', { params: queryString, signal: ctl.signal })
      .then((r) => setData(r.data))
      .catch((e) => {
        if (e?.code === 'ERR_CANCELED') return;
        toast.error(e?.response?.data?.error ?? 'Failed to load users');
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [queryString, reloadTick]);

  // KPI/segment counts are global — refetch only on mount + after mutations.
  useEffect(() => {
    api
      .get<UserKpi>('/admin/users/kpi')
      .then((r) => setKpi(r.data))
      .catch(() => {});
  }, [reloadTick]);

  return {
    data,
    kpi,
    groups,
    loading,
    qInput,
    filters: { q, role, group_id, last_seen } as UserFilters,
    segment,
    sort,
    order,
    page,
    setFilter,
    setSegment,
    setSort,
    setPage,
    resetFilters,
    reload,
  };
}
