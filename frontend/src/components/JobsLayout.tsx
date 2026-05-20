import { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { Brand } from './Brand';
import { useAuth } from '../context/AuthContext';
import { MANAGER_TIER } from '../types';

/**
 * Standalone job-app shell. Replaces the admin sidebar (`Layout`) for the
 * jobs experience so it reads like a real job board / product rather than a
 * module inside an internal tool. Clean top nav, centred max-width content,
 * dvh height for iOS. Staff get a discreet link back to the workspace.
 */
function initials(name?: string | null, email?: string | null): string {
  const src = (name && name.trim()) || (email && email.split('@')[0]) || '';
  const parts = src.split(/\s+|\.|_|-/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function JobsLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const isStaff = !!profile && (MANAGER_TIER as string[]).includes(profile.role);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 flex flex-col">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200 safe-pt">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <Link to="/jobs" className="flex items-center gap-2 shrink-0" aria-label="Jobs home">
            <Brand size="sm" />
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <NavLink
              to="/jobs"
              className={({ isActive }) =>
                clsx(
                  'px-3 py-1.5 rounded-lg transition-colors',
                  isActive
                    ? 'bg-slate-100 text-slate-900 font-medium'
                    : 'text-slate-600 hover:bg-slate-50',
                )
              }
            >
              Find Jobs
            </NavLink>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {isStaff && (
              <Link
                to="/dashboard"
                className="hidden sm:inline text-xs text-slate-500 hover:text-slate-800"
                title="Back to the full workspace"
              >
                Workspace ↗
              </Link>
            )}
            <Link
              to={profile?.id ? `/users/${profile.id}` : '#'}
              title="Your profile"
              className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-semibold hover:ring-2 hover:ring-emerald-200"
            >
              {initials(profile?.full_name, profile?.email)}
            </Link>
            <button
              onClick={signOut}
              title="Sign out"
              className="text-slate-400 hover:text-slate-700 text-sm px-2 py-1 rounded-md hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 safe-pb">{children}</main>
    </div>
  );
}
