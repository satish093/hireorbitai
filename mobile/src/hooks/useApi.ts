/**
 * The data-fetch workhorse. Every list and detail screen in the app uses one of
 * these three hooks, so loading, error, empty, refresh and invalidation
 * behaviour is identical everywhere instead of being re-hand-rolled 52 times.
 *
 *   useApiQuery   — GET one resource, with pull-to-refresh + channel invalidation
 *   useApiList    — the same, specialised for list endpoints (array or {data})
 *   useApiMutation — POST/PATCH/DELETE with pending state and error unwrapping
 *
 * Deliberately NOT react-query. The web client hand-rolls the same pattern with
 * raw axios, and matching it keeps the two codebases mentally identical — which
 * is the entire reason React Native was chosen. The pieces react-query would
 * have brought that actually matter here (in-flight dedup, 429 backoff) already
 * live in services/api.ts for both clients.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosRequestConfig } from 'axios';
import { api, apiErrorMessage } from '../services/api';
import { invalidate, useInvalidationListener, type InvalidationChannel } from './useInvalidate';

interface QueryOptions<T> {
  /** Refetch when this channel fires. */
  channel?: InvalidationChannel;
  /** Skip the request entirely (e.g. waiting on a route param). */
  enabled?: boolean;
  /** Query string params. Changing them refetches. */
  params?: Record<string, unknown>;
  /** Reshape the raw response body before it hits state. */
  select?: (raw: unknown) => T;
  /** Value exposed while loading and after an error. */
  initialData?: T;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: string | null;
  /** True on the FIRST load only — drives skeletons. */
  loading: boolean;
  /** True during a pull-to-refresh — drives the RefreshControl spinner. */
  refreshing: boolean;
  refetch: () => Promise<void>;
  /** Pull-to-refresh handler; pass straight to RefreshControl.onRefresh. */
  onRefresh: () => void;
  /** Local optimistic update without a server round-trip. */
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Params are compared by serialised value, not identity — screens pass object
 * literals, which are a new reference on every render and would otherwise
 * refetch in an infinite loop.
 */
function useStableParams(params: Record<string, unknown> | undefined): string {
  return JSON.stringify(params ?? {});
}

export function useApiQuery<T = unknown>(
  url: string | null,
  options: QueryOptions<T> = {},
): QueryResult<T> {
  const { channel, enabled = true, params, select, initialData } = options;

  const [data, setDataState] = useState<T | undefined>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url && enabled);
  const [refreshing, setRefreshing] = useState(false);

  const paramsKey = useStableParams(params);
  const selectRef = useRef(select);
  selectRef.current = select;

  // Guards a resolved response from a request the screen has moved on from.
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!url || !enabled) {
        setLoading(false);
        return;
      }
      const seq = ++requestSeq.current;
      if (mode === 'refresh') setRefreshing(true);

      try {
        const cfg: AxiosRequestConfig = {
          params: JSON.parse(paramsKey) as Record<string, unknown>,
        };
        const res = await api.get(url, cfg);
        if (!mounted.current || seq !== requestSeq.current) return;
        const raw = res.data;
        setDataState((selectRef.current ? selectRef.current(raw) : raw) as T);
        setError(null);
      } catch (err) {
        if (!mounted.current || seq !== requestSeq.current) return;
        // 401/423 already triggered a forced sign-out inside the interceptor;
        // showing "Unauthorized" under a screen that is about to unmount is
        // just noise.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status !== 401 && status !== 423) setError(apiErrorMessage(err));
      } finally {
        if (mounted.current && seq === requestSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [url, enabled, paramsKey],
  );

  useEffect(() => {
    if (url && enabled) setLoading(true);
    void run('initial');
  }, [run, url, enabled]);

  useInvalidationListener(channel ?? 'notifications', () => {
    if (channel) void run('refresh');
  });

  const refetch = useCallback(() => run('refresh'), [run]);
  const onRefresh = useCallback(() => {
    void run('refresh');
  }, [run]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) =>
      typeof updater === 'function' ? (updater as (p: T | undefined) => T)(prev) : updater,
    );
  }, []);

  return { data, error, loading, refreshing, refetch, onRefresh, setData };
}

/**
 * List variant.
 *
 * The backend is not fully consistent about list shapes — some endpoints return
 * a bare array, others `{ data: [...], count }` (the shim's `count: 'exact'`
 * path). Rather than make every screen care, normalise here.
 */
export function useApiList<T = unknown>(
  url: string | null,
  options: Omit<QueryOptions<T[]>, 'select' | 'initialData'> = {},
): QueryResult<T[]> & { items: T[] } {
  const result = useApiQuery<T[]>(url, {
    ...options,
    initialData: [],
    select: (raw) => {
      if (Array.isArray(raw)) return raw as T[];
      const envelope = raw as { data?: unknown; items?: unknown } | null;
      if (envelope && Array.isArray(envelope.data)) return envelope.data as T[];
      if (envelope && Array.isArray(envelope.items)) return envelope.items as T[];
      return [];
    },
  });
  return { ...result, items: result.data ?? [] };
}

type Method = 'post' | 'patch' | 'put' | 'delete';

export interface MutationResult<TBody, TResp> {
  mutate: (body?: TBody, urlOverride?: string) => Promise<TResp | null>;
  pending: boolean;
  error: string | null;
  reset: () => void;
}

export function useApiMutation<TBody = unknown, TResp = unknown>(
  method: Method,
  url: string,
  options: {
    /** Channels to invalidate after a successful call. */
    invalidates?: InvalidationChannel[];
    onSuccess?: (data: TResp) => void;
  } = {},
): MutationResult<TBody, TResp> {
  const { invalidates, onSuccess } = options;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionsRef = useRef({ invalidates, onSuccess });
  optionsRef.current = { invalidates, onSuccess };

  const mutate = useCallback(
    async (body?: TBody, urlOverride?: string): Promise<TResp | null> => {
      setPending(true);
      setError(null);
      const target = urlOverride ?? url;
      try {
        const res =
          method === 'delete'
            ? await api.delete<TResp>(target, { data: body })
            : await api[method]<TResp>(target, body ?? {});
        const { invalidates: channels, onSuccess: cb } = optionsRef.current;
        // The dependency is one-directional — useInvalidate imports nothing
        // from here — so a plain static import is safe.
        if (channels?.length) for (const c of channels) invalidate(c);
        cb?.(res.data);
        return res.data;
      } catch (err) {
        setError(apiErrorMessage(err));
        return null;
      } finally {
        setPending(false);
      }
    },
    [method, url],
  );

  const reset = useCallback(() => setError(null), []);

  return { mutate, pending, error, reset };
}
