import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenScroll, Banner } from '../../../../src/components/ui/Screen';
import { Card, SectionHeader } from '../../../../src/components/ui/Card';
import { Button } from '../../../../src/components/ui/Button';
import { SkeletonList, EmptyState } from '../../../../src/components/ui/States';
import { RouteGuard } from '../../../../src/components/RouteGuard';
import { useApiList } from '../../../../src/hooks/useApi';
import { api, apiErrorMessage } from '../../../../src/services/api';
import { invalidate } from '../../../../src/hooks/useInvalidate';
import { BUSINESS_ROLES } from '../../../../src/types';
import { useTheme } from '../../../../src/theme';

interface QuizQuestion {
  id: string;
  prompt: string;
  options?: string[] | null;
  order_index?: number | null;
}

/**
 * Lesson quiz — GET /training/lessons/:id/quiz, POST
 * /training/assignments/:id/quiz-attempt.
 *
 * The GET is ANSWER-STRIPPED server-side ("any authed user, answer-stripped" in
 * the router). That is the whole security model of this screen: correct answers
 * never reach the device, so grading cannot be spoofed by reading the payload.
 * The client submits choices and the server scores them.
 *
 * Because of that, there is no local "check my answer" — there is nothing to
 * check against, by design.
 */
export default function QuizScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="training">
      <Quiz />
    </RouteGuard>
  );
}

interface Result {
  score?: number | null;
  passed?: boolean | null;
  correct_count?: number | null;
  total?: number | null;
}

function Quiz() {
  const { id, assignmentId } = useLocalSearchParams<{ id: string; assignmentId?: string }>();
  const router = useRouter();
  const { colors, spacing, fontSize, radius } = useTheme();

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const quiz = useApiList<QuizQuestion>(id ? `/training/lessons/${id}/quiz` : null, {
    channel: 'training',
    enabled: !!id,
  });

  const questions = [...quiz.items].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] !== undefined);

  const submit = async () => {
    if (!allAnswered) return;
    if (!assignmentId) {
      setError(
        'This quiz needs to be opened from your assigned course so the attempt can be recorded.',
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<Result>(
        `/training/assignments/${assignmentId}/quiz-attempt`,
        {
          lesson_id: id,
          answers: questions.map((q) => ({ question_id: q.id, choice: answers[q.id] })),
        },
      );
      setResult(data ?? {});
      invalidate('training');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit your attempt.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Quiz' }} />
      <ScreenScroll edges={[]}>
        {quiz.loading && questions.length === 0 ? (
          <SkeletonList count={3} />
        ) : questions.length === 0 ? (
          <Card>
            <EmptyState compact title="No quiz for this lesson" />
          </Card>
        ) : result ? (
          <Card>
            <SectionHeader title={result.passed ? 'Passed' : 'Not passed'} />
            <Text
              style={{
                fontSize: fontSize['2xl'],
                fontWeight: '700',
                color: result.passed ? colors.success : colors.danger,
              }}
            >
              {result.correct_count ?? 0} / {result.total ?? questions.length}
            </Text>
            <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.sm }}>
              {result.passed
                ? 'Nice work — this lesson is marked complete.'
                : 'Review the lesson and try again.'}
            </Text>
            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Button label="Back to course" onPress={() => router.back()} variant="secondary" />
            </View>
          </Card>
        ) : (
          <>
            {error ? <Banner tone="danger" message={error} /> : null}

            {questions.map((q, qi) => (
              <Card key={q.id}>
                <Text
                  style={{
                    fontSize: fontSize.md,
                    fontWeight: '600',
                    color: colors.ink,
                    marginBottom: spacing.md,
                  }}
                >
                  {qi + 1}. {q.prompt}
                </Text>
                {(q.options ?? []).map((opt, oi) => {
                  const selected = answers[q.id] === oi;
                  return (
                    <Pressable
                      key={oi}
                      onPress={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.md,
                        minHeight: 48,
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                        borderRadius: radius.lg,
                        borderWidth: 1,
                        borderColor: selected ? colors.accent : colors.border,
                        backgroundColor: selected ? colors.accentSoft : 'transparent',
                        marginBottom: spacing.sm,
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          borderWidth: 2,
                          borderColor: selected ? colors.accent : colors.borderStrong,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {selected ? (
                          <View
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 5,
                              backgroundColor: colors.accent,
                            }}
                          />
                        ) : null}
                      </View>
                      <Text
                        style={{
                          flex: 1,
                          fontSize: fontSize.base,
                          color: selected ? colors.accent : colors.ink,
                        }}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </Card>
            ))}

            <Button
              label={allAnswered ? 'Submit answers' : `Answer all ${questions.length} questions`}
              onPress={submit}
              disabled={!allAnswered || submitting}
              loading={submitting}
            />
          </>
        )}
      </ScreenScroll>
    </>
  );
}
