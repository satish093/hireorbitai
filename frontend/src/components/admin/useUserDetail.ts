import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Role } from '../../types';
import type { AuditEvent, Status, UserSession } from './types';

export interface AdminUserDetail {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: Role;
  status: Status | null;
  status_reason: string | null;
  status_changed_at: string | null;
  must_change_password: boolean;
  last_login_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  admin_notes: string | null;
  group_id: string | null;
  session_count?: number;
  context?: {
    consultant?: Record<string, unknown> | null;
    recruiter?: Record<string, unknown> | null;
  };
}

/**
 * Loads everything the detail pane shows for one user: profile + context,
 * audit timeline, and active sessions. `reloadKey` bumps re-fetch all three
 * after a mutation. Uses an alive-flag so a StrictMode remount can't blank it.
 */
export function useUserDetail(userId: string | null) {
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!userId) {
      setUser(null);
      setAudit([]);
      setSessions([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<AdminUserDetail>(`/admin/users/${userId}`),
      api.get<AuditEvent[]>(`/admin/users/${userId}/audit`, { params: { limit: 20 } }),
      api.get<UserSession[]>(`/admin/users/${userId}/sessions`).catch(() => ({ data: [] })),
    ])
      .then(([u, a, s]) => {
        if (!alive) return;
        setUser(u.data);
        setAudit(a.data ?? []);
        setSessions(s.data ?? []);
      })
      .catch((e) => {
        if (!alive) return;
        const code = e?.response?.status;
        setError(code === 404 ? 'User not found' : (e?.response?.data?.error ?? 'Failed to load'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId, reloadKey]);

  return { user, audit, sessions, loading, error, reload, setUser };
}
