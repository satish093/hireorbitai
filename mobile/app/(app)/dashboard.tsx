import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Card, MetricTile, SectionHeader, Divider } from '../../src/components/ui/Card';
import { Pill, APPLICATION_STATUS_TONE } from '../../src/components/ui/Pill';
import { BreakdownRow } from '../../src/components/ui/Charts';
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
  type TaskStatus,
  type TaskPriority,
} from '../../src/types';
import { useTheme, type Palette } from '../../src/theme';
import { longDate } from '../../src/utils/format';

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

/** Portfolio rollup from /reports/manager-summary (mirror of the web ManagerDashboard). */
interface Summary {
  consultants_by_status: Record<string, number>;
  recruiters_count: number;
  active_jobs: number;
  last_7_day_applications: number;
  applications_by_status: Record<string, number>;
}

/** Coerce a possibly-partial /reports/manager-summary body into a full Summary. */
function normalizeSummary(d: unknown): Summary {
  const o = (d ?? {}) as Partial<Summary>;
  const rec = (v: unknown): Record<string, number> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    consultants_by_status: rec(o.consultants_by_status),
    recruiters_count: num(o.recruiters_count),
    active_jobs: num(o.active_jobs),
    last_7_day_applications: num(o.last_7_day_applications),
    applications_by_status: rec(o.applications_by_status),
  };
}

const WEEKDAYS_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "TUESDAY · JULY 28, 2026" — the uppercase date line under the greeting (Intl-free). */
function bigDateLine(d: Date = new Date()): string {
  const dow = (WEEKDAYS_FULL[d.getDay()] ?? '').toUpperCase();
  const md = `${MONTHS_FULL[d.getMonth()] ?? ''} ${d.getDate()}, ${d.getFullYear()}`.toUpperCase();
  return `${dow} · ${md}`;
}

/**
 * Dashboard — one route, three role variants (see the original file header for
 * why the three web pages collapse into one screen here).
 */
