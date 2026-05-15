import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import axios from 'axios';
import { api } from '../services/api';
import {
  clearSession,
  getSession,
  onSessionChange,
  setSession,
  type StoredSession,
} from '../services/session';
import { config as appConfig } from '../config/env';
import { Role, UserProfile } from '../types';

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
  /** Push a backend-issued session pair into local storage (used after the
   *  forced first-login password rotation so the user stays signed in with
   *  the new credentials). */
  refreshSession: (accessToken: string, refreshToken: string, expiresAt?: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setLocalSession] = useState<StoredSession | null>(() => getSession());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Single in-flight loadProfile promise. Multiple events firing in quick
  // succession (initial mount + storage event + signIn) used to trigger N
  // parallel /auth/me calls; this collapses them to 1.
  const inflightLoad = useRef<Promise<void> | null>(null);

  // Last user.id we successfully loaded a profile for. Used to skip
  // loadProfile on session events that don't actually change identity.
  const lastLoadedUserId = useRef<string | null>(null);

  // Once /auth/sync has been attempted for a given user.id, don't retry it on
  // every subsequent session-change event — that's how a single half-
  // provisioned account turned into a /auth/me + /auth/sync storm. The flag
  // is keyed on user.id so a fresh sign-in (different id) gets a fresh try.
  const syncAttemptedFor = useRef<string | null>(null);

  // Throttle failed-profile-load retries. If /auth/me fails (429, network),
  // every session-changed event would otherwise re-call it. We require at
  // least MIN_RELOAD_MS between attempts.
  const lastLoadAttemptMs = useRef<number>(0);
  const MIN_RELOAD_MS = 5_000;

  const loadProfile = useCallback(async (): Promise<void> => {
    if (inflightLoad.current) return inflightLoad.current;
    const now = Date.now();
    if (lastLoadedUserId.current === null && now - lastLoadAttemptMs.current < MIN_RELOAD_MS) {
      // A previous load failed recently — don't spin. The next legitimate
      // session-change event after the cooldown will retry.
      return;
    }
    lastLoadAttemptMs.current = now;
    inflightLoad.current = (async () => {
      try {
        const { data } = await api.get('/auth/me');
        setProfile(data);
        lastLoadedUserId.current = data?.id ?? null;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        // 401/423 are handled by api.ts (boot to /login). 429 is handled by
        // the cooldown there. We only fall through to /auth/sync when the
        // server actually told us the profile row is missing.
        if (status === 403 || status === 404) {
          const sessUserId = getSession()?.user?.id ?? null;
          // Only attempt /auth/sync once per user.id. If sync ALSO fails the
          // user is permanently half-provisioned — the response interceptor
          // will eventually log them out and the next sign-in resets the
          // flag.
          if (sessUserId && syncAttemptedFor.current !== sessUserId) {
            syncAttemptedFor.current = sessUserId;
            try {
              const { data } = await api.post('/auth/sync', {});
              setProfile(data);
              lastLoadedUserId.current = data?.id ?? null;
            } catch {
              setProfile(null);
              lastLoadedUserId.current = null;
            }
          }
        }
        // 429 / 5xx / network → leave profile state alone. Don't reset
        // lastLoadedUserId to null on transient errors, otherwise the
        // session-change loop in useEffect would re-fire indefinitely.
      } finally {
        inflightLoad.current = null;
      }
    })();
    return inflightLoad.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Initial bootstrap.
    const s = getSession();
    setLocalSession(s);
    if (s) {
      loadProfile().finally(() => {
        if (!cancelled) setLoading(false);
      });
    } else {
      setLoading(false);
    }

    // React to session changes (sign-in / sign-out / refresh-rotation /
    // cross-tab updates) without polling.
    const unsubscribe = onSessionChange(() => {
      if (cancelled) return;
      const fresh = getSession();
      setLocalSession(fresh);
      const userId = fresh?.user?.id ?? null;
      if (!fresh) {
        setProfile(null);
        lastLoadedUserId.current = null;
        syncAttemptedFor.current = null;
        lastLoadAttemptMs.current = 0;
        return;
      }
      // Only reload the profile when identity actually changed. A silent
      // token refresh writes a new session object with the SAME user.id, and
      // we deliberately don't want to re-fetch /auth/me on every refresh.
      if (userId && userId !== lastLoadedUserId.current) {
        loadProfile();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      // Authenticate against OUR backend. The backend applies lockout /
      // temp-password / audit policies and returns a session pair.
      const { data } = await axios.post(`${appConfig.apiBaseUrl}/auth/login`, { email, password });
      setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
        user: data.user,
      });
      // Fresh sign-in — reset every dedup/cooldown so the first profile load
      // isn't blocked by a previous session's failure window.
      lastLoadedUserId.current = null;
      syncAttemptedFor.current = null;
      lastLoadAttemptMs.current = 0;
      await loadProfile();
      return { must_change_password: !!data.must_change_password, role: data.user.role as Role };
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    // Best-effort backend revoke (kills refresh tokens server-side).
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    clearSession();
    setProfile(null);
    lastLoadedUserId.current = null;
    syncAttemptedFor.current = null;
    lastLoadAttemptMs.current = 0;
  }, []);

  const refreshSession = useCallback(
    async (accessToken: string, refreshToken: string, expiresAt?: number) => {
      const existing = getSession();
      setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
        user: existing?.user ?? null,
      });
      lastLoadedUserId.current = null;
      syncAttemptedFor.current = null;
      lastLoadAttemptMs.current = 0;
      await loadProfile();
    },
    [loadProfile],
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
