import { useMemo, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../../src/components/ui/Screen';
import { PageTopBar } from '../../../../src/components/ui/TopBar';
import { Card, SectionHeader } from '../../../../src/components/ui/Card';
import { Button } from '../../../../src/components/ui/Button';
import { SkeletonCard, ErrorState } from '../../../../src/components/ui/States';
import { RouteGuard } from '../../../../src/components/RouteGuard';
import { useApiQuery } from '../../../../src/hooks/useApi';
import { api, apiErrorMessage } from '../../../../src/services/api';
import { invalidate } from '../../../../src/hooks/useInvalidate';
import { BUSINESS_ROLES } from '../../../../src/types';
import { useTheme } from '../../../../src/theme';

interface Lesson {
  id: string;
  title: string;
  content?: string | null;
  lesson_order?: number | null;
  estimated_minutes?: number | null;
  video_url?: string | null;
  document_url?: string | null;
}
interface CourseResponse {
  id: string;
  title: string;
  lessons?: Lesson[];
}

/**
 * Lesson viewer.
 *
 * There is no GET /training/lessons/:id on the backend — lesson bodies are
 * returned as part of GET /training/courses/:id. So this screen takes the
 * course id as a query param and selects the lesson locally.
 *
 * When opened from an assignment (assignmentId present), a verified
 * PUT /training/assignments/:id/progress marks the lesson complete.
 *
 * Bodies are markdown-ish text authored by the generator; RN renders no markup,
 * so the light-touch renderer below handles the constructs that actually appear.
 */
export default function LessonViewerScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="training">
      <LessonViewer />
    </RouteGuard>
  );
}

function LessonViewer() {
  const { id, courseId, assignmentId } = useLocalSearchParams<{
    id: string;
    courseId?: string;
    assignmentId?: string;
  }>();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();

  const [marking, setMarking] = useState(false);
  const [done, setDone] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const course = useApiQuery<CourseResponse>(courseId ? `/training/courses/${courseId}` : null, {
    channel: 'training',
    enabled: !!courseId,
  });

  const lesson = useMemo(
    () => (course.data?.lessons ?? []).find((l) => l.id === id) ?? null,
    [course.data, id],
  );

  const blocks = useMemo(() => parseBody(lesson?.content ?? ''), [lesson?.content]);

  const markComplete = async () => {
    if (!assignmentId || !lesson) return;
    setMarking(true);
    setMarkError(null);
    try {
      // Only the fields updateProgress accepts — lesson_id + completed.
      await api.put(`/training/assignments/${assignmentId}/progress`, {
        lesson_id: lesson.id,
        completed: true,
      });
      setDone(true);
      invalidate('training');
    } catch (err) {
      setMarkError(apiErrorMessage(err, 'Could not mark this lesson complete.'));
    } finally {
      setMarking(false);
    }
  };

  if (!courseId) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen>
          <PageTopBar title="Lesson" showBack />
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              padding: spacing.lg,
              paddingBottom: spacing['4xl'] + insets.bottom,
            }}
          >
            <Banner
              tone="warn"
              message="Open this lesson from its course so we know which course it belongs to."
            />
          </ScrollView>
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <PageTopBar title={lesson?.title ?? 'Lesson'} showBack />
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
              refreshing={!!course.refreshing}
              onRefresh={course.onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        >
          {course.loading && !course.data ? (
            <SkeletonCard />
          ) : course.error && !course.data ? (
            <ErrorState message={course.error} onRetry={() => void course.refetch()} />
          ) : !lesson ? (
            <Banner tone="warn" message="That lesson isn't part of this course any more." />
          ) : (
            <>
              <Card>
                <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: colors.ink }}>
                  {lesson.title}
                </Text>
                {lesson.estimated_minutes ? (
                  <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 4 }}>
                    About {lesson.estimated_minutes} minutes
                  </Text>
                ) : null}
                {lesson.video_url ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Button
                      label="Watch video"
                      variant="secondary"
                      onPress={() => void Linking.openURL(lesson.video_url!)}
                    />
                  </View>
                ) : null}
              </Card>

              <Card>
                {blocks.length === 0 ? (
                  <Text style={{ fontSize: fontSize.base, color: colors.muted }}>
                    This lesson has no content yet.
                  </Text>
                ) : (
                  blocks.map((b, i) => (
                    <Text
                      key={i}
                      style={{
                        fontSize: b.kind === 'heading' ? fontSize.lg : fontSize.base,
                        fontWeight: b.kind === 'heading' ? '700' : '400',
                        color: b.kind === 'heading' ? colors.ink : colors.ink2,
                        lineHeight: b.kind === 'heading' ? 26 : 23,
                        marginTop: i === 0 ? 0 : b.kind === 'heading' ? spacing.lg : spacing.sm,
                        marginLeft: b.kind === 'bullet' ? spacing.md : 0,
                      }}
                    >
                      {b.kind === 'bullet' ? `•  ${b.text}` : b.text}
                    </Text>
                  ))
                )}
                {lesson.document_url ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Button
                      label="Open attachment"
                      variant="secondary"
                      onPress={() => void Linking.openURL(lesson.document_url!)}
                    />
                  </View>
                ) : null}
              </Card>

              {assignmentId ? (
                <Card>
                  <SectionHeader title="Progress" />
                  {markError ? <Banner tone="danger" message={markError} /> : null}
                  <Button
                    label={done ? '✓ Marked complete' : 'Mark lesson complete'}
                    onPress={markComplete}
                    loading={marking}
                    disabled={done || marking}
                  />
                </Card>
              ) : null}

              <Card>
                <SectionHeader title="Check your understanding" />
                <Button
                  label="Take the quiz"
                  variant="secondary"
                  onPress={() =>
                    router.push(
                      `/(app)/training/quiz/${lesson.id}${
                        assignmentId ? `?assignmentId=${assignmentId}` : ''
                      }`,
                    )
                  }
                />
              </Card>
            </>
          )}
        </ScrollView>
      </Screen>
    </>
  );
}

interface Block {
  kind: 'heading' | 'bullet' | 'para';
  text: string;
}

/**
 * Minimal markdown reader. Handles what the training generator actually emits;
 * anything else falls through as a paragraph rather than showing raw syntax.
 */
function parseBody(body: string): Block[] {
  if (!body.trim()) return [];
  return body
    .split(/\n+/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map<Block>((line) => {
      if (/^#{1,6}\s/.test(line)) {
        return { kind: 'heading', text: line.replace(/^#{1,6}\s*/, '') };
      }
      if (/^[-*•]\s/.test(line)) {
        return { kind: 'bullet', text: stripInline(line.replace(/^[-*•]\s*/, '')) };
      }
      return { kind: 'para', text: stripInline(line) };
    });
}

/** Drop bold/italic/code markers — RN <Text> can't render them inline here. */
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}
