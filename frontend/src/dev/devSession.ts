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
 * Mint a real session for a seeded user and adopt it. Writing the session fires
 * `hireorbitai:session-changed`, so AuthContext reloads the profile in place —
 * no full page reload, instant switch.
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
}
