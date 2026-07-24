import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { config as appConfig } from '../config/env';
import { clearSession, getSession, isAccessTokenStale, setSession } from './session';

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
// State-changing methods (POST/PATCH/PUT/DELETE) are never deduped.
// ---------------------------------------------------------------------------
const inflightGets = new Map<string, Promise<AxiosResponse>>();

function dedupKey(cfg: InternalAxiosRequestConfig): string {
  const params = cfg.params
    ? JSON.stringify(Object.entries(cfg.params).sort(([a], [b]) => a.localeCompare(b)))
    : '';
  return `${(cfg.method ?? 'get').toUpperCase()} ${cfg.url ?? ''} ${params}`;
}

// ---------------------------------------------------------------------------
// 429 cooldown
//
// When the backend rate-limits us, we MUST stop hammering it. The browser-side
// pollers (Sidebar / Messages) used to keep firing at their normal cadence
// after a 429, which meant a single rate-limit hit kept the bucket pegged for
// the full window. Now: when a request comes back 429, we honour the
// Retry-After header and short-circuit subsequent requests to the same URL
// with a synthesized 429 (no network call) until the cooldown expires.
//
// Synthesized errors look like real Axios errors so existing `.catch()` paths
// keep working without code changes.
// ---------------------------------------------------------------------------
const cooldownUntil = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 60_000;

function urlKey(url: string | undefined): string {
  if (!url) return '';
  // Drop query string — cooldown is path-scoped. Two different ?status= calls
  // hitting the same /reminders endpoint share a cooldown.
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

function setCooldown(url: string | undefined, seconds: number | undefined): void {
  const ms = Math.min(
    MAX_COOLDOWN_MS,
    Math.max(
      1_000,
      Number.isFinite(seconds) && (seconds as number) > 0
        ? (seconds as number) * 1000
        : DEFAULT_COOLDOWN_MS,
    ),
  );
  const next = Date.now() + ms;
  const key = urlKey(url);
  const existing = cooldownUntil.get(key) ?? 0;
  // Only extend — never shorten. A rapid-fire burst of 429s with shrinking
  // Retry-After values must not collapse a long server-issued cooldown into
  // a short client-defaulted one.
  cooldownUntil.set(key, Math.max(existing, next));
}

function getCooldownRemainingMs(url: string | undefined): number {
  const until = cooldownUntil.get(urlKey(url));
  if (!until) return 0;
  const rem = until - Date.now();
  if (rem <= 0) {
    cooldownUntil.delete(urlKey(url));
    return 0;
  }
  return rem;
}

// Marker on synthetic (client-side cooldown) 429s so the response interceptor
// can skip the re-arm path — otherwise every suppressed request would
// repeatedly stomp the cooldown timestamp with a new (often shorter) one.
const SYNTHETIC_429 = Symbol('hireorbitai:synthetic-429');

function makeRateLimitedError(cfg: InternalAxiosRequestConfig, retryAfterSec: number): AxiosError {
  const err = new AxiosError(
    'Rate-limit cooldown active (client-side); request suppressed.',
    'ERR_RATE_LIMITED',
    cfg,
    null,
    {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'retry-after': String(retryAfterSec) },
      config: cfg,
      data: { error: 'Rate-limit cooldown active', retry_after_seconds: retryAfterSec },
    } as unknown as AxiosResponse,
  );
  (err as unknown as Record<symbol, unknown>)[SYNTHETIC_429] = true;
  return err;
}

/** Public helper — lets callers (e.g. pollers) check whether an endpoint is cooling down. */
export function isEndpointCooling(url: string): boolean {
  return getCooldownRemainingMs(url) > 0;
}

// ---------------------------------------------------------------------------
// Silent refresh
//
// When the stored access token is within REFRESH_SKEW_SEC of expiry, the
// request interceptor proactively trades the refresh token for a fresh pair
// before sending the request. Concurrent requests share a single refresh
// promise so we never fire two refreshes in parallel.
//
// Critical hardening: refresh failures DO NOT clearSession unless the server
// explicitly returned 401 (token actually rejected). On 429 / 5xx / network
// errors we keep the existing session — the original request will then hit
// the backend with the about-to-expire access token, which is almost always
// still valid for a few more seconds. If that request 401s, the response
// interceptor handles the logout exactly once.
// ---------------------------------------------------------------------------
let refreshing: Promise<void> | null = null;

