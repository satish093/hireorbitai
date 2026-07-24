/**
 * Auth + RBAC gate — the mobile counterpart of
 * frontend/src/components/ProtectedRoute.tsx.
 *
 * Order matters; every branch is fail-CLOSED and mirrors the web's exactly:
 *
 *   1. Loading auth context        → splash
 *   2. No session                  → /login
 *   3. Session but NO profile      → /unauthorized      ← see note below
 *   4. must_change_password        → /change-password
 *   5. Role not in `allow`         → /unauthorized
 *   6. Profile incomplete          → /complete-profile
 *   7. Onboarding required         → /onboarding/*
 *   8. Feature flag off            → inline disabled panel
 *   9. Otherwise                   → render
 *
 * Branch 3 is the one that matters most. On the web this was a real privilege-
 * escalation hole: the role check `allow && profile && !allow.includes(...)`
 * short-circuited when `profile` was null, so an admin-only screen rendered for
 * a user whose profile had never loaded. Do not "simplify" that condition here.
 *
 * This gate is CONVENIENCE, not security. The backend enforces every one of
 * these rules independently (requireAuth → requireRole → per-row ownership).
 * A tampered client can bypass this component and still get 403/404 from the
 * server. It exists so users see a sensible screen, not so data stays safe.
 */

import { useEffect, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Redirect, usePathname } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { hasCapability, OWNER_TIER, type DeveloperCapability, type Role } from '../types';
import { mustCompleteProfile } from '../utils/profileComplete';
import { useTheme } from '../theme';
import { SplashGate } from './SplashGate';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
  /** Roles permitted here. Omit to allow any authenticated role. */
  allow?: Role[];
  /** A DEVELOPER holding this capability is also allowed, alongside `allow`. */
  capability?: DeveloperCapability;
  /** Feature flag that must be on. Renders a disabled panel when off. */
  feature?: string;
  bypassOnboarding?: boolean;
  bypassPasswordChange?: boolean;
  bypassProfileCompletion?: boolean;
}

export function RouteGuard({
  children,
  allow,
  capability,
  feature,
  bypassOnboarding,
  bypassPasswordChange,
  bypassProfileCompletion,
}: Props) {
  const { session, profile, loading } = useAuth();
  const pathname = usePathname();

  if (loading) return <SplashGate />;

  if (!session) return <Redirect href="/login" />;

  // Fail-closed: a token with no usable profile means /auth/me AND /auth/sync
  // both failed (deactivated user, missing public.users row, or a network blip
  // during bootstrap). Do NOT render the protected screen.
  if (!profile) return <Redirect href="/unauthorized" />;

  if (!bypassPasswordChange && profile.must_change_password) {
    return <Redirect href="/change-password" />;
  }

  if (
    allow &&
    !allow.includes(profile.role) &&
    !(capability && hasCapability(profile, capability))
  ) {
    return <Redirect href="/unauthorized" />;
  }

  if (
    !bypassProfileCompletion &&
    mustCompleteProfile(profile) &&
    pathname !== '/complete-profile'
  ) {
    return <Redirect href="/complete-profile" />;
  }

  if (!bypassOnboarding) {
    if (
      profile.role === 'CONSULTANT' &&
      !profile.consultant_id &&
      pathname !== '/onboarding/consultant'
    ) {
      return <Redirect href="/onboarding/consultant" />;
    }
    if (
      profile.role === 'RECRUITER' &&
      !profile.recruiter_id &&
      pathname !== '/onboarding/recruiter'
    ) {
      return <Redirect href="/onboarding/recruiter" />;
    }
  }

  if (feature) return <FeatureGate feature={feature}>{children}</FeatureGate>;

  return <>{children}</>;
}

/**
 * Feature-flag gate. Renders an explanatory panel rather than bouncing the user
 * home — the web learned that a silent redirect reads as "tapping that did
 * nothing".
 */
export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { flags, loading } = useFeatureFlags();
  if (loading) return <SplashGate />;
  if (flags[feature] === false) return <FeatureDisabledPanel feature={feature} />;
  return <>{children}</>;
}

function FeatureDisabledPanel({ feature }: { feature: string }) {
  const { colors, spacing, fontSize, radius } = useTheme();
  const { profile } = useAuth();
  const isOwner = !!profile && (OWNER_TIER as readonly string[]).includes(profile.role);
  const label = feature.replace(/_/g, ' ');

  return (
    <View style={[styles.centered, { backgroundColor: colors.bg, padding: spacing['2xl'] }]}>
      <View
        style={{
          width: '100%',
          maxWidth: 420,
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius['2xl'],
          padding: spacing['3xl'],
        }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: colors.hover,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.md,
          }}
        >
          <Text style={{ fontSize: 22, color: colors.muted }}>⌀</Text>
        </View>
        <Text
          style={{
            fontSize: fontSize.lg,
            fontWeight: '600',
            color: colors.ink,
            textTransform: 'capitalize',
            textAlign: 'center',
          }}
        >
          {label} is turned off
        </Text>
        <Text
          style={{
            fontSize: fontSize.sm,
            color: colors.muted,
            marginTop: spacing.sm,
            textAlign: 'center',
            lineHeight: 20,
          }}
        >
          This feature is disabled for your workspace.
          {isOwner
            ? ' You can re-enable it from Feature flags.'
            : ' Ask a workspace owner to enable it.'}
        </Text>
        <View style={{ marginTop: spacing.xl, width: '100%' }}>
          <Button label="Back to dashboard" href="/(app)/dashboard" variant="secondary" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

/**
 * Inverse guard for the auth screens: a signed-in user who lands on /login gets
 * bounced to the dashboard instead of seeing a sign-in form they don't need.
 */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  if (loading) return <SplashGate />;
  if (session && profile && !profile.must_change_password) {
    return <Redirect href="/(app)/dashboard" />;
  }
  return <>{children}</>;
}

/** Fires a callback once the profile is known. Used for one-shot side effects. */
export function useOnProfileReady(cb: () => void): void {
  const { profile, loading } = useAuth();
  useEffect(() => {
    if (!loading && profile) cb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile?.id]);
}
