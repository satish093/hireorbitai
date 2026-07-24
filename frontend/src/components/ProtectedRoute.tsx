import { ReactNode, Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LoadingScreen } from './LoadingScreen';
import { Role, hasCapability, type DeveloperCapability } from '../types';
import { mustCompleteProfile } from '../utils/profileComplete';

interface Props {
  children: ReactNode;
  /** Roles permitted to view this route. Omit to allow any authenticated role. */
  allow?: Role[];
  /** If set, a DEVELOPER granted this capability is also allowed (alongside `allow`). */
  capability?: DeveloperCapability;
  /** Skip the consultant/recruiter onboarding redirect — used on the onboarding pages themselves. */
  bypassOnboarding?: boolean;
  /** Skip the must_change_password redirect — used on /change-password itself. */
  bypassPasswordChange?: boolean;
  /** Skip the mandatory profile-completion redirect — used on /profile/complete itself. */
  bypassProfileCompletion?: boolean;
}

/**
 * Auth + RBAC gate. Order matters; each branch is fail-CLOSED.
 *
 *   1. Loading auth context              → spinner
 *   2. No session                        → /login
 *   3. Session but no profile            → /unauthorized (fail-closed)
 *   4. must_change_password              → /change-password
 *   5. Role not in `allow`               → /unauthorized
 *   6. Onboarding required               → /onboarding/*
 *   7. Otherwise                         → render children
 *
 * The "session but no profile" branch is critical. Previously the role-gate
 * line `allow && profile && !allow.includes(profile.role)` short-circuited on
 * `profile` being null/undefined and we'd render `children` for an admin route
 * even though we had no profile to verify the role against. That's a privilege
 * escalation hole — now we explicitly send the user to /unauthorized when
 * the session is present but the backend hasn't returned a usable profile.
 */
export function ProtectedRoute({
  children,
  allow,
  capability,
  bypassOnboarding,
  bypassPasswordChange,
  bypassProfileCompletion,
}: Props) {
  const { session, profile, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return <LoadingScreen />;
  }
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;

  // Fail-closed: a token without a usable profile means /auth/me + /auth/sync
  // both failed (deactivated user, missing public.users row, network blip
  // during the AuthProvider's load). Don't render the protected page; let
  // /unauthorized explain and offer a sign-out.
  if (!profile) return <Navigate to="/unauthorized" replace />;

  // Forced password rotation gate. The /change-password page itself sets
  // bypassPasswordChange so we don't loop.
  if (!bypassPasswordChange && profile.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }

  // Role gate — a role in `allow` passes, OR a DEVELOPER holding `capability`.
  if (
    allow &&
    !allow.includes(profile.role) &&
    !(capability && hasCapability(profile, capability))
  ) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Mandatory profile-completion gate. Every non-admin user must fill the
  // required personal fields (name, phone, address, LinkedIn) before using the
  // app — existing users with blank fields are caught here on login/refresh.
  // Derived from the profile data itself, so no flag/backfill is needed; the
  // /profile/complete page sets bypassProfileCompletion to avoid a loop.
  if (
    !bypassProfileCompletion &&
    mustCompleteProfile(profile) &&
    loc.pathname !== '/profile/complete'
  ) {
    return <Navigate to="/profile/complete" replace />;
  }

  // Role-specific onboarding gates (existing behavior, preserved).
  if (!bypassOnboarding) {
    if (
      profile.role === 'CONSULTANT' &&
      !profile.consultant_id &&
      loc.pathname !== '/onboarding/consultant'
    ) {
      return <Navigate to="/onboarding/consultant" replace />;
    }
    if (
      profile.role === 'RECRUITER' &&
      !profile.recruiter_id &&
      loc.pathname !== '/onboarding/recruiter'
    ) {
      return <Navigate to="/onboarding/recruiter" replace />;
    }
  }

  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}
