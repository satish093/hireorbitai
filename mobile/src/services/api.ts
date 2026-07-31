/**
 * HireOrbit AI — mobile API client.
 *
 * A direct port of frontend/src/services/api.ts. The backend is identical for
 * both clients, so the client-side protections it needs are identical too:
 *
 *   • in-flight GET dedup      — several screens mounting at once must not fire
 *                                N copies of the same request
 *   • 429 cooldown             — honour Retry-After, extend-only, never shorten
 *   • silent refresh           — rotate the token before it expires, and ONLY
 *                                clear the session on a definitive 401
 *
 * Three things are mobile-specific and have no web counterpart:
 *
 *   1. NO window.location.replace. A 401/423 emits an auth-failure event; the
 *      root layout subscribes and calls router.replace('/login'). Navigation
 *      belongs to the router, not to a service module.
 *
 *   2. RESUME REFRESH. A browser tab runs continuously, so refreshing 60s
 *      before expiry always fires in time. A phone app is SUSPENDED — it can
 *      resume hours after the token died. onAppResume() force-refreshes an
 *      already-expired token instead of firing a request guaranteed to 401.
 *
 *   3. Longer timeout. Mobile networks are slower and lossier than the office
 *      wifi the web app assumes.
 */

import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AppState, type AppStateStatus } from 'react-native';
import { config as appConfig } from '../config/env';
import {
  clearSession,
  flushSession,
  getSession,
  isAccessTokenExpired,
  isAccessTokenStale,
  setSession,
} from './session';

export const api = axios.create({
  baseURL: appConfig.apiBaseUrl,
  // 60s on web; mobile networks warrant more headroom before we give up.
  timeout: 90_000,
});

// ---------------------------------------------------------------------------
// Auth-failure channel
//
// The web client calls window.location.replace('/login') straight from the
// interceptor. There is no equivalent here, and reaching for the router from a
// service module would create an import cycle with the layout that mounts it.
// Instead we emit; app/_layout.tsx subscribes and navigates.
// ---------------------------------------------------------------------------
type AuthFailureReason = 'unauthorized' | 'locked';
type AuthFailureListener = (reason: AuthFailureReason) => void;

const authFailureListeners = new Set<AuthFailureListener>();

/** Subscribe to forced sign-out events (401 → login, 423 → lockout screen). */
export function onAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

// Debounce: several in-flight 401s would otherwise each fire a navigation.
let lastAuthFailureMs = 0;

