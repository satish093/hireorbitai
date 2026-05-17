import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useInvalidationListener } from './useInvalidate';

interface FeatureFlagsContextValue {
  flags: Record<string, boolean>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | undefined>(undefined);

/**
 * App-wide feature flag store. Hydrates once per session, and listens on the
 * `'feature-flags'` invalidation channel for live updates after an admin
 * toggles a flag.
 *
 * Default semantics for a missing flag (not in the DB): treated as ENABLED
 * — same default the backend `requireFeature()` middleware uses, so frontend
 * and backend agree without extra config.
 */
export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // /me returns the effective map for the calling user (global flags +
      // any per-group overrides). Sidebar + route guards key off this.
      const { data } = await api.get('/feature-flags/me');
      setFlags(data ?? {});
    } catch {
      // Treat fetch failures as "no overrides known" — leave the existing
      // flag map alone so a transient blip doesn't suddenly hide modules.
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch only when the user identity changes (sign-in / sign-out / cross-
  // tab login as a different user). The previous `[session?.access_token]`
  // dep refetched on every silent JWT rotation (~hourly per tab), which is
  // both pointless (the flag map doesn't depend on the token) and a known
  // source of /feature-flags/me traffic in the rate-limit logs.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      setFlags({});
      setLoading(false);
      return;
    }
    void refresh();
  }, [userId, refresh]);

  // Live update — admin toggles a flag from /admin/features → that page fires
  // invalidate('feature-flags'); FeatureFlagsProvider re-fetches, every
  // sidebar/guard/page that reads the context re-renders with the new map.
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
 * Read a flag. Defaults to TRUE when the flag isn't known so missing
 * configuration never silently hides a feature on first run.
 *
 *   - flag exists, value is true   → returns true
 *   - flag exists, value is false  → returns false
 *   - flag missing entirely        → returns true (default-on, matches backend)
 *   - context not mounted          → returns true (safe for tests)
 *   - still loading                → returns true (no flash of "feature off")
 */
export function useFeatureFlag(key: string): boolean {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) return true;
  if (ctx.loading) return true;
  return ctx.flags[key] !== false;
}

/** Fail-closed variant — returns false while flags are loading. */
export function useFeatureFlagStrict(key: string): boolean {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) return false;
  if (ctx.loading) return false;
  return ctx.flags[key] !== false;
}

export function useFeatureFlags() {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) throw new Error('useFeatureFlags must be inside <FeatureFlagsProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Route-level guard. Wrap a route's element so that a disabled feature
// redirects the user away cleanly instead of letting the page mount and
// fire API calls that 403.
//
//   <Route path="/tasks" element={
//     <ProtectedRoute>
//       <FeatureGuard feature="tasks"><Tasks /></FeatureGuard>
//     </ProtectedRoute>
//   } />
//
// Defaults to redirecting to /dashboard. Override with `redirectTo` if a
// different fallback makes sense for the feature.
// ---------------------------------------------------------------------------
export function FeatureGuard({
  feature,
  children,
  redirectTo = '/dashboard',
}: {
  feature: string;
  children: ReactNode;
  redirectTo?: string;
}) {
  const ctx = useContext(FeatureFlagsContext);
  // While loading we render a thin spinner rather than the children —
  // keeps the page from flashing partial UI before the flag check resolves.
  if (!ctx || ctx.loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-slate-400 text-sm">
        Loading…
      </div>
    );
  }
  if (ctx.flags[feature] === false) {
    return <Navigate to={redirectTo} replace />;
  }
  return <>{children}</>;
}