async function refreshIfNeeded(): Promise<void> {
  const sess = getSession();
  if (!sess || !isAccessTokenStale(sess)) return;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const { data } = await axios.post(`${appConfig.apiBaseUrl}/auth/refresh`, {
          refresh_token: sess.refresh_token,
        });
        if (data?.access_token && data?.refresh_token) {
          setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
            user: sess.user,
          });
        }
        // Empty/garbage response — leave the existing session alone rather
        // than clearing it. Worst case the user hits a 401 on the next call
        // and the response interceptor signs them out cleanly.
      } catch (err) {
        // ONLY hard-clear the session on a definitive auth failure. Any other
        // error (429, 5xx, offline, timeout) means the refresh endpoint is
        // unreachable — logging the user out in that case is exactly the
        // cascade we're trying to stop.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          clearSession();
        }
      } finally {
        refreshing = null;
      }
    })();
  }
  await refreshing;
}

api.interceptors.request.use(async (cfg) => {
  // Short-circuit GETs that are currently rate-limit-cooling. We don't
  // suppress writes — the user explicitly took an action and deserves a real
  // server response (which may itself be 429 and re-arm the cooldown).
  const method = (cfg.method ?? 'get').toLowerCase();
  if (method === 'get') {
    const rem = getCooldownRemainingMs(cfg.url);
    if (rem > 0) {
      throw makeRateLimitedError(cfg, Math.ceil(rem / 1000));
    }
  }
  await refreshIfNeeded();
  const sess = getSession();
  if (sess) {
    cfg.headers = cfg.headers ?? {};
    cfg.headers.Authorization = `Bearer ${sess.access_token}`;
  }
  return cfg;
});

// Debounced redirect to /login. Multiple in-flight 401s would otherwise race
// to call location.replace and the intermediate state flashes oddly. Cap at
// one redirect per 2 seconds.
let lastBootToLogin = 0;

function bootToLogin() {
  // Debounce: at most one redirect per 2s. Multiple in-flight 401s otherwise
  // race to call location.replace, which the browser handles fine but the
  // intermediate state can cause odd flashes.
  const now = Date.now();
  if (now - lastBootToLogin < 2_000) return;
  lastBootToLogin = now;
  clearSession();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
}

// Response interceptor — handles 401 (boot to login), 423 (locked → /login),
// and 429 (record cooldown so subsequent calls don't hammer the backend).
api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const status = error?.response?.status;
    const cfg = error?.config as InternalAxiosRequestConfig | undefined;
    const path = cfg?.url ?? '';
    const isAuthRoute = path.includes('/auth/');
    const isSynthetic = !!(error as unknown as Record<symbol, unknown>)[SYNTHETIC_429];

    // Real server 429: arm the client cooldown so subsequent requests to the
    // same endpoint short-circuit. Synthetic (already-cooled) 429s skip this
    // path — re-arming would otherwise let a shorter new Retry-After
    // overwrite the existing longer cooldown.
    if (status === 429 && !isSynthetic) {
      const raw = error.response?.headers?.['retry-after'];
      const sec = raw ? Number(raw) : DEFAULT_COOLDOWN_MS / 1000;
      setCooldown(path, sec);
    }

    if (!isAuthRoute && (status === 401 || status === 423)) {
      bootToLogin();
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
  const key = dedupKey({ method: 'get', url, params: cfg?.params } as InternalAxiosRequestConfig);
  const existing = inflightGets.get(key);
  if (existing) {
    return existing as unknown as Promise<R>;
  }
  const promise = originalGet<T, R, D>(url, cfg).finally(() => {
    inflightGets.delete(key);
  });
  inflightGets.set(key, promise as unknown as Promise<AxiosResponse>);
  return promise;
} as typeof api.get;