function emitAuthFailure(reason: AuthFailureReason): void {
  const now = Date.now();
  if (now - lastAuthFailureMs < 2_000) return;
  lastAuthFailureMs = now;
  clearSession();
  for (const l of [...authFailureListeners]) {
    try {
      l(reason);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// In-flight GET dedup
// ---------------------------------------------------------------------------
const inflightGets = new Map<string, Promise<AxiosResponse>>();

function dedupKey(method: string, url: string, params: unknown): string {
  const p =
    params && typeof params === 'object'
      ? JSON.stringify(
          Object.entries(params as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : '';
  return `${method.toUpperCase()} ${url} ${p}`;
}

// ---------------------------------------------------------------------------
// 429 cooldown
// ---------------------------------------------------------------------------
const cooldownUntil = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 60_000;

function urlKey(url: string | undefined): string {
  if (!url) return '';
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
  const key = urlKey(url);
  const existing = cooldownUntil.get(key) ?? 0;
  // Extend only. A burst of 429s with shrinking Retry-After values must not
  // collapse a long server-issued cooldown into a short client-defaulted one.
  cooldownUntil.set(key, Math.max(existing, Date.now() + ms));
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

/** Lets pollers check whether an endpoint is cooling down before firing. */
export function isEndpointCooling(url: string): boolean {
  return getCooldownRemainingMs(url) > 0;
}

// Marker on client-side synthesized 429s so the response interceptor skips the
// re-arm path — otherwise each suppressed request would stomp the cooldown
// with a new, often shorter, value.
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

// ---------------------------------------------------------------------------
// Silent refresh
// ---------------------------------------------------------------------------
let refreshing: Promise<void> | null = null;

/**
 * Trade the refresh token for a fresh pair.
 *
 * `force` skips the staleness check — used by the resume path, where the token
 * is already expired and "is it stale?" is moot.
 *
 * Uses a BARE axios call, not `api`, so it cannot recurse through this
 * interceptor.
 */
async function refreshIfNeeded(force = false): Promise<void> {
  const sess = getSession();
  if (!sess) return;
  if (!force && !isAccessTokenStale(sess)) return;

  if (!refreshing) {
    refreshing = (async () => {
      try {
        const { data } = await axios.post(
          `${appConfig.apiBaseUrl}/auth/refresh`,
          { refresh_token: sess.refresh_token },
          { timeout: 30_000 },
        );
        if (data?.access_token && data?.refresh_token) {
          setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
            user: sess.user,
          });
          // Durably persist the ROTATED token before proceeding. The backend
          // deletes the old refresh token on rotation, so a kill in the
          // fire-and-forget write window would otherwise leave the Keychain
          // holding a dead token → next cold start 401s → wrongful sign-out.
          await flushSession();
        }
        // Empty/garbage response — leave the session alone. Worst case the next
        // call 401s and the response interceptor signs the user out cleanly.
      } catch (err) {
        // ONLY hard-clear on a definitive auth failure. Any other error (429,
        // 5xx, offline, timeout — all far more common on mobile) means the
        // endpoint is unreachable; signing the user out there is exactly the
        // cascade this guard exists to prevent.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401) emitAuthFailure('unauthorized');
      } finally {
        refreshing = null;
      }
    })();
  }
  await refreshing;
}

// ---------------------------------------------------------------------------
// Resume handling
// ---------------------------------------------------------------------------
let appStateSub: { remove: () => void } | null = null;

/**
 * Refresh an expired token when the app returns to the foreground.
 *
 * Mounted once from app/_layout.tsx. Without it, every screen's first fetch
 * after a resume fires with a dead token, 401s, and boots the user to login —
 * which reads as "the app logged me out overnight".
 */
export function startResumeRefresh(): () => void {
  if (appStateSub) return () => {};
  const handler = (state: AppStateStatus) => {
    if (state !== 'active') return;
    const sess = getSession();
    if (!sess) return;
    if (isAccessTokenExpired(sess) || isAccessTokenStale(sess)) {
      void refreshIfNeeded(true);
    }
  };
  appStateSub = AppState.addEventListener('change', handler);
  return () => {
    appStateSub?.remove();
    appStateSub = null;
  };
}

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------
api.interceptors.request.use(async (cfg) => {
  const method = (cfg.method ?? 'get').toLowerCase();
  // Suppress cooling GETs only. A write is a deliberate user action and
  // deserves a real server response — which may itself be a 429 that re-arms.
  if (method === 'get') {
    const rem = getCooldownRemainingMs(cfg.url);
    if (rem > 0) throw makeRateLimitedError(cfg, Math.ceil(rem / 1000));
  }
  await refreshIfNeeded();
  const sess = getSession();
  if (sess) {
    cfg.headers = cfg.headers ?? {};
    cfg.headers.Authorization = `Bearer ${sess.access_token}`;
  }
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const status = error?.response?.status;
    const cfg = error?.config as InternalAxiosRequestConfig | undefined;
    const path = cfg?.url ?? '';
    const isAuthRoute = path.includes('/auth/');
    const isSynthetic = !!(error as unknown as Record<symbol, unknown>)[SYNTHETIC_429];

    if (status === 429 && !isSynthetic) {
      const raw = error.response?.headers?.['retry-after'];
      setCooldown(path, raw ? Number(raw) : DEFAULT_COOLDOWN_MS / 1000);
    }

    if (!isAuthRoute && (status === 401 || status === 423)) {
      emitAuthFailure(status === 423 ? 'locked' : 'unauthorized');
    }

    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// Deduped GET
// ---------------------------------------------------------------------------
const originalGet = api.get.bind(api);
api.get = function dedupedGet<T = unknown, R = AxiosResponse<T>, D = unknown>(
  url: string,
  cfg?: Parameters<typeof originalGet<T, R, D>>[1],
): Promise<R> {
  const key = dedupKey('get', url, cfg?.params);
  const existing = inflightGets.get(key);
  if (existing) return existing as unknown as Promise<R>;
  const promise = originalGet<T, R, D>(url, cfg).finally(() => {
    inflightGets.delete(key);
  });
  inflightGets.set(key, promise as unknown as Promise<AxiosResponse>);
  return promise;
} as typeof api.get;

// ---------------------------------------------------------------------------
// Error message helper
//
// The backend's error envelope is always `{ error, details? }` (see
// backend/src/middleware/errorHandler.ts). Every screen needs the same
// unwrapping, so it lives here once.
// ---------------------------------------------------------------------------
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const e = err as AxiosError<{ error?: string; details?: unknown }>;
  if (e?.code === 'ERR_RATE_LIMITED') return 'Slow down a moment and try again.';
  if (e?.code === 'ECONNABORTED') return 'The request timed out. Check your connection.';
  const serverMsg = e?.response?.data?.error;
  if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg;
  if (!e?.response) return 'Can’t reach the server. Check your connection.';
  return fallback;
}
