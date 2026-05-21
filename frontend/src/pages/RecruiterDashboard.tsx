import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { SkeletonMetricGrid } from '../components/Skeleton';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { useDashboardData } from '../components/dashboard/useDashboardData';
import { MetricRow } from '../components/dashboard/MetricRow';

export function RecruiterDashboard() {
  const navigate = useNavigate();
  const { profile, consultants, apps, loading } = useDashboardData();
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const first = profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : '';

  return (
    <Layout title="Dashboard">
      <PageHeader
        title={`Welcome${first}`}
        description={today}
        action={
          <>
            <Button variant="outline" onClick={() => navigate('/consultants')}>
              Add consultant
            </Button>
            <Button variant="outline" onClick={() => navigate('/jobs')}>
              Find jobs
            </Button>
            <Button variant="primary" onClick={() => navigate('/applications')}>
              Log submission
            </Button>
          </>
        }
      />

      {loading && consultants.length === 0 && apps.length === 0 ? (
        <SkeletonMetricGrid count={4} />
      ) : (
        <MetricRow consultants={consultants} apps={apps} />
      )}

      <h2 className="text-sm font-semibold text-ink mb-2 mt-6">My consultants</h2>
      <DataTable
        loading={loading}
        empty="No consultants assigned yet."
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (c: { user?: { full_name?: string | null; email?: string | null } | null }) =>
              c.user?.full_name ?? c.user?.email ?? '—',
          },
          { key: 'primary_skill', header: 'Primary skill' },
          { key: 'visa_status', header: 'Visa' },
          {
            key: 'marketing_status',
            header: 'Status',
            render: (c: { marketing_status?: string | null }) => (
              <StatusBadge status={c.marketing_status ?? ''} />
            ),
          },
        ]}
        rows={consultants}
      />
    </Layout>
  );
}
