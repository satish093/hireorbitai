import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
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

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setProfile(data);
    } catch {
      // Profile row may not exist yet — sync it.
      try {
        const { data } = await api.post('/auth/sync', {});
        setProfile(data);
      } catch {
        setProfile(null);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session) loadProfile().finally(() => { if (!cancelled) setLoading(false); });
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (cancelled) return;
      setSession(s);
      if (s) loadProfile();
      else setProfile(null);
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
    // Reload the profile so `must_change_password` is reflected immediately.
    await loadProfile();
    return { must_change_password: !!data.must_change_password, role: data.user.role as Role };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    // Best-effort backend revoke (kills refresh tokens server-side).
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshSession = useCallback(async (accessToken: string, refreshToken: string) => {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
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
