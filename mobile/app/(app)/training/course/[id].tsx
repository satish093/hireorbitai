import { Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScreenScroll, Banner } from '../../../../src/components/ui/Screen';
import { Card, SectionHeader, DetailRow, Divider } from '../../../../src/components/ui/Card';
import { Pill } from '../../../../src/components/ui/Pill';
import { SkeletonCard, ErrorState, EmptyState } from '../../../../src/components/ui/States';
import { RouteGuard } from '../../../../src/components/RouteGuard';
import { useApiQuery } from '../../../../src/hooks/useApi';
import { BUSINESS_ROLES, type TrainingCourse, type TrainingLesson } from '../../../../src/types';
import { useTheme } from '../../../../src/theme';

/**
 * Course detail — GET /training/courses/:id.
 *
 * The endpoint returns the course plus its lessons. Lesson bodies can be very
 * long (the AI-generated content SQL files run to 60+ KB per course), so this
 * screen lists the lesson outline and leaves the body to the lesson viewer
 * rather than rendering everything into one enormous scroll.
 */
export default function CourseDetailScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="training">
      <CourseDetail />
    </RouteGuard>
  );
}

interface CourseResponse extends TrainingCourse {
  lessons?: TrainingLesson[];
}

function CourseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, fontSize } = useTheme();

  const { data, loading, refreshing, error, onRefresh, refetch } = useApiQuery<CourseResponse>(
    id ? `/training/courses/${id}` : null,
    { channel: 'training', enabled: !!id },
  );

  const lessons = [...(data?.lessons ?? [])].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Course' }} />
      <ScreenScroll refreshing={refreshing} onRefresh={onRefresh} edges={[]}>
        {loading && !data ? (
          <SkeletonCard />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : !data ? (
          <Banner tone="warn" message="This course is no longer available." />
        ) : (
          <>
            <Card>
              <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: colors.ink }}>
                {data.title}
              </Text>
              {data.description ? (
                <Text
                  style={{
                    fontSize: fontSize.base,
                    color: colors.ink2,
                    lineHeight: 22,
                    marginTop: spacing.sm,
                  }}
                >
                  {data.description}
                </Text>
              ) : null}
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}
              >
                {data.category ? <Pill label={data.category} tone="brand" size="sm" /> : null}
                <Pill
                  label={data.is_published ? 'Published' : 'Draft'}
                  tone={data.is_published ? 'success' : 'neutral'}
                  size="sm"
                />
                <Pill
                  label={`${lessons.length || (data.lesson_count ?? 0)} lessons`}
                  tone="info"
                  size="sm"
                />
              </View>
            </Card>

            <Card padded={false}>
              <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                <SectionHeader title="Lessons" />
              </View>

              {lessons.length === 0 ? (
                <View style={{ paddingBottom: spacing.lg }}>
                  <EmptyState
                    compact
                    title="No lessons yet"
                    description="This course hasn't had its content generated."
                  />
                </View>
              ) : (
                lessons.map((lesson, i) => (
                  <View key={lesson.id}>
                    {i > 0 ? <Divider inset={spacing.lg} /> : null}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.md,
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.md,
                        minHeight: 52,
                      }}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: colors.hover,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text
                          style={{ fontSize: fontSize.xs, fontWeight: '700', color: colors.muted }}
                        >
                          {i + 1}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={2}
                          style={{ fontSize: fontSize.base, color: colors.ink }}
                        >
                          {lesson.title}
                        </Text>
                        {lesson.duration_minutes ? (
                          <Text
                            style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}
                          >
                            {lesson.duration_minutes} min
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ))
              )}
            </Card>

            <Card>
              <SectionHeader title="About" />
              <DetailRow label="Category" value={data.category ?? '—'} />
              <Divider />
              <DetailRow label="Created" value={new Date(data.created_at).toLocaleDateString()} />
            </Card>
          </>
        )}
      </ScreenScroll>
    </>
  );
}
