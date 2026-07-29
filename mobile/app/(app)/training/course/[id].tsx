import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../../src/components/ui/Screen';
import { PageTopBar } from '../../../../src/components/ui/TopBar';
import { Card, SectionHeader, DetailRow, Divider } from '../../../../src/components/ui/Card';
import { Pill } from '../../../../src/components/ui/Pill';
import { Button } from '../../../../src/components/ui/Button';
import { SkeletonCard, ErrorState, EmptyState } from '../../../../src/components/ui/States';
import { RouteGuard } from '../../../../src/components/RouteGuard';
import { useApiQuery } from '../../../../src/hooks/useApi';
import { useAuth } from '../../../../src/context/AuthContext';
import { BUSINESS_ROLES, MANAGER_TIER } from '../../../../src/types';
import { useTheme } from '../../../../src/theme';
import { shortDate } from '../../../../src/utils/format';

/**
 * Course detail — GET /training/courses/:id.
 *
 * The endpoint returns the course plus its `lessons` and `quizzes` arrays.
 * Lesson bodies can be very long, so this screen lists the lesson outline and
 * hands the body to the lesson viewer. When opened from My training the
 * assignmentId is threaded through so lesson progress + quiz attempts can be
 * recorded.
 */
export default function CourseDetailScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="training">
      <CourseDetail />
    </RouteGuard>
  );
}

interface Lesson {
  id: string;
  title: string;
  description?: string | null;
  content?: string | null;
  lesson_order?: number | null;
  estimated_minutes?: number | null;
}
interface RoadmapPhase {
  phase?: string;
  duration_label?: string;
  focus_areas?: string[];
}
interface CourseResponse {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  difficulty?: string | null;
  status?: string | null;
  overview?: string | null;
  roadmap?: RoadmapPhase[] | null;
  tags?: string[] | null;
  estimated_duration_hours?: number | null;
  created_at: string;
  lessons?: Lesson[];
}

function CourseDetail() {
  const { id, assignmentId } = useLocalSearchParams<{ id: string; assignmentId?: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();

  // Manager-tier authors get an Edit entry point (metadata / publish / delete).
  // Learners only ever see the read-only course.
  const canEdit = !!profile && (MANAGER_TIER as readonly string[]).includes(profile.role);

  const { data, loading, refreshing, error, onRefresh, refetch } = useApiQuery<CourseResponse>(
    id ? `/training/courses/${id}` : null,
    { channel: 'training', enabled: !!id },
  );

  const lessons = [...(data?.lessons ?? [])].sort(
    (a, b) => (a.lesson_order ?? 0) - (b.lesson_order ?? 0),
  );
  const published = data?.status === 'ACTIVE';

  const openLesson = (lessonId: string) =>
    router.push(
      `/(app)/training/lesson/${lessonId}?courseId=${id}${
        assignmentId ? `&assignmentId=${assignmentId}` : ''
      }`,
    );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <PageTopBar
          title={data?.title ?? 'Course'}
          showBack
          right={
            canEdit && id ? (
              <Button
                label="Edit"
                href={`/(app)/training/edit/${id}`}
                size="sm"
                block={false}
                variant="secondary"
              />
            ) : undefined
          }
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
                  {data.difficulty ? (
                    <Pill label={data.difficulty.toLowerCase()} tone="neutral" size="sm" />
                  ) : null}
                  <Pill
                    label={published ? 'Active' : (data.status ?? 'Draft').toLowerCase()}
                    tone={published ? 'success' : 'neutral'}
                    size="sm"
                  />
                  <Pill label={`${lessons.length} lessons`} tone="info" size="sm" />
                  {typeof data.estimated_duration_hours === 'number' ? (
                    <Pill label={`~${data.estimated_duration_hours}h`} tone="neutral" size="sm" />
                  ) : null}
                </View>

                {lessons.length > 0 ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Button
                      label={assignmentId ? 'Start / continue' : 'Open first lesson'}
                      onPress={() => lessons[0] && openLesson(lessons[0].id)}
                    />
                  </View>
                ) : null}
              </Card>

              {data.overview ? (
                <Card>
                  <SectionHeader title="Overview" />
                  <Text style={{ fontSize: fontSize.base, color: colors.ink2, lineHeight: 22 }}>
                    {data.overview}
                  </Text>
                </Card>
              ) : null}

              {Array.isArray(data.roadmap) && data.roadmap.length > 0 ? (
                <Card>
                  <SectionHeader title="Roadmap" />
                  {data.roadmap.map((p, i) => (
                    <View key={i} style={{ marginTop: i === 0 ? 0 : spacing.md }}>
                      <Text
                        style={{ fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}
                      >
                        {p.phase}
                      </Text>
                      {p.duration_label ? (
                        <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>
                          {p.duration_label}
                        </Text>
                      ) : null}
                      {Array.isArray(p.focus_areas) && p.focus_areas.length > 0 ? (
                        <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 4 }}>
                          {p.focus_areas.join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </Card>
              ) : null}

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
                      <Card
                        padded={false}
                        onPress={() => openLesson(lesson.id)}
                        style={{ backgroundColor: 'transparent', borderWidth: 0 }}
                      >
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
                              style={{
                                fontSize: fontSize.xs,
                                fontWeight: '700',
                                color: colors.muted,
                              }}
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
                            {lesson.estimated_minutes ? (
                              <Text
                                style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}
                              >
                                {lesson.estimated_minutes} min
                              </Text>
                            ) : null}
                          </View>
                          <Text style={{ fontSize: fontSize.lg, color: colors.faint }}>›</Text>
                        </View>
                      </Card>
                    </View>
                  ))
                )}
              </Card>

              <Card>
                <SectionHeader title="About" />
                <DetailRow label="Category" value={data.category ?? '—'} />
                <Divider />
                <DetailRow label="Difficulty" value={data.difficulty ?? '—'} />
                <Divider />
                <DetailRow label="Created" value={shortDate(data.created_at)} />
              </Card>
            </>
          )}
        </ScrollView>
      </Screen>
    </>
  );
}
