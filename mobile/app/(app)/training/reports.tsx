import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Card, MetricTile, SectionHeader, Divider } from '../../../src/components/ui/Card';
import {
  StackedBar,
  LegendRow,
  BreakdownRow,
  type Segment,
} from '../../../src/components/ui/Charts';
import { SkeletonMetricGrid, EmptyState } from '../../../src/components/ui/States';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiQuery } from '../../../src/hooks/useApi';
import { MANAGER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface Reports {
  total_courses: number;
  active_courses: number;
  total_assignments: number;
  completed_assignments: number;
  in_progress_assignments: number;
  overdue_assignments: number;
  failed_assignments: number;
  completion_rate: number;
  quiz_pass_rate: number;
  avg_time_spent_minutes: number;
  total_time_spent_minutes: number;
  top_consultants: Array<{ user_id: string; completed: number }>;
  by_category: Array<{ category: string; courses: number }>;
}

/**
 * Training reports — GET /training/reports. MANAGER_TIER.
 *
 * Workspace effectiveness roll-up: course catalog totals, assignment
 * completion, quiz pass rate, and per-category course counts. Group leads see
 * their group's slice (scoped server-side).
 */
export default function TrainingReportsScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <TrainingReports />
    </RouteGuard>
  );
}

function TrainingReports() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();

  const { data, loading, refreshing, error, onRefresh } = useApiQuery<Reports>(
    '/training/reports',
    {
      channel: 'training',
    },
  );

  const statusSegments: Segment[] = data
    ? [
        {
          key: 'completed',
          label: 'Completed',
          value: data.completed_assignments,
          color: colors.success,
        },
        {
          key: 'in_progress',
          label: 'In progress',
          value: data.in_progress_assignments,
          color: colors.accent,
        },
        { key: 'overdue', label: 'Overdue', value: data.overdue_assignments, color: colors.danger },
        { key: 'failed', label: 'Failed', value: data.failed_assignments, color: colors.warn },
      ]
    : [];
  const maxCat = data ? Math.max(1, ...data.by_category.map((c) => c.courses)) : 1;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar
        title="Training reports"
        subtitle={data ? `${data.total_assignments} assignments` : 'Workspace effectiveness'}
      />
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          gap: spacing.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {error ? <Banner tone="danger" message={error} /> : null}

        {loading && !data ? (
          <SkeletonMetricGrid count={4} />
        ) : !data ? null : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
              <MetricTile
                label="Active courses"
                value={`${data.active_courses}/${data.total_courses}`}
                accent="blue"
              />
              <MetricTile label="Assignments" value={data.total_assignments} accent="slate" />
              <MetricTile
                label="Completed"
                value={data.completed_assignments}
                accent="green"
                tone="success"
              />
              <MetricTile
                label="Overdue"
                value={data.overdue_assignments}
                accent="amber"
                tone={data.overdue_assignments > 0 ? 'warn' : 'default'}
              />
              <MetricTile label="Completion" value={`${data.completion_rate}%`} accent="brand" />
              <MetricTile label="Quiz pass rate" value={`${data.quiz_pass_rate}%`} accent="brand" />
            </View>

            <Card>
              <SectionHeader
                title="Assignment status"
                subtitle={`${data.avg_time_spent_minutes} min avg time spent`}
              />
              <StackedBar segments={statusSegments} height={10} />
              <LegendRow segments={statusSegments} />
            </Card>

            <Card>
              <SectionHeader title="Courses by category" />
              {data.by_category.length === 0 ? (
                <EmptyState compact title="No courses yet" />
              ) : (
                <View style={{ gap: spacing.md }}>
                  {[...data.by_category]
                    .sort((a, b) => b.courses - a.courses)
                    .map((c) => (
                      <BreakdownRow
                        key={c.category}
                        label={c.category}
                        value={c.courses}
                        total={maxCat}
                        color={colors.accent}
                      />
                    ))}
                </View>
              )}
            </Card>

            <Card padded={false}>
              <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                <SectionHeader title="Top by completions" />
              </View>
              {data.top_consultants.length === 0 ? (
                <View style={{ paddingBottom: spacing.lg }}>
                  <EmptyState compact title="No completions yet" />
                </View>
              ) : (
                data.top_consultants.map((t, i) => (
                  <View key={t.user_id}>
                    {i > 0 ? <Divider inset={spacing.lg} /> : null}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.md,
                      }}
                    >
                      <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
                        {t.user_id.slice(0, 8)}…
                      </Text>
                      <Text
                        style={{ fontSize: fontSize.base, fontWeight: '700', color: colors.ink }}
                      >
                        {t.completed}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
