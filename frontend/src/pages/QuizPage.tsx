import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { QuizQuestionCard, QuizQuestion } from '../components/Training';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';

interface AttemptResult {
  quiz_id: string;
  is_correct: boolean;
  selected_answer: string;
  correct_answer: string;
  explanation: string | null;
  score: number;
}

export function QuizPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const lessonId = searchParams.get('lesson');
  const nav = useNavigate();
  const [assignment, setAssignment] = useState<any | null>(null);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, AttemptResult>>({});
  const [submitting, setSubmitting] = useState(false);
  const [score, setScore] = useState<{ correct: number; total: number; points: number } | null>(
    null,
  );
  // One-question-at-a-time stepper index.
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const a = await api.get(`/training/assignments/${id}`);
        setAssignment(a.data);
        // Pull questions from the assignment's pinned-version content (answer-
        // stripped). Per-lesson when ?lesson= is present, else the whole course.
        const cc = a.data.course_content;
        let questions: QuizQuestion[] = [];
        if (cc) {
          if (lessonId) {
            const lesson = (cc.lessons ?? []).find((l: any) => l.id === lessonId);
            questions =
              lesson?.quiz ?? (cc.quizzes ?? []).filter((q: any) => q.lesson_id === lessonId);
          } else {
            questions = cc.quizzes ?? [];
          }
        } else {
          // Legacy fallback (assignment without pinned content).
          const q = lessonId
            ? await api.get(`/training/lessons/${lessonId}/quiz`)
            : await api.get(`/training/courses/${a.data.course_id}/quiz`);
          questions = q.data ?? [];
        }
        setQuiz(questions);
      } catch (e: any) {
        toast.error(e?.response?.data?.error ?? 'Failed to load quiz');
      }
    })();
  }, [id, lessonId]);

  async function submit() {
    if (Object.keys(picks).length < quiz.length) {
      const ok = confirm(
        `You've answered ${Object.keys(picks).length} of ${quiz.length}. Submit anyway?`,
      );
      if (!ok) return;
    }
    setSubmitting(true);
    let correct = 0,
      points = 0;
    // Carry any attempts already recorded on a PRIOR (partially-failed) submit
    // so a retry never re-POSTs an already-persisted quiz_id — re-posting would
    // burn extra attempts and could trip the backend's attempts-exceeded → FAIL
    // rule even when the learner answered correctly.
    const r: Record<string, AttemptResult> = { ...results };
    try {
      for (const q of quiz) {
        const selected = picks[q.id];
        if (!selected) continue;
        if (r[q.id]) {
          // Already recorded (this attempt or a prior one) — count, don't re-POST.
          if (r[q.id]!.is_correct) {
            correct++;
            points += r[q.id]!.score;
          }
          continue;
        }
        const res = await api.post(`/training/assignments/${id}/quiz-attempt`, {
          quiz_id: q.id,
          selected_answer: selected,
        });
        r[q.id] = res.data;
        if (res.data.is_correct) {
          correct++;
          points += res.data.score;
        }
      }
      setResults(r);
      setScore({ correct, total: quiz.length, points });
      setCurrent(0); // restart the stepper at Q1 for review
    } catch (e: any) {
      // Persist whatever DID succeed so a retry skips those questions.
      setResults(r);
      toast.error(e?.response?.data?.error ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (!assignment)
    return (
      <Layout title="Quiz">
        <div className="max-w-3xl">
          <SkeletonCard lines={5} />
        </div>
      </Layout>
    );

  const total = quiz.length;
  const q = quiz[current];
  const atLast = current >= total - 1;

  return (
    <Layout
      title="Quiz"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'My training', to: '/training/my' },
        { label: 'Quiz' },
      ]}
    >
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight mb-5">
          Quiz · {assignment.course?.title}
        </h1>
        {quiz.length === 0 && (
          <EmptyState
            compact
            icon="📝"
            title="No quiz for this lesson yet"
            description="There's nothing to answer here right now — continue with the lessons."
          />
        )}

        {score && (
          <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-5 mb-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              Result
            </div>
            <div className="text-3xl font-bold mt-1">
              {score.correct} / {score.total}{' '}
              <span className="text-base font-normal text-muted">· {score.points} points</span>
            </div>
            <div className="text-sm text-muted mt-1">
              {score.correct === score.total
                ? 'Perfect score 🎉'
                : score.correct / score.total >= 0.7
                  ? 'Solid pass — review the explanations below.'
                  : 'Worth a re-watch of the lesson before re-attempting.'}
            </div>
          </div>
        )}

        {quiz.length > 0 && q && (
          <>
            {/* Progress — one question at a time */}
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
              <span>
                Question {current + 1} of {total}
              </span>
              <span>{Object.keys(picks).length} answered</span>
            </div>
            <div className="h-1 rounded-full bg-hover mb-4 overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${total ? ((current + 1) / total) * 100 : 0}%` }}
              />
            </div>

            <QuizQuestionCard
              key={q.id}
              question={q}
              selected={picks[q.id] ?? null}
              onChange={(v) => setPicks({ ...picks, [q.id]: v })}
              result={
                results[q.id]
                  ? {
                      is_correct: results[q.id]!.is_correct,
                      correct_answer: results[q.id]!.correct_answer,
                      explanation: results[q.id]!.explanation ?? undefined,
                    }
                  : undefined
              }
            />

            <div className="mt-5 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => (current === 0 ? nav(-1) : setCurrent((c) => c - 1))}
              >
                {current === 0 ? 'Back' : 'Previous'}
              </Button>
              {!score && atLast ? (
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={submitting}
                  loading={submitting}
                >
                  {submitting ? 'Submitting…' : `Submit (${Object.keys(picks).length} / ${total})`}
                </Button>
              ) : score && atLast ? (
                <Button variant="primary" onClick={() => nav(`/training/assignments/${id}`)}>
                  Back to course
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}
                >
                  Next
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
