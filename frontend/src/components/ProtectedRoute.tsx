import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types';

interface Props {
  children: ReactNode;
  /** Roles permitted to view this route. Omit to allow any authenticated role. */
  allow?: Role[];
  /** Skip the consultant/recruiter onboarding redirect — used on the onboarding pages themselves. */
  bypassOnboarding?: boolean;
  /** Skip the must_change_password redirect — used on /change-password itself. */
  bypassPasswordChange?: boolean;
}

/**
 * Auth + RBAC gate. Three checks in order:
 *   1. Loading? → spinner
 *   2. No session? → /login
 *   3. must_change_password? → /change-password (unless this IS that page)
 *   4. Role not allowed? → /unauthorized
 *   5. Onboarding required (consultant/recruiter)? → /onboarding/*
 */
export function ProtectedRoute({ children, allow, bypassOnboarding, bypassPasswordChange }: Props) {
  const { session, profile, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;

  // Forced password rotation gate. The /change-password page itself sets
  // bypassPasswordChange so we don't loop.
  if (!bypassPasswordChange && profile?.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }

  if (allow && profile && !allow.includes(profile.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Role-specific onboarding gates (existing behavior, preserved).
  if (!bypassOnboarding && profile) {
    if (profile.role === 'CONSULTANT' && !profile.consultant_id && loc.pathname !== '/onboarding/consultant') {
      return <Navigate to="/onboarding/consultant" replace />;
    }
    if (profile.role === 'RECRUITER' && !profile.recruiter_id && loc.pathname !== '/onboarding/recruiter') {
      return <Navigate to="/onboarding/recruiter" replace />;
    }
  }

  return <>{children}</>;
}
