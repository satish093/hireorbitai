import { ReactNode, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Brand } from './Brand';
import { api } from '../services/api';
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

/** Bell toggle — opt in/out of the daily job-match email digest. */
function AlertsToggle() {
  const { profile } = useAuth();
  const [on, setOn] = useState(profile?.job_alerts !== false);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      await api.post('/auth/job-alerts', { enabled: next });
      toast.success(next ? 'Job alerts on' : 'Job alerts off');
    } catch {
      setOn(!next);
      toast.error('Could not update alerts');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={on ? 'Daily job alerts: on' : 'Daily job alerts: off'}
      aria-pressed={on}
      className={clsx(
        'text-sm px-2 py-1 rounded-md transition-colors disabled:opacity-50',
        on ? 'text-brand-600 hover:bg-brand-50' : 'text-slate-400 hover:bg-slate-100',
      )}
    >
      {on ? '🔔' : '🔕'}
    </button>
  );
}

export function JobsLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const isStaff = !!profile && (MANAGER_TIER as string[]).includes(profile.role);
  const isConsultant = profile?.role === 'CONSULTANT';

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
            {isConsultant && <AlertsToggle />}
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
