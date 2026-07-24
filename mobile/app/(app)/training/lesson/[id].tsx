import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenScroll, Banner } from '../../../../src/components/ui/Screen';
import { Card, SectionHeader } from '../../../../src/components/ui/Card';
import { Button } from '../../../../src/components/ui/Button';
import { SkeletonCard, ErrorState } from '../../../../src/components/ui/States';
import { RouteGuard } from '../../../../src/components/RouteGuard';
import { useApiQuery } from '../../../../src/hooks/useApi';
import { BUSINESS_ROLES, type TrainingCourse, type TrainingLesson } from '../../../../src/types';
import { useTheme } from '../../../../src/theme';

interface CourseResponse extends TrainingCourse {
  lessons?: TrainingLesson[];
}

/**
 * Lesson viewer.
 *
 * There is deliberately no GET /training/lessons/:id on the backend — lesson
 * bodies are returned as part of GET /training/courses/:id. So this screen takes
 * the course id as a query param and selects the lesson locally, rather than
 * inventing an endpoint that doesn't exist.
 *
 * Bodies are markdown-ish text authored by the generator. React Native renders
 * no markup, so the light-touch renderer below handles the constructs that
 * actually appear (headings, bullets, bold) and leaves everything else as text.
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

  const course = useApiQuery<CourseResponse>(courseId ? `/training/courses/${courseId}` : null, {
    channel: 'training',
    enabled: !!courseId,
  });

  const lesson = useMemo(
    () => (course.data?.lessons ?? []).find((l) => l.id === id) ?? null,
    [course.data, id],
  );

  const blocks = useMemo(() => parseBody(lesson?.body ?? ''), [lesson?.body]);

  if (!courseId) {
    return (
      <>
        <Stack.Screen options={{ title: 'Lesson' }} />
        <ScreenScroll edges={[]}>
          <Banner
            tone="warn"
            message="Open this lesson from its course so we know which course it belongs to."
          />
        </ScreenScroll>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: lesson?.title ?? 'Lesson' }} />
      <ScreenScroll refreshing={course.refreshing} onRefresh={course.onRefresh} edges={[]}>
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
              {lesson.duration_minutes ? (
                <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 4 }}>
                  About {lesson.duration_minutes} minutes
                </Text>
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
            </Card>

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
      </ScreenScroll>
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
