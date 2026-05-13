import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

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

  async function refresh() {
    try {
      // /me returns the effective map for the calling user (global flags +
      // any per-group overrides). Sidebar + route guards key off this.
      const { data } = await api.get('/feature-flags/me');
      setFlags(data ?? {});
    } catch {
      // Fall through — treat all features as enabled if endpoint fails.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session) { setFlags({}); setLoading(false); return; }
    refresh();
    // eslint-disable-next-line
  }, [session?.access_token]);

  return (
    <FeatureFlagsContext.Provider value={{ flags, loading, refresh }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

/**
 * Read a flag. Defaults to TRUE when the flag isn't known so missing
 * configuration never silently hides a feature on first run.
 */
export function useFeatureFlag(key: string): boolean {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) return true;
  if (ctx.loading) return true;
  return ctx.flags[key] !== false;
}

export function useFeatureFlags() {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) throw new Error('useFeatureFlags must be inside <FeatureFlagsProvider>');
  return ctx;
}
