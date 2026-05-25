import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useInvalidationListener } from './useInvalidate';
import { OWNER_TIER } from '../types';

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
// When a feature flag is OFF, we now render an inline "feature disabled"
// panel instead of silently redirecting to /dashboard. The old redirect made
// it look like clicking a nav item or dashboard button "did nothing" or
// "bounced home" — confusing because the user got no explanation. Pass
// `redirectTo` only if a hard redirect is genuinely wanted somewhere.
// ---------------------------------------------------------------------------
export function FeatureGuard({
  feature,
  children,
  redirectTo,
}: {
  feature: string;
  children: ReactNode;
  /** If set, hard-redirect instead of showing the disabled panel. */
  redirectTo?: string;
}) {
  const ctx = useContext(FeatureFlagsContext);
  // While loading we render a thin spinner rather than the children —
  // keeps the page from flashing partial UI before the flag check resolves.
  if (!ctx || ctx.loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-muted text-sm">Loading…</div>
    );
  }
  if (ctx.flags[feature] === false) {
    if (redirectTo) return <Navigate to={redirectTo} replace />;
    return <FeatureDisabledPanel feature={feature} />;
  }
  return <>{children}</>;
}

/** Friendly inline panel shown when a feature flag is turned off, instead of
 *  a silent redirect. Tells the user what happened and (for admins) where to
 *  flip the flag back on. */
function FeatureDisabledPanel({ feature }: { feature: string }) {
  const { profile } = useAuth();
  const isOwner = profile?.role != null && (OWNER_TIER as readonly string[]).includes(profile.role);
  const label = feature.replace(/_/g, ' ');
  return (
    <div className="min-h-[60dvh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center bg-surface border border-border rounded-2xl p-8 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-hover text-muted text-2xl mx-auto mb-3 flex items-center justify-center">
          ⌀
        </div>
        <h2 className="text-lg font-semibold text-ink capitalize">{label} is turned off</h2>
        <p className="text-sm text-muted mt-2">
          This feature is disabled for your workspace.
          {isOwner
            ? ' You can re-enable it from Feature flags.'
            : ' Ask a workspace owner to enable it.'}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link
            to="/dashboard"
            className="text-sm px-4 py-2 rounded-lg border border-border text-ink hover:bg-hover"
          >
            Back to dashboard
          </Link>
          {isOwner && (
            <Link
              to="/admin/features"
              className="text-sm px-4 py-2 rounded-lg bg-ink text-bg hover:opacity-90"
            >
              Open Feature flags
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
