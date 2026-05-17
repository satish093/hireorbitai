import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { DashboardCard } from '../components/DashboardCard';
import { SkeletonMetricGrid } from '../components/Skeleton';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { PageHeader } from '../components/PageHeader';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export function ConsultantDashboard() {
  const { profile } = useAuth();
  const [consultant, setConsultant] = useState<any>(null);
  const [apps, setApps] = useState<any[]>([]);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await api.get('/consultants');
        if (cancelled) return;
        const me = (r.data ?? []).find((c: any) => c.user_id === profile.id);
        setConsultant(me ?? null);
        if (!me) return;
        const [aRes, iRes] = await Promise.all([
          api.get(`/applications?consultant_id=${me.id}`),
          api.get(`/interviews?consultant_id=${me.id}`),
        ]);
        if (cancelled) return;
        setApps(aRes.data ?? []);
        setInterviews(iRes.data ?? []);
      } catch (e: any) {
        if (cancelled) return;
        toast.error(e?.response?.data?.error ?? 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Key on user.id ONLY — depending on the whole `profile` object would
    // re-fire this effect every time AuthContext re-renders (e.g. on every
    // silent token refresh), even though the data the effect cares about
    // hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const offers = apps.filter((a) => a.status === 'OFFER').length;
  const upcomingInterviews = interviews.filter(
    (i) => i.scheduled_at && new Date(i.scheduled_at).getTime() > Date.now(),
  ).length;

  return (
    <Layout title="Dashboard">
      <PageHeader
        title={`Welcome${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        description="Your marketing status, recent submissions, and upcoming interviews at a glance."
      />
      {loading && !consultant ? (
        <div className="mb-6">
          <SkeletonMetricGrid count={4} />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-children">
          <DashboardCard
            label="Marketing status"
            value={consultant?.marketing_status ?? '—'}
            accent="blue"
          />
          <DashboardCard label="Submissions" value={apps.length} accent="amber" />
          <DashboardCard
            label="Interviews"
            value={interviews.length}
            hint={upcomingInterviews > 0 ? `${upcomingInterviews} upcoming` : undefined}
            accent="green"
          />
          <DashboardCard label="Offers" value={offers} accent="slate" />
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-900 mb-2">Recent submissions</h2>
      <DataTable
        loading={loading}
        empty="No applications yet."
        columns={[
          { key: 'job', header: 'Job', render: (a: any) => a.job?.title ?? '—' },
          { key: 'vendor', header: 'Vendor', render: (a: any) => a.vendor?.company_name ?? '—' },
          {
            key: 'submitted_at',
            header: 'Date',
            render: (a: any) =>
              a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '—',
          },
          {
            key: 'status',
            header: 'Status',
            render: (a: any) => <StatusBadge status={a.status} />,
          },
        ]}
        rows={apps}
      />
    </Layout>
  );
}
