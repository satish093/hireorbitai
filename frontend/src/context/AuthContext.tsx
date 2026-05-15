import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { api } from '../services/api';
import { config as appConfig } from '../config/env';
import axios from 'axios';
import { Role, UserProfile } from '../types';

interface SignInResult {
  must_change_password: boolean;
  role: Role;
}

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Push a backend-issued session pair into Supabase (used after change-password
   *  rotation so the user stays signed in with the new credentials). */
  refreshSession: (accessToken: string, refreshToken: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Single in-flight loadProfile promise. Multiple Supabase events firing
  // in quick succession (INITIAL_SESSION + SIGNED_IN + TOKEN_REFRESHED on
  // first mount, easy to do) used to trigger N parallel /auth/me calls;
  // this collapses them to 1.
  const inflightLoad = useRef<Promise<void> | null>(null);

  // Last user.id we successfully loaded a profile for. Used to skip
  // loadProfile on Supabase events that don't actually change identity
  // (TOKEN_REFRESHED with the same user, etc.) — those used to spam
  // /auth/me on every silent token refresh.
  const lastLoadedUserId = useRef<string | null>(null);

  const loadProfile = useCallback(async (): Promise<void> => {
    if (inflightLoad.current) return inflightLoad.current;
    inflightLoad.current = (async () => {
      try {
        const { data } = await api.get('/auth/me');
        setProfile(data);
        lastLoadedUserId.current = data?.id ?? null;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        // Only fall through to /auth/sync when /auth/me genuinely couldn't
        // find the profile (403 = "profile not found" in our middleware,
        // 404 just in case). On 429, network error, or 5xx we leave the
        // existing profile state alone — the next legitimate auth event
        // will retry. Falling through on 429 used to dig the hole deeper.
        if (status === 403 || status === 404) {
          try {
            const { data } = await api.post('/auth/sync', {});
            setProfile(data);
            lastLoadedUserId.current = data?.id ?? null;
          } catch {
            setProfile(null);
            lastLoadedUserId.current = null;
          }
        }
      } finally {
        inflightLoad.current = null;
      }
    })();
    return inflightLoad.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Initial bootstrap.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session) {
        loadProfile().finally(() => { if (!cancelled) setLoading(false); });
      } else {
        setLoading(false);
      }
    });

    // Auth listener — but DON'T reload the profile on every event Supabase
    // emits. Specifically:
    //   - SIGNED_IN          → user just signed in, load profile
    //   - SIGNED_OUT         → clear profile
    //   - USER_UPDATED       → profile fields may have changed, reload
    //   - INITIAL_SESSION    → handled by getSession() above
    //   - TOKEN_REFRESHED    → SAME user, fresh token, no need to refetch
    //   - PASSWORD_RECOVERY  → reset-password page handles this
    //
    // Even within the wanted events we additionally guard on user.id so
    // INITIAL_SESSION + SIGNED_IN landing in the same tick (which DOES
    // happen on first mount in dev) only triggers ONE /auth/me.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (cancelled) return;
      setSession(s);

      if (event === 'SIGNED_OUT' || !s) {
        setProfile(null);
        lastLoadedUserId.current = null;
        return;
      }

      const userId = s.user?.id ?? null;
      const reloadEvents = new Set(['SIGNED_IN', 'USER_UPDATED']);
      if (reloadEvents.has(event) && userId && userId !== lastLoadedUserId.current) {
        loadProfile();
      }
      // TOKEN_REFRESHED, INITIAL_SESSION (already handled), PASSWORD_RECOVERY:
      // intentionally no-op for profile loading.
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    // Authenticate against OUR backend (which then talks to Supabase Auth and
    // applies lockout / temp-password / audit policies). On success the
    // backend returns the session pair — we hand it to supabase-js so the
    // rest of the app behaves the same as a direct sign-in.
    const { data } = await axios.post(`${appConfig.apiBaseUrl}/auth/login`, { email, password });
    const { error } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (error) throw error;
    // Force a profile reload with the new identity. We bypass the
    // last-loaded-user-id guard by clearing it first; the SIGNED_IN event
    // that setSession fires will then re-trigger loadProfile if our
    // explicit call below hasn't already run.
    lastLoadedUserId.current = null;
    await loadProfile();
    return { must_change_password: !!data.must_change_password, role: data.user.role as Role };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    // Best-effort backend revoke (kills refresh tokens server-side).
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    await supabase.auth.signOut();
    setProfile(null);
    lastLoadedUserId.current = null;
  }, []);

  const refreshSession = useCallback(async (accessToken: string, refreshToken: string) => {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    // Same trick as signIn — force a profile reload by clearing the guard.
    lastLoadedUserId.current = null;
    await loadProfile();
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(() => ({
    session, profile, loading,
    signIn, signOut, refreshProfile: loadProfile, refreshSession,
  }), [session, profile, loading, signIn, signOut, loadProfile, refreshSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}
