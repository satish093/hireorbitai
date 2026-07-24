import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import type { DashApplication, DashConsultant } from './types';

/**
 * Page-level data for the recruiter dashboard: the recruiter's consultants and
 * their applications. Self-fetching feed/task/goal widgets load their own data.
 */
export function useDashboardData() {
  const { profile } = useAuth();
  const [consultants, setConsultants] = useState<DashConsultant[]>([]);
  const [apps, setApps] = useState<DashApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get('/consultants').catch((e) => {
        if (!cancelled) toast.error(e?.response?.data?.error ?? 'Failed to load consultants');
        return { data: [] };
      }),
      api.get('/applications').catch((e) => {
        if (!cancelled) toast.error(e?.response?.data?.error ?? 'Failed to load applications');
        return { data: [] };
      }),
    ])
      .then(([cRes, aRes]) => {
        if (cancelled) return;
        setConsultants(Array.isArray(cRes.data) ? cRes.data : []);
        setApps(Array.isArray(aRes.data) ? aRes.data : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Key on user id only — see note in the original dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  return { profile, consultants, apps, loading };
}
