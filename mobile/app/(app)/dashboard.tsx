import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card, MetricTile, SectionHeader, Divider } from '../../src/components/ui/Card';
import { Pill, APPLICATION_STATUS_TONE } from '../../src/components/ui/Pill';
import { Button } from '../../src/components/ui/Button';
import { EmptyState, SkeletonMetricGrid, SkeletonList } from '../../src/components/ui/States';
import { useApiList } from '../../src/hooks/useApi';
import { useAuth } from '../../src/context/AuthContext';
import { MANAGER_TIER, type Application, type Consultant, type Interview } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Dashboard — one route, three role variants.
 *
 * The web ships three separate lazy-loaded pages (ManagerDashboard,
 * RecruiterDashboard, ConsultantDashboard) because a browser downloads code per
 * route. A mobile bundle is downloaded once at install, so splitting gains
 * nothing; branching in one file keeps the shared chrome in one place.
 *
 * What does NOT change is which endpoints each role is allowed to call. A
 * CONSULTANT hits /applications/mine (self-scoped, narrowed projection); an
 * operator hits /applications (full recruiter-side context). That split is
 * enforced server-side — this is just the client asking the right question.
 */
export default function DashboardScreen() {
  const { profile } = useAuth();
  const role = profile?.role;

  if (role === 'CONSULTANT') return <ConsultantDashboard />;
  if (role && (MANAGER_TIER as readonly string[]).includes(role)) return <ManagerDashboard />;
  if (role === 'RECRUITER') return <RecruiterDashboard />;
  return <MinimalDashboard />;
}

function greeting(name?: string | null): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

// ---------------------------------------------------------------------------
// Manager / admin tier
// ---------------------------------------------------------------------------
function ManagerDashboard() {
  const { profile } = useAuth();
  const consultants = useApiList<Consultant>('/consultants', { channel: 'consultants' });
  const applications = useApiList<Application>('/applications', { channel: 'applications' });

  const loading = consultants.loading || applications.loading;
  const refreshing = consultants.refreshing || applications.refreshing;
  const onRefresh = () => {
    void consultants.refetch();
    void applications.refetch();
  };

  const stats = useMemo(() => {
    const active = consultants.items.filter((c) => c.marketing_status === 'ACTIVE').length;
    const placed = consultants.items.filter((c) => c.marketing_status === 'PLACED').length;
    const interviewing = applications.items.filter((a) => a.status === 'INTERVIEW').length;
    const offers = applications.items.filter((a) => a.status === 'OFFER').length;
    return { active, placed, interviewing, offers };
  }, [consultants.items, applications.items]);

  return (
    <ScreenScroll refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title={greeting(profile?.full_name)} subtitle="Team overview" />

      {consultants.error && consultants.items.length === 0 ? (
        <Banner tone="danger" message={consultants.error} />
      ) : null}

      {loading ? (
        <SkeletonMetricGrid count={4} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <MetricTile label="Active bench" value={stats.active} />
          <MetricTile label="Placed" value={stats.placed} tone="success" />
          <MetricTile label="Interviewing" value={stats.interviewing} />
          <MetricTile label="Offers" value={stats.offers} tone="success" />
        </View>
      )}

      <RecentApplications
        items={applications.items}
        loading={applications.loading}
        title="Recent submissions"
      />

      <Card>
        <SectionHeader title="Jump back in" />
        <View style={{ gap: 8 }}>
          <Button label="Consultants" href="/(app)/consultants" variant="secondary" />
          <Button label="Applications" href="/(app)/applications" variant="secondary" />
          <Button label="Tasks" href="/(app)/tasks" variant="secondary" />
        </View>
      </Card>
    </ScreenScroll>
  );
}

// ---------------------------------------------------------------------------
// Recruiter
// ---------------------------------------------------------------------------
function RecruiterDashboard() {
  const { profile } = useAuth();
  const consultants = useApiList<Consultant>('/consultants', { channel: 'consultants' });
  const applications = useApiList<Application>('/applications', { channel: 'applications' });

  const refreshing = consultants.refreshing || applications.refreshing;
  const onRefresh = () => {
    void consultants.refetch();
    void applications.refetch();
  };

  const submittedThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return applications.items.filter((a) => {
      const at = a.applied_at ?? a.created_at;
      return at ? new Date(at).getTime() >= weekAgo : false;
    }).length;
  }, [applications.items]);

  return (
    <ScreenScroll refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title={greeting(profile?.full_name)} subtitle="Your pipeline" />

      {consultants.loading ? (
        <SkeletonMetricGrid count={3} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <MetricTile label="My consultants" value={consultants.items.length} />
          <MetricTile label="Submitted (7d)" value={submittedThisWeek} />
          <MetricTile
            label="Interviewing"
            value={applications.items.filter((a) => a.status === 'INTERVIEW').length}
          />
        </View>
      )}

      <RecentApplications
        items={applications.items}
        loading={applications.loading}
        title="Recent submissions"
      />

      <Card>
        <SectionHeader title="Quick actions" />
        <View style={{ gap: 8 }}>
          <Button label="Find jobs" href="/(app)/jobs" variant="secondary" />
          <Button label="My consultants" href="/(app)/consultants" variant="secondary" />
          <Button label="Tasks" href="/(app)/tasks" variant="secondary" />
        </View>
      </Card>
    </ScreenScroll>
  );
}