export default function DashboardScreen() {
  const { profile } = useAuth();
  const role = profile?.role;

  if (role === 'CONSULTANT') return <ConsultantDashboard />;
  if (role && (MANAGER_TIER as readonly string[]).includes(role)) return <ManagerDashboard />;
  if (role === 'RECRUITER') return <RecruiterDashboard />;
  return <MinimalDashboard />;
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function firstName(profile?: { full_name?: string; email?: string } | null): string {
  const fromName = (profile?.full_name ?? '').trim().split(/\s+/)[0];
  if (fromName) return fromName;
  return (profile?.email ?? '').split('@')[0] || 'there';
}

/** "Good evening, satish" — greeting + first name, matching the web. */
function greeting(profile?: { full_name?: string; email?: string } | null): string {
  return `${timeGreeting()}, ${firstName(profile)}`;
}

/**
 * Fixed-header scroll shell — SafeAreaView top inset, the site-style PageTopBar,
 * then a padded pull-to-refresh scroll body. Used by every dashboard variant so
 * the chrome matches the website on all of them.
 */
function DashScreen({
  title,
  subtitle,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  subtitle?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Screen edges={['top']}>
      <PageTopBar title={title} subtitle={subtitle} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Manager / admin tier
// ---------------------------------------------------------------------------
function ManagerDashboard() {
  const { profile } = useAuth();
  const { colors, spacing, fontSize } = useTheme();

  const summaryQ = useApiQuery('/reports/manager-summary', {
    channel: 'reports',
    select: normalizeSummary,
  });
  // /tasks/metrics can 403 when the tasks module is off — treat any error as
  // "no task section" rather than blocking the dashboard.
  const taskMetrics = useApiQuery<TaskMetrics>('/tasks/metrics', { channel: 'tasks' });
  const tasks = taskMetrics.error ? undefined : taskMetrics.data;
  const summary = summaryQ.data;

  const loadingTop = taskMetrics.loading && summaryQ.loading;
  const refreshing = summaryQ.refreshing || taskMetrics.refreshing;
  const onRefresh = () => {
    void summaryQ.refetch();
    void taskMetrics.refetch();
  };

  return (
    <DashScreen title="Manager dashboard" refreshing={refreshing} onRefresh={onRefresh}>
      {tasks && tasks.critical_open > 0 ? <CriticalBanner count={tasks.critical_open} /> : null}

      {/* Greeting */}
      <View>
        <Text
          style={{
            fontSize: fontSize.xs,
            fontWeight: '700',
            letterSpacing: 1.4,
            color: colors.muted,
          }}
        >
          {bigDateLine()}
        </Text>
        <Text
          style={{
            fontSize: fontSize['2xl'],
            fontWeight: '800',
            color: colors.ink,
            marginTop: spacing.sm,
          }}
        >
          {greeting(profile)}.
        </Text>
        {tasks ? (
          <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.sm }}>
            Your team has{' '}
            <Text style={{ fontWeight: '700', color: colors.ink }}>{tasks.open} open tasks</Text>,{' '}
            <Text
              style={{ fontWeight: '700', color: tasks.overdue > 0 ? colors.danger : colors.ink }}
            >
              {tasks.overdue} overdue
            </Text>
            , and{' '}
            <Text
              style={{ fontWeight: '700', color: tasks.due_today > 0 ? colors.warn : colors.ink }}
            >
              {tasks.due_today} due today
            </Text>
            .
          </Text>
        ) : (
          <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.sm }}>
            Welcome to your control center.
          </Text>
        )}
      </View>

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="↻ Manage jobs" variant="secondary" href="/(app)/jobs" block={false} />
        <Button
          label="+ New task"
          variant="primary"
          href={{ pathname: '/(app)/tasks', params: { new: '1' } }}
          block={false}
        />
      </View>

      {/* Task KPIs */}
      {loadingTop ? (
        <SkeletonMetricGrid count={4} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <MetricTile
            label="Open tasks"
            value={tasks?.open ?? 0}
            hint={tasks ? `${tasks.total} total` : 'Run tasks migration'}
            accent="slate"
          />
          <MetricTile
            label="Overdue"
            value={tasks?.overdue ?? 0}
            hint={tasks?.critical_open ? `${tasks.critical_open} critical` : undefined}
            accent="red"
            tone="danger"
          />
          <MetricTile
            label="Due this week"
            value={tasks?.due_this_week ?? 0}
            hint={summary ? `${summary.recruiters_count} recruiters` : undefined}
            accent="amber"
          />
          <MetricTile
            label="Completed (7d)"
            value={tasks?.completed_last_7_days ?? 0}
            delta="last 7 days"
            up
            accent="green"
            tone="success"
          />
        </View>
      )}

      {tasks && tasks.total > 0 ? <TasksByStatusCard tasks={tasks} /> : null}
      {tasks && tasks.total > 0 ? <ByPriorityCard tasks={tasks} /> : null}

      {/* Portfolio KPIs */}
      {summaryQ.loading ? (
        <SkeletonMetricGrid count={4} />
      ) : summary ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <MetricTile
            label="Active consultants"
            value={summary.consultants_by_status.ACTIVE ?? 0}
            accent="green"
          />
          <MetricTile
            label="Paused"
            value={summary.consultants_by_status.PAUSED ?? 0}
            accent="amber"
          />
          <MetricTile
            label="Placed"
            value={summary.consultants_by_status.PLACED ?? 0}
            accent="blue"
          />
          <MetricTile label="Active jobs" value={summary.active_jobs} accent="brand" />
        </View>
      ) : null}

      {summary ? (
        <Card>
          <SectionHeader
            title="Applications by status"
            action={<Text style={{ fontSize: fontSize.xs, color: colors.muted }}>last 7 days</Text>}
          />
          {Object.keys(summary.applications_by_status).length === 0 ? (
            <Text style={{ fontSize: fontSize.sm, color: colors.muted, fontStyle: 'italic' }}>
              No applications in the last 7 days.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {Object.entries(summary.applications_by_status).map(([k, v]) => (
                <View key={k} style={{ width: '50%', paddingVertical: spacing.sm }}>
                  <Text
                    style={{
                      fontSize: fontSize.xs,
                      color: colors.muted,
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                      fontWeight: '700',
                    }}
                  >
                    {k.replace(/_/g, ' ')}
                  </Text>
                  <Text
                    style={{
                      fontSize: fontSize.xl,
                      fontWeight: '800',
                      color: colors.ink,
                      marginTop: 2,
                    }}
                  >
                    {v}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      ) : null}
    </DashScreen>
  );
}

/** Dark-red critical-task ribbon — a dot + bold count + "View →", tap → tasks. */
function CriticalBanner({ count }: { count: number }) {
  const { colors, radius, spacing, fontSize } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/(app)/tasks')}
      accessibilityRole="button"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: colors.dangerSoft,
        borderRadius: radius.lg,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
      }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }} />
      <Text style={{ flex: 1, fontSize: fontSize.sm, color: colors.ink }}>
        <Text style={{ fontWeight: '700' }}>
          {count} critical task{count > 1 ? 's' : ''}
        </Text>
        {` need${count === 1 ? 's' : ''} attention`}
      </Text>
      <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: colors.danger }}>View →</Text>
    </Pressable>
  );
}

