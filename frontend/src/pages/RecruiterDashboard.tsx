import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DashboardCard } from '../components/DashboardCard';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { PageHeader } from '../components/PageHeader';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export function RecruiterDashboard() {
  const { profile } = useAuth();
  const [consultants, setConsultants] = useState<any[]>([]);
  const [apps, setApps] = useState<any[]>([]);
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
    ]).then(([cRes, aRes]) => {
      if (cancelled) return;
      setConsultants(cRes.data ?? []);
      setApps(aRes.data ?? []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profile]);

  const active = consultants.filter((c) => c.marketing_status === 'ACTIVE').length;
  const placed = consultants.filter((c) => c.marketing_status === 'PLACED').length;
  const interviewing = apps.filter((a) => a.status === 'INTERVIEW' || a.status === 'SCREENING').length;

  return (
    <Layout title="Dashboard">
      <PageHeader
        title={`Welcome${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        description="Your assigned consultants and submission pipeline."
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-children">
        <DashboardCard label="My consultants" value={consultants.length} accent="blue" />
        <DashboardCard label="Active" value={active} hint={`${placed} placed`} accent="green" />
        <DashboardCard label="Submissions" value={apps.length} accent="amber" />
        <DashboardCard label="In pipeline" value={interviewing} hint="Screening or interview" accent="brand" />
      </div>

      <h2 className="text-sm font-semibold text-slate-900 mb-2">My consultants</h2>
      <DataTable
        loading={loading}
        empty="No consultants assigned yet."
        columns={[
          { key: 'name', header: 'Name', render: (c: any) => c.user?.full_name ?? c.user?.email ?? '—' },
          { key: 'primary_skill', header: 'Primary skill' },
          { key: 'visa_status', header: 'Visa' },
          { key: 'marketing_status', header: 'Status', render: (c: any) => <StatusBadge status={c.marketing_status} /> },
        ]}
        rows={consultants}
      />
    </Layout>
  );
}
