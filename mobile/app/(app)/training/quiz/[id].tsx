import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../../src/components/ui/Screen';
import { PageTopBar } from '../../../../src/components/ui/TopBar';
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
  question: string;
  options?: string[] | null;
  question_order?: number | null;
}

interface AttemptResult {
  quiz_id: string;
  is_correct: boolean;
  correct_answer?: string | null;
}

/**
 * Lesson quiz — GET /training/lessons/:id/quiz (answer-stripped) +
 * POST /training/assignments/:id/quiz-attempt.
 *
 * Grading is server-side: correct answers never reach the device. The client
 * submits ONE attempt per question ({ quiz_id, selected_answer: <option text> })
 * and the server scores each, returning is_correct + the correct_answer for
 * review. There is no local "check my answer" — by design there's nothing to
 * check against.
 */
export default function QuizScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="training">
      <Quiz />
    </RouteGuard>
  );
}

function Quiz() {
  const { id, assignmentId } = useLocalSearchParams<{ id: string; assignmentId?: string }>();
  const router = useRouter();
  const { colors, spacing, fontSize, radius } = useTheme();
  const insets = useSafeAreaInsets();

  // Selected option INDEX per question id.
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AttemptResult>>({});
  const [scored, setScored] = useState<{ correct: number; total: number } | null>(null);

  const quiz = useApiList<QuizQuestion>(id ? `/training/lessons/${id}/quiz` : null, {
    channel: 'training',
    enabled: !!id,
  });

  const questions = [...quiz.items].sort(
    (a, b) => (a.question_order ?? 0) - (b.question_order ?? 0),
  );
  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] !== undefined);
  const passed = scored ? scored.total > 0 && scored.correct / scored.total >= 0.7 : false;

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
    // Carry any results already recorded so a retry never re-POSTs a graded
    // question (the backend counts attempts). Mirrors the web QuizPage.
    const collected: Record<string, AttemptResult> = { ...results };
    let correct = 0;
    try {
      for (const q of questions) {
        const idx = answers[q.id];
        if (idx === undefined) continue;
        const selected = (q.options ?? [])[idx];
        if (selected === undefined) continue;
        const existing = collected[q.id];
        if (existing) {
          if (existing.is_correct) correct++;
          continue;
        }
        const { data } = await api.post<AttemptResult>(
          `/training/assignments/${assignmentId}/quiz-attempt`,
          { quiz_id: q.id, selected_answer: selected },
        );
        collected[q.id] = data;
        if (data?.is_correct) correct++;
      }
      setResults(collected);
      setScored({ correct, total: questions.length });
      invalidate('training');
    } catch (err) {
      setResults(collected);
      setError(apiErrorMessage(err, 'Could not submit your attempt.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <PageTopBar title="Quiz" showBack />
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: spacing['4xl'] + insets.bottom,
            gap: spacing.lg,
          }}
        >
          {quiz.loading && questions.length === 0 ? (
            <SkeletonList count={3} />
          ) : questions.length === 0 ? (
            <Card>
              <EmptyState compact title="No quiz for this lesson" />
            </Card>
          ) : (
            <>
              {scored ? (
                <Card>
                  <SectionHeader title={passed ? 'Passed' : 'Keep going'} />
                  <Text
                    style={{
                      fontSize: fontSize['2xl'],
                      fontWeight: '700',
                      color: passed ? colors.success : colors.danger,
                    }}
                  >
                    {scored.correct} / {scored.total}
                  </Text>
                  <Text
                    style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.sm }}
                  >
                    {passed
                      ? 'Nice work — review any misses below.'
                      : 'Review the lesson and the answers below, then try again.'}
                  </Text>
                  <View style={{ marginTop: spacing.lg }}>
                    <Button
                      label="Back to course"
                      onPress={() => router.back()}
                      variant="secondary"
                    />
                  </View>
                </Card>
              ) : error ? (
                <Banner tone="danger" message={error} />
              ) : null}

              {questions.map((q, qi) => {
                const res = results[q.id];
                return (
                  <Card key={q.id}>
                    <Text
                      style={{
                        fontSize: fontSize.md,
                        fontWeight: '600',
                        color: colors.ink,
                        marginBottom: spacing.md,
                      }}
                    >
                      {qi + 1}. {q.question}
                    </Text>
                    {(q.options ?? []).map((opt, oi) => {
                      const selected = answers[q.id] === oi;
                      // After grading, colour the correct option green and a wrong
                      // pick red.
                      const isCorrectOpt = !!res && res.correct_answer === opt;
                      const isWrongPick = !!res && selected && !res.is_correct;
                      const borderColor = isCorrectOpt
                        ? colors.success
                        : isWrongPick
                          ? colors.danger
                          : selected
                            ? colors.accent
                            : colors.border;
                      return (
                        <Pressable
                          key={oi}
                          onPress={() =>
                            !scored ? setAnswers((a) => ({ ...a, [q.id]: oi })) : undefined
                          }
                          disabled={!!scored}
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
                            borderColor,
                            backgroundColor:
                              selected && !scored ? colors.accentSoft : 'transparent',
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
                              color: isCorrectOpt
                                ? colors.success
                                : selected
                                  ? colors.accent
                                  : colors.ink,
                            }}
                          >
                            {opt}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </Card>
                );
              })}

              {!scored ? (
                <Button
                  label={
                    allAnswered ? 'Submit answers' : `Answer all ${questions.length} questions`
                  }
                  onPress={submit}
                  disabled={!allAnswered || submitting}
                  loading={submitting}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </Screen>
    </>
  );
}
