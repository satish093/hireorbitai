import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card, MetricTile, SectionHeader, Divider } from '../../src/components/ui/Card';
import {
  Pill,
  pillToneColor,
  APPLICATION_STATUS_TONE,
  TASK_STATUS_TONE,
  TASK_PRIORITY_TONE,
} from '../../src/components/ui/Pill';
import { StackedBar, LegendRow, BreakdownRow, type Segment } from '../../src/components/ui/Charts';
import { Button } from '../../src/components/ui/Button';
import { EmptyState, SkeletonMetricGrid, SkeletonList } from '../../src/components/ui/States';
import { useApiList, useApiQuery } from '../../src/hooks/useApi';
import { useAuth } from '../../src/context/AuthContext';
import {
  MANAGER_TIER,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUS_LABEL,
  type Application,
  type Consultant,
  type Interview,
} from '../../src/types';
import { useTheme } from '../../src/theme';

/** Task metrics payload from /tasks/metrics (mirror of the web ManagerDashboard). */
interface TaskMetrics {
  total: number;
  open: number;
  critical_open: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  overdue: number;
  due_today: number;
  due_this_week: number;
  completed_last_7_days: number;
}

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

/** "Monday, 28 Jul" — the date line the web dashboards show under the greeting. */
function todayLine(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

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
  // /tasks/metrics can 403 when the tasks module is off for this account; treat
  // any error as "no task section" rather than blocking the dashboard.
  const taskMetrics = useApiQuery<TaskMetrics>('/tasks/metrics', { channel: 'tasks' });
  const tasks = taskMetrics.error ? undefined : taskMetrics.data;

  const loading = consultants.loading || applications.loading;
  const refreshing = consultants.refreshing || applications.refreshing || taskMetrics.refreshing;
  const onRefresh = () => {
    void consultants.refetch();
    void applications.refetch();
    void taskMetrics.refetch();
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
      <PageHeader title={greeting(profile?.full_name)} subtitle={todayLine()} />

      {consultants.error && consultants.items.length === 0 ? (
        <Banner tone="danger" message={consultants.error} />
      ) : null}

      {tasks && tasks.critical_open > 0 ? (
        <Banner
          tone="danger"
          message={`${tasks.critical_open} critical task${tasks.critical_open > 1 ? 's' : ''} need${
            tasks.critical_open === 1 ? 's' : ''
          } attention${tasks.overdue > 0 ? ` · ${tasks.overdue} overdue` : ''}`}
        />
      ) : null}

      {loading ? (
        <SkeletonMetricGrid count={4} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <MetricTile label="Active bench" value={stats.active} accent="brand" />
          <MetricTile label="Placed" value={stats.placed} accent="green" tone="success" />
          <MetricTile label="Interviewing" value={stats.interviewing} accent="blue" />
          <MetricTile label="Offers" value={stats.offers} accent="green" tone="success" />
        </View>
      )}

      <TaskOverview tasks={tasks} loading={taskMetrics.loading} />

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

/**
 * Tasks-by-status stacked bar + by-priority breakdown — the mobile port of the
 * web ManagerDashboard's task widgets. Hidden entirely when /tasks/metrics is
 * unavailable or there are no tasks, matching the web's null-safe behaviour.
 */
function TaskOverview({ tasks, loading }: { tasks?: TaskMetrics; loading?: boolean }) {
  const { colors } = useTheme();

  if (loading && !tasks) return null;
  if (!tasks || tasks.total === 0) return null;

  const statusSegments: Segment[] = TASK_STATUSES.map((s) => ({
    key: s,
    value: tasks.by_status[s] ?? 0,
    label: TASK_STATUS_LABEL[s] ?? s,
    color: pillToneColor(TASK_STATUS_TONE[s] ?? 'neutral', colors),
  })).filter((seg) => seg.value > 0);

  const priorityTotal = TASK_PRIORITIES.reduce((sum, p) => sum + (tasks.by_priority[p] ?? 0), 0);

  return (
    <Card>
      <SectionHeader
        title="Tasks by status"
        subtitle={`${tasks.open} open · ${tasks.total} total`}
      />
      <StackedBar segments={statusSegments} />
      <LegendRow segments={statusSegments} />

      <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 16 }} />

      <SectionHeader title="By priority" />
      <View style={{ gap: 10 }}>
        {TASK_PRIORITIES.map((p) => (
          <BreakdownRow
            key={p}
            label={PRIORITY_LABEL[p] ?? p}
            value={tasks.by_priority[p] ?? 0}
            total={priorityTotal}
            color={pillToneColor(
              p === 'CRITICAL' ? 'danger' : (TASK_PRIORITY_TONE[p] ?? 'neutral'),
              colors,
            )}
          />
        ))}
      </View>
    </Card>
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
      <PageHeader title={greeting(profile?.full_name)} subtitle={todayLine()} />

      {consultants.loading ? (
        <SkeletonMetricGrid count={3} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <MetricTile label="My consultants" value={consultants.items.length} accent="brand" />
          <MetricTile label="Submitted (7d)" value={submittedThisWeek} accent="blue" />
          <MetricTile
            label="Interviewing"
            value={applications.items.filter((a) => a.status === 'INTERVIEW').length}
            accent="green"
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
      <PageHeader title={greeting(profile?.full_name)} subtitle={todayLine()} />

      {applications.loading ? (
        <SkeletonMetricGrid count={3} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <MetricTile label="Submissions" value={applications.items.length} accent="brand" />
          <MetricTile
            label="Interviews"
            value={applications.items.filter((a) => a.status === 'INTERVIEW').length}
            accent="blue"
          />
          <MetricTile
            label="Offers"
            value={applications.items.filter((a) => a.status === 'OFFER').length}
            accent="green"
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
