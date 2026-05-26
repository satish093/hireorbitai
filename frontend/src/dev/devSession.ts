/**
 * DEV-ONLY session helpers — instant role/user switching with no login.
 *
 * Everything in `src/dev/**` is reached only behind a `import.meta.env.DEV`
 * guard at the mount site (see main.tsx), so it is tree-shaken out of
 * production builds entirely. The backend endpoints these call are themselves
 * 404 in production (requireDevTools), giving defence in depth.
 */

import { api } from '../services/api';
import { setSession } from '../services/session';
import type { Role } from '../types';

export interface DevUser {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
}

interface DevLoginResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string; full_name: string | null; role: Role };
}

/** Active seeded users to switch between, sorted by tier (server-side). */
export async function listDevUsers(): Promise<DevUser[]> {
  const { data } = await api.get<DevUser[]>('/auth/dev/users');
  return data ?? [];
}

/**
 * Mint a real session for a seeded user and adopt it, then hard-navigate to the
 * dashboard. The hard navigation (not an in-place swap) is deliberate: it works
 * even from /login (whose form-only redirect never reacts to an externally set
 * session) and fully re-initialises the app — auth, feature flags, sidebar — as
 * the new user, clearing any stale per-user state when switching identities.
 */
export async function loginAsUser(userId: string): Promise<void> {
  const { data } = await api.post<DevLoginResponse>('/auth/dev/login', { userId });
  setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user: {
      id: data.user.id,
      email: data.user.email,
      full_name: data.user.full_name,
      role: data.user.role,
    },
  });
  window.location.assign('/dashboard');
}
