/**
 * DEV-ONLY floating toolbar — instant role/user switching for fast UI testing.
 *
 * Reached only behind a `import.meta.env.DEV` guard in main.tsx, so it never
 * ships to production. Switching calls the dev impersonation endpoint and swaps
 * the session in place (AuthContext reloads the profile — no page reload), so
 * every screen can be viewed as any role without signing in repeatedly.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABEL, type Role } from '../types';
import { listDevUsers, loginAsUser, type DevUser } from './devSession';

// Every role except DEVELOPER (DEVELOPER is a configurable scoped-admin whose
// access depends on per-account capability grants, so a one-click impersonation
// doesn't represent a meaningful state).
const QUICK_ROLES: Role[] = [
  'SUPER_ADMIN',
  'CEO',
  'CTO',
  'DIRECTOR',
  'MANAGER',
  'HR_MANAGER',
  'RECRUITER',
  'CONSULTANT',
];

export function DevToolbar() {
  const { profile, signOut } = useAuth();
  const [users, setUsers] = useState<DevUser[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDevUsers()
      .then((u) => {
        if (!cancelled) setUsers(u);
      })
      .catch(() => {
        if (!cancelled) setError('dev API unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function switchTo(userId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await loginAsUser(userId);
      setOpen(false);
    } catch {
      setError('switch failed');
    } finally {
      setBusy(false);
    }
  }

  // First seeded user of a given role — powers the quick "view as" buttons.
  function firstOfRole(role: Role): DevUser | undefined {
    return users.find((u) => u.role === role);
  }

  return (
    <div className="fixed bottom-3 left-3 z-[9999] max-w-[calc(100vw-1.5rem)] font-sans">
      <div className="rounded-xl border border-amber-400/60 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-900">
            DEV
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-xs font-medium">
              {profile?.full_name ?? profile?.email ?? 'No session'}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-amber-300/90">
              {profile?.role ? ROLE_LABEL[profile.role] : '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
            className="ml-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? '…' : 'Switch ▾'}
          </button>
        </div>

        {open && (
          <div className="max-h-[60vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto border-t border-slate-700 p-2">
            {/* Quick view-as buttons */}
            <div className="mb-2 flex flex-wrap gap-1">
              {QUICK_ROLES.map((role) => {
                const u = firstOfRole(role);
                if (!u) return null;
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => switchTo(u.id)}
                    className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] hover:bg-slate-800"
                  >
                    {ROLE_LABEL[role]}
                  </button>
                );
              })}
            </div>

            {/* Full user list */}
            <div className="space-y-0.5">
              {users.map((u) => {
                const active = u.id === profile?.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => switchTo(u.id)}
                    className={
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs ' +
                      (active ? 'bg-amber-400/15 text-amber-200' : 'hover:bg-slate-800')
                    }
                  >
                    <span className="min-w-0 truncate">{u.full_name ?? u.email}</span>
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-slate-400">
                      {ROLE_LABEL[u.role]}
                    </span>
                  </button>
                );
              })}
              {users.length === 0 && (
                <p className="px-2 py-1 text-[11px] text-slate-400">
                  {error ?? 'Loading seeded users…'}
                </p>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
              <Link
                to="/dev"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-600 px-2 py-1 text-[11px] hover:bg-slate-800"
              >
                Test panel →
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-md border border-slate-600 px-2 py-1 text-[11px] hover:bg-slate-800"
              >
                Sign out
              </button>
            </div>
          </div>
        )}

        {error && !open && <div className="px-3 pb-2 text-[10px] text-rose-300">{error}</div>}
      </div>
    </div>
  );
}
