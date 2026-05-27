import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { SkeletonMetricGrid } from '../components/Skeleton';
import { useDashboardData } from '../components/dashboard/useDashboardData';
import { MetricRow } from '../components/dashboard/MetricRow';
import { UrgentRibbon } from '../components/dashboard/UrgentRibbon';
import { useUrgentItems } from '../components/dashboard/useUrgentItems';
import { NeedsAttentionStrip } from '../components/dashboard/NeedsAttentionStrip';
import { ActivityStream } from '../components/dashboard/ActivityStream';
import { TodaysFocus } from '../components/dashboard/TodaysFocus';
import { WeeklyGoals } from '../components/dashboard/WeeklyGoals';
import { PipelineCard } from '../components/dashboard/PipelineCard';
import { SubmissionsReport } from '../components/reports/SubmissionsReport';

/**
 * Recruiter command center. Above the fold it answers, top to bottom:
 * what's burning (UrgentRibbon) · the numbers (MetricRow) · who needs me
 * (NeedsAttentionStrip) · what happened (ActivityStream) · what's next +
 * am I on track (TodaysFocus / WeeklyGoals) · pipeline health (PipelineCard).
 */
export function RecruiterDashboard() {
  const navigate = useNavigate();
  const { profile, consultants, apps, loading } = useDashboardData();
  const urgent = useUrgentItems(consultants, apps);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const first = profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : '';
  const firstLoad = loading && consultants.length === 0 && apps.length === 0;

  return (
    <Layout title="Dashboard">
      <PageHeader
        title={`Welcome${first}`}
        description={today}
        action={
          <>
            {/* Recruiters can't create consultants directly — they invite them.
                Route to the invitation flow, not the read-only bench. */}
            <Button variant="outline" onClick={() => navigate('/invitations')}>
              Invite consultant
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

      <div className="space-y-6">
        <UrgentRibbon items={urgent} />

        {firstLoad ? (
          <SkeletonMetricGrid count={4} />
        ) : (
          <MetricRow consultants={consultants} apps={apps} />
        )}

        <NeedsAttentionStrip consultants={consultants} apps={apps} />

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
          <ActivityStream />
          <div className="space-y-6">
            <TodaysFocus />
            <WeeklyGoals consultants={consultants} apps={apps} />
          </div>
        </div>

        <PipelineCard apps={apps} consultants={consultants} />

        {/* Self-service submission stats. The backend scopes these endpoints to
            the recruiter's own assigned consultants/submissions. */}
        <section>
          <h2 className="text-sm font-semibold text-ink mb-3">My submissions</h2>
          <SubmissionsReport showByRecruiter={false} />
        </section>
      </div>
    </Layout>
  );
}
