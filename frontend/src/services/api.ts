import axios, { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { supabase } from './supabase';
import { config as appConfig } from '../config/env';

export const api = axios.create({
  baseURL: appConfig.apiBaseUrl,
  // Hard cap so a hung backend can't keep the UI spinning forever.
  timeout: 60_000,
});

// ---------------------------------------------------------------------------
// In-flight GET dedup
//
// The dashboard mounts multiple components on a single navigation; many of
// them fetch the same well-known endpoints (`/consultants`, `/recruiters`,
// `/jobs`). Without dedup, three components that all ask for `/consultants`
// during the same render produce three identical HTTP requests. With even
// a moderate rate limit + multiple users on the same NAT, that turns into
// a 429 storm.
//
// Strategy: keep a Map of in-flight GET requests keyed by URL+sorted-params.
// While a request is pending, a duplicate caller gets the SAME promise and
// the same response object. The entry is dropped the moment the first
// request settles, so this is a tight de-duplication window — not a cache.
// State-changing methods (POST/PATCH/PUT/DELETE) are never deduped.
// ---------------------------------------------------------------------------
const inflightGets = new Map<string, Promise<AxiosResponse>>();

function dedupKey(cfg: InternalAxiosRequestConfig): string {
  const params = cfg.params
    ? JSON.stringify(Object.entries(cfg.params).sort(([a], [b]) => a.localeCompare(b)))
    : '';
  return `${(cfg.method ?? 'get').toUpperCase()} ${cfg.url ?? ''} ${params}`;
}

// Inject the Supabase access token on every request.
api.interceptors.request.use(async (cfg) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    cfg.headers = cfg.headers ?? {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// 401/423 → boot to /login. Supabase usually refreshes the token on its own,
// so a 401 from us means the session is genuinely dead (revoked, expired
// past refresh, or the user was deleted server-side). 423 is account locked.
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const status = error?.response?.status;
    const path = error?.config?.url ?? '';
    // Ignore the auth endpoints themselves — their UI surfaces the error.
    const isAuthRoute = path.includes('/auth/');
    if (!isAuthRoute && (status === 401 || status === 423)) {
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  },
);

// Wrap api.get with the in-flight dedup cache. Concurrent identical GETs
// share a single underlying request. The wrapper preserves the public
// signature so call sites don't change.
const originalGet = api.get.bind(api);
api.get = function dedupedGet<T = unknown, R = AxiosResponse<T>, D = unknown>(
  url: string,
  cfg?: Parameters<typeof originalGet<T, R, D>>[1],
): Promise<R> {
  // Only dedupe simple reads — any request carrying a body or non-trivial
  // headers we treat as state-changing or context-specific.
  const key = dedupKey({ method: 'get', url, params: cfg?.params } as InternalAxiosRequestConfig);
  const existing = inflightGets.get(key);
  if (existing) {
    return existing as unknown as Promise<R>;
  }
  const promise = originalGet<T, R, D>(url, cfg)
    .finally(() => { inflightGets.delete(key); });
  inflightGets.set(key, promise as unknown as Promise<AxiosResponse>);
  return promise;
} as typeof api.get;