/** Solid dot colour for a task status — themed, matching the web status dots. */
function statusDotColor(s: TaskStatus, c: Palette): string {
  switch (s) {
    case 'TODO':
      return c.brandFrom; // blue
    case 'IN_PROGRESS':
      return c.accent; // indigo
    case 'BLOCKED':
      return c.danger; // red
    case 'REVIEW':
      return c.brandTo; // purple
    case 'COMPLETED':
      return c.success; // green
    case 'BACKLOG':
    case 'CANCELLED':
    default:
      return c.faint; // grey
  }
}

/** Solid colour for a task priority — themed, matching the web priority chart. */
function priorityColor(p: TaskPriority, c: Palette): string {
  switch (p) {
    case 'CRITICAL':
      return c.danger; // red
    case 'HIGH':
      return c.warn; // orange
    case 'MEDIUM':
      return c.accent; // indigo
    case 'LOW':
    default:
      return c.brandFrom; // blue
  }
}

/** "Tasks by status" — a dot-grid of {colored dot + UPPERCASE label + big count}. */
function TasksByStatusCard({ tasks }: { tasks: TaskMetrics }) {
  const { colors, fontSize } = useTheme();
  return (
    <Card>
      <SectionHeader
        title="Tasks by status"
        subtitle="Last 30 days"
        action={<Text style={{ fontSize: fontSize.xs, color: colors.muted }}>across team</Text>}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {TASK_STATUSES.map((s) => (
          <View key={s} style={{ width: '33.33%', paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: statusDotColor(s, colors),
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  fontSize: fontSize.xs,
                  color: colors.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                {TASK_STATUS_LABEL[s]}
              </Text>
            </View>
            <Text
              style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.ink, marginTop: 2 }}
            >
              {tasks.by_status[s] ?? 0}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** "By priority" — Critical→Low rows with a proportional coloured bar. */
function ByPriorityCard({ tasks }: { tasks: TaskMetrics }) {
  const { colors, spacing } = useTheme();
  const max = Math.max(1, ...TASK_PRIORITIES.map((p) => tasks.by_priority[p] ?? 0));
  return (
    <Card>
      <SectionHeader title="By priority" subtitle="All tasks" />
      <View style={{ gap: spacing.md }}>
        {TASK_PRIORITIES.slice()
          .reverse()
          .map((p) => (
            <BreakdownRow
              key={p}
              label={p.charAt(0) + p.slice(1).toLowerCase()}
              value={tasks.by_priority[p] ?? 0}
              total={max}
              color={priorityColor(p, colors)}
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
    <DashScreen
      title={greeting(profile)}
      subtitle={longDate()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
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
    </DashScreen>
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
    <DashScreen
      title={greeting(profile)}
      subtitle={longDate()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
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
    </DashScreen>
  );
}

/**
 * Fallback for a role with no tier membership (today: DEVELOPER). Showing empty
 * pipeline metrics would be misleading, so it links to the messenger instead.
 */
function MinimalDashboard() {
  const { profile } = useAuth();
  return (
    <DashScreen title={greeting(profile)} subtitle={longDate()}>
      <Card>
        <EmptyState
          compact
          title="No modules enabled"
          description="Your account doesn't have a business module assigned. Messaging is available so you can reach the team."
        />
        <Button label="Open messages" href="/(app)/messages" variant="secondary" />
      </Card>
    </DashScreen>
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
