/**
 * App-wide feature-flag store.
 *
 * Port of frontend/src/hooks/useFeatureFlags.tsx. Hydrates once per identity
 * from GET /feature-flags/me (global flags + per-group overrides), and listens
 * on the 'feature-flags' invalidation channel for live updates.
 *
 * Default semantics for a MISSING flag: treated as ENABLED — the same default
 * the backend's requireFeature() middleware applies, so client and server agree
 * without extra configuration.
 *
 * The fetch deliberately keys on user id, not on the access token. Keying on
 * the token refetched on every hourly rotation, which showed up in the web's
 * rate-limit logs as pure noise.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useInvalidationListener } from './useInvalidate';

interface FeatureFlagsContextValue {
  flags: Record<string, boolean>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | undefined>(undefined);

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<Record<string, boolean>>('/feature-flags/me');
      setFlags(data ?? {});
    } catch {
      // Treat a fetch failure as "no new information" and leave the existing
      // map alone — a transient blip must not suddenly hide whole modules.
    } finally {
      setLoading(false);
    }
  }, []);

  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      setFlags({});
      setLoading(false);
      return;
    }
    void refresh();
  }, [userId, refresh]);

  useInvalidationListener('feature-flags', () => {
    void refresh();
  });

  return (
    <FeatureFlagsContext.Provider value={{ flags, loading, refresh }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

/**
 * Read a flag. Defaults to TRUE when unknown, so missing configuration never
 * silently hides a feature on first run.
 *
 *   flag present, true   → true
 *   flag present, false  → false
 *   flag absent          → true  (default-on, matches the backend)
 *   provider not mounted → true  (safe default)
 *   still loading        → true  (no flash of "feature off")
 */
export function useFeatureFlag(key: string): boolean {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) return true;
  if (ctx.loading) return true;
  return ctx.flags[key] !== false;
}

/** Fail-closed variant — false while flags are still loading. */
export function useFeatureFlagStrict(key: string): boolean {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) return false;
  if (ctx.loading) return false;
  return ctx.flags[key] !== false;
}

export function useFeatureFlags(): FeatureFlagsContextValue {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) throw new Error('useFeatureFlags must be inside <FeatureFlagsProvider>');
  return ctx;
}
