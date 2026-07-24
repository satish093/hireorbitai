/**
 * Auth state for the app.
 *
 * Port of frontend/src/context/AuthContext.tsx, including every guard that file
 * accumulated the hard way:
 *
 *   • a single in-flight /auth/me promise (several screens mounting at once
 *     used to fire N parallel profile loads)
 *   • /auth/sync attempted at most once per user id (a half-provisioned
 *     account otherwise turned into a /auth/me + /auth/sync storm)
 *   • a 5s floor between failed reload attempts
 *   • profile state is LEFT ALONE on 429/5xx/network so a transient blip
 *     doesn't look like a sign-out
 *   • an 8s cap on the bootstrap so a down backend can't pin the app on a
 *     loading screen forever
 *
 * Mobile-only addition: the bootstrap first awaits `hydrateSession()`, because
 * SecureStore is async where localStorage was not.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import axios from 'axios';
import { api } from '../services/api';
import {
  clearSession,
  getSession,
  hydrateSession,
  onSessionChange,
  setSession,
  type StoredSession,
} from '../services/session';
import { config as appConfig } from '../config/env';
import type { Role, UserProfile } from '../types';

interface SignInResult {
  must_change_password: boolean;
  role: Role;
}

interface AuthContextValue {
  session: StoredSession | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Push a backend-issued pair into storage — used after the forced
   *  first-login password rotation so the user stays signed in. */
  refreshSession: (accessToken: string, refreshToken: string, expiresAt?: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const MIN_RELOAD_MS = 5_000;
const BOOTSTRAP_CAP_MS = 8_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setLocalSession] = useState<StoredSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const inflightLoad = useRef<Promise<void> | null>(null);
  const lastLoadedUserId = useRef<string | null>(null);
  const syncAttemptedFor = useRef<string | null>(null);
  const lastLoadAttemptMs = useRef<number>(0);

  const loadProfile = useCallback(async (): Promise<void> => {
    if (inflightLoad.current) return inflightLoad.current;
    const now = Date.now();
    if (lastLoadedUserId.current === null && now - lastLoadAttemptMs.current < MIN_RELOAD_MS) {
      // A previous load failed recently — don't spin. The next legitimate
      // session-change event after the cooldown retries.
      return;
    }
    lastLoadAttemptMs.current = now;

    inflightLoad.current = (async () => {
      try {
        const { data } = await api.get<UserProfile>('/auth/me');
        setProfile(data);
        lastLoadedUserId.current = data?.id ?? null;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        // 401/423 are handled by api.ts (auth-failure event). 429 is handled by
        // its cooldown. We only fall through to /auth/sync when the server
        // actually told us the profile row is missing.
        if (status === 403 || status === 404) {
          const sessUserId = getSession()?.user?.id ?? null;
          if (sessUserId && syncAttemptedFor.current !== sessUserId) {
            syncAttemptedFor.current = sessUserId;
            try {
              const { data } = await api.post<UserProfile>('/auth/sync', {});
              setProfile(data);
              lastLoadedUserId.current = data?.id ?? null;
            } catch {
              setProfile(null);
              lastLoadedUserId.current = null;
            }
          }
        }
        // 429 / 5xx / offline → leave profile state alone. Resetting
        // lastLoadedUserId here would re-fire the session-change loop forever.
      } finally {
        inflightLoad.current = null;
      }
    })();

    return inflightLoad.current;
  }, []);

  const resetLoadGuards = useCallback(() => {
    lastLoadedUserId.current = null;
    syncAttemptedFor.current = null;
    lastLoadAttemptMs.current = 0;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // SecureStore read must finish before anything reads getSession().
      const restored = await hydrateSession();
      if (cancelled) return;
      setLocalSession(restored);

      if (restored) {
        // Cap the bootstrap. /auth/me can hang if the backend is restarting,
        // which would otherwise pin the app on the splash gate indefinitely.
        // Resolve within 8s regardless; loadProfile keeps running and fills the
        // profile in if the server eventually answers.
        const cap = new Promise<void>((resolve) => setTimeout(resolve, BOOTSTRAP_CAP_MS));
        await Promise.race([loadProfile(), cap]);
      }
      if (!cancelled) setLoading(false);
    })();

    const unsubscribe = onSessionChange(() => {
      if (cancelled) return;
      const fresh = getSession();
      setLocalSession(fresh);
      if (!fresh) {
        setProfile(null);
        resetLoadGuards();
        return;
      }
      // Only reload when identity actually changed. A silent token rotation
      // writes a new session object with the SAME user id, and re-fetching
      // /auth/me on every rotation is pure waste.
      const userId = fresh.user?.id ?? null;
      if (userId && userId !== lastLoadedUserId.current) void loadProfile();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadProfile, resetLoadGuards]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      // Bare axios, not `api` — the request interceptor would try to attach a
      // bearer token we don't have yet and run a pointless refresh check.
      const { data } = await axios.post(`${appConfig.apiBaseUrl}/auth/login`, { email, password });
      setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
        user: data.user,
      });
      // Fresh sign-in — clear every dedup/cooldown guard so the first profile
      // load isn't blocked by the previous session's failure window.
      resetLoadGuards();
      await loadProfile();
      return {
        must_change_password: !!data.must_change_password,
        role: data.user.role as Role,
      };
    },
    [loadProfile, resetLoadGuards],
  );

  const signOut = useCallback(async () => {
    // Best-effort backend revoke — kills the refresh token server-side and
    // bumps users.session_version. If it fails (offline), we still clear
    // locally; the token dies on its own TTL.
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    clearSession();
    setProfile(null);
    resetLoadGuards();
  }, [resetLoadGuards]);

  const refreshSession = useCallback(
    async (accessToken: string, refreshToken: string, expiresAt?: number) => {
      const existing = getSession();
      setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
        user: existing?.user ?? null,
      });
      resetLoadGuards();
      await loadProfile();
    },
    [loadProfile, resetLoadGuards],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      signIn,
      signOut,
      refreshProfile: loadProfile,
      refreshSession,
    }),
    [session, profile, loading, signIn, signOut, loadProfile, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}