// ---------------------------------------------------------------------------
// Consultant
// ---------------------------------------------------------------------------
function ConsultantDashboard() {
  const { profile } = useAuth();
  const { colors, fontSize } = useTheme();

  // Self-scoped endpoint with a narrowed projection — a consultant must never
  // see recruiter-side context (assigned recruiter, internal notes, ATS scores).
  const applications = useApiList<Application>('/applications/mine', { channel: 'applications' });
  const interviews = useApiList<Interview>('/interviews', {
    channel: 'interviews',
    params: profile?.consultant_id ? { consultant_id: profile.consultant_id } : undefined,
    enabled: !!profile?.consultant_id,
  });

  const upcoming = useMemo(
    () =>
      interviews.items
        .filter((i) => i.status === 'SCHEDULED' && i.scheduled_at)
        .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
        .slice(0, 3),
    [interviews.items],
  );

  const refreshing = applications.refreshing || interviews.refreshing;
  const onRefresh = () => {
    void applications.refetch();
    void interviews.refetch();
  };

  return (
    <ScreenScroll refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title={greeting(profile?.full_name)} subtitle="Your search at a glance" />

      {applications.loading ? (
        <SkeletonMetricGrid count={3} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <MetricTile label="Submissions" value={applications.items.length} />
          <MetricTile
            label="Interviews"
            value={applications.items.filter((a) => a.status === 'INTERVIEW').length}
          />
          <MetricTile
            label="Offers"
            value={applications.items.filter((a) => a.status === 'OFFER').length}
            tone="success"
          />
        </View>
      )}

      <Card>
        <SectionHeader title="Upcoming interviews" />
        {interviews.loading ? (
          <SkeletonList count={2} />
        ) : upcoming.length === 0 ? (
          <EmptyState
            compact
            title="Nothing scheduled"
            description="Interviews your recruiter books will show up here."
          />
        ) : (
          upcoming.map((iv, i) => (
            <View key={iv.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: 10 }}>
                <Text style={{ fontSize: fontSize.base, color: colors.ink, fontWeight: '600' }}>
                  {iv.interview_type} interview
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                  {iv.scheduled_at ? new Date(iv.scheduled_at).toLocaleString() : 'Time TBC'}
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <RecentApplications
        items={applications.items}
        loading={applications.loading}
        title="My submissions"
      />

      <Card>
        <SectionHeader title="Keep moving" />
        <View style={{ gap: 8 }}>
          <Button label="My resume" href="/(app)/my-resume" variant="secondary" />
          <Button label="My training" href="/(app)/training/my" variant="secondary" />
          <Button label="Messages" href="/(app)/messages" variant="secondary" />
        </View>
      </Card>
    </ScreenScroll>
  );
}

/**
 * Fallback for a role with no tier membership — today that is DEVELOPER, whose
 * only default reach is the messenger (see MESSAGING_ROLES in
 * shared/src/roles.ts). Showing empty pipeline metrics would be misleading.
 */
function MinimalDashboard() {
  const { profile } = useAuth();
  return (
    <ScreenScroll>
      <PageHeader title={greeting(profile?.full_name)} />
      <Card>
        <EmptyState
          compact
          title="No modules enabled"
          description="Your account doesn't have a business module assigned. Messaging is available so you can reach the team."
          actionLabel="Open messages"
          onAction={() => {}}
        />
        <Button label="Open messages" href="/(app)/messages" variant="secondary" />
      </Card>
    </ScreenScroll>
  );
}

function RecentApplications({
  items,
  loading,
  title,
}: {
  items: Application[];
  loading?: boolean;
  title: string;
}) {
  const { colors, fontSize } = useTheme();
  const recent = items.slice(0, 5);

  return (
    <Card>
      <SectionHeader
        title={title}
        action={
          <Button
            label="See all"
            href="/(app)/applications"
            variant="ghost"
            size="sm"
            block={false}
          />
        }
      />
      {loading ? (
        <SkeletonList count={3} />
      ) : recent.length === 0 ? (
        <EmptyState compact title="No submissions yet" />
      ) : (
        recent.map((app, i) => (
          <View key={app.id}>
            {i > 0 ? <Divider /> : null}
            <View
              style={{
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.base, color: colors.ink, fontWeight: '600' }}
                >
                  {app.job?.title ?? 'Untitled role'}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {app.job?.company_name ?? '—'}
                </Text>
              </View>
              <Pill
                label={app.status}
                tone={APPLICATION_STATUS_TONE[app.status] ?? 'neutral'}
                size="sm"
              />
            </View>
          </View>
        ))
      )}
    </Card>
  );
}
