import { Stack, useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Card, MetricTile, SectionHeader, Divider } from '../../../src/components/ui/Card';
import { Pill, type PillTone } from '../../../src/components/ui/Pill';
import { SkeletonMetricGrid, EmptyState } from '../../../src/components/ui/States';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiQuery } from '../../../src/hooks/useApi';
import { MANAGER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { relativeDate } from '../../../src/utils/format';

interface ActiveCourse {
  id: string;
  title: string;
  category: string;
  content_status: string;
  updated_at: string;
  total_lessons: number;
  ready_lessons: number;
  failed_lessons: number;
  pending_lessons: number;
  generating_lessons: number;
}
interface ActiveLesson {
  id: string;
  title: string;
  content_status: string;
  updated_at: string;
  course_id: string;
  course_title: string;
}
interface GenerationStatus {
  course_stats: Record<string, number>;
  lesson_stats: Record<string, number>;
  active_courses: ActiveCourse[];
  active_lessons: ActiveLesson[];
}

/**
 * AI generation activity — GET /training/ai/generation-status. MANAGER_TIER.
 *
 * Course generation is long-running and can fail partway. This is the live
 * status board: per-status counts plus the courses/lessons currently
 * generating, pending, or failed. Read-only on mobile — retry/regenerate are
 * admin actions kept on the web console.
 */
export default function TrainingAIActivityScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <AIActivity />
    </RouteGuard>
  );
}

function toneFor(status?: string | null): PillTone {
  const s = (status ?? '').toUpperCase();
  if (s === 'FAILED') return 'danger';
  if (s === 'GENERATING' || s === 'PENDING') return 'warn';
  if (s === 'READY') return 'success';
  return 'neutral';
}

function AIActivity() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();

  const { data, loading, refreshing, error, onRefresh } = useApiQuery<GenerationStatus>(
    '/training/ai/generation-status',
    { channel: 'training' },
  );

  const courseStats = data?.course_stats ?? {};
  const lessonStats = data?.lesson_stats ?? {};
  const totalCourses = Object.values(courseStats).reduce((s, v) => s + v, 0);
  const totalLessons = Object.values(lessonStats).reduce((s, v) => s + v, 0);
  const generating = (courseStats.GENERATING ?? 0) + (lessonStats.GENERATING ?? 0);
  const failed = (courseStats.FAILED ?? 0) + (lessonStats.FAILED ?? 0);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar title="AI activity" subtitle="Content generation status" />
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
              <MetricTile label="Courses" value={totalCourses} accent="slate" />
              <MetricTile label="Lessons" value={totalLessons} accent="slate" />
              <MetricTile
                label="Generating"
                value={generating}
                accent="blue"
                tone={generating > 0 ? 'warn' : 'default'}
              />
              <MetricTile
                label="Needs retry"
                value={failed}
                accent="red"
                tone={failed > 0 ? 'danger' : 'default'}
              />
            </View>

            {Object.keys(lessonStats).length > 0 ? (
              <Card>
                <SectionHeader title="Lessons by status" />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(lessonStats)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => (
                      <Pill
                        key={status}
                        label={`${status.toLowerCase()} · ${count}`}
                        tone={toneFor(status)}
                        size="sm"
                      />
                    ))}
                </View>
              </Card>
            ) : null}

            <Card padded={false}>
              <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                <SectionHeader title="In-progress / failed lessons" />
              </View>
              {data.active_lessons.length === 0 ? (
                <View style={{ paddingBottom: spacing.lg }}>
                  <EmptyState compact title="No active generations" />
                </View>
              ) : (
                data.active_lessons.map((l, i) => (
                  <View key={l.id}>
                    {i > 0 ? <Divider inset={spacing.lg} /> : null}
                    <Card
                      padded={false}
                      onPress={() => router.push(`/(app)/training/course/${l.course_id}`)}
                      style={{ backgroundColor: 'transparent', borderWidth: 0 }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: spacing.md,
                          paddingHorizontal: spacing.lg,
                          paddingVertical: spacing.md,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            numberOfLines={1}
                            style={{
                              fontSize: fontSize.base,
                              fontWeight: '600',
                              color: colors.ink,
                            }}
                          >
                            {l.title}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}
                          >
                            {l.course_title} · {relativeDate(l.updated_at)}
                          </Text>
                        </View>
                        <Pill
                          label={l.content_status.toLowerCase()}
                          tone={toneFor(l.content_status)}
                          size="sm"
                        />
                      </View>
                    </Card>
                  </View>
                ))
              )}
            </Card>

            {data.active_courses.length > 0 ? (
              <Card padded={false}>
                <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                  <SectionHeader title="Courses generating" />
                </View>
                {data.active_courses.map((c, i) => {
                  const pct =
                    c.total_lessons > 0 ? Math.round((c.ready_lessons / c.total_lessons) * 100) : 0;
                  return (
                    <View key={c.id}>
                      {i > 0 ? <Divider inset={spacing.lg} /> : null}
                      <Card
                        padded={false}
                        onPress={() => router.push(`/(app)/training/course/${c.id}`)}
                        style={{ backgroundColor: 'transparent', borderWidth: 0 }}
                      >
                        <View
                          style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}
                        >
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: spacing.md,
                            }}
                          >
                            <Text
                              numberOfLines={1}
                              style={{
                                flex: 1,
                                fontSize: fontSize.base,
                                fontWeight: '600',
                                color: colors.ink,
                              }}
                            >
                              {c.title}
                            </Text>
                            <Pill
                              label={c.content_status.toLowerCase()}
                              tone={toneFor(c.content_status)}
                              size="sm"
                            />
                          </View>
                          <View
                            style={{
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: colors.hover,
                              overflow: 'hidden',
                              marginTop: spacing.sm,
                            }}
                          >
                            <View
                              style={{
                                width: `${pct}%`,
                                height: '100%',
                                backgroundColor: colors.success,
                              }}
                            />
                          </View>
                          <Text
                            style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 4 }}
                          >
                            {c.ready_lessons}/{c.total_lessons} ready
                            {c.failed_lessons > 0 ? ` · ${c.failed_lessons} failed` : ''}
                            {c.pending_lessons > 0 ? ` · ${c.pending_lessons} pending` : ''}
                          </Text>
                        </View>
                      </Card>
                    </View>
                  );
                })}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
