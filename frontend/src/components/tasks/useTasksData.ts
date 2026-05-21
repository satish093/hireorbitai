import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { invalidate, useInvalidationListener } from '../../hooks/useInvalidate';
import { MANAGER_TIER, type Role, type TaskStatus } from '../../types';
import toast from 'react-hot-toast';
import { type TaskRow, type TaskUser } from './types';

/** Page-level task data: the full visible task set (filtering happens
 *  client-side so saved views + search are instant and the "shown of total"
 *  count is meaningful), assignable users, optimistic status patches
 *  (drag-drop), and cross-page invalidation. */
export function useTasksData() {
  const { profile } = useAuth();
  const isManager = !!profile && (MANAGER_TIER as Role[]).includes(profile.role);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [users, setUsers] = useState<TaskUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useInvalidationListener('tasks', () => setReloadTick((n) => n + 1));

  useEffect(() => {
    // Use an alive-flag, not an AbortController: a React StrictMode
    // mount/unmount/remount must not cancel the only in-flight request.
    let alive = true;
    setLoading(true);
    api
      .get('/tasks')
      .then((r) => {
        if (alive) setTasks(r.data ?? []);
      })
      .catch((e: any) => {
        if (alive) toast.error(e?.response?.data?.error ?? 'Failed to load tasks');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadTick]);

  // Assignable users (manager tier only) — for the assignee filter + detail pane.
  useEffect(() => {
    if (!isManager) return;
    Promise.all([
      api.get('/recruiters').catch(() => ({ data: [] })),
      api.get('/consultants').catch(() => ({ data: [] })),
    ]).then(([recs, cons]) => {
      const seen = new Map<string, TaskUser>();
      for (const r of recs.data ?? [])
        if (r.user_id)
          seen.set(r.user_id, {
            id: r.user_id,
            full_name: r.user?.full_name,
            email: r.user?.email,
            role: 'RECRUITER',
          });
      for (const c of cons.data ?? [])
        if (c.user_id)
          seen.set(c.user_id, {
            id: c.user_id,
            full_name: c.user?.full_name,
            email: c.user?.email,
            role: 'CONSULTANT',
          });
      if (profile)
        seen.set(profile.id, {
          id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          role: profile.role,
        });
      setUsers(Array.from(seen.values()));
    });
  }, [isManager, profile]);

  /** Optimistic status change (drag-drop + detail pane). */
  async function patchStatus(taskId: string, newStatus: TaskStatus) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
    try {
      await api.patch(`/tasks/${taskId}/status`, { status: newStatus });
      invalidate('tasks');
    } catch (e: any) {
      setReloadTick((n) => n + 1); // roll back by refetching
      toast.error(e?.response?.data?.error ?? 'Status update failed');
    }
  }

  return {
    profile,
    isManager,
    tasks,
    setTasks,
    users,
    loading,
    patchStatus,
    reload: () => setReloadTick((n) => n + 1),
  };
}
