import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { QuizQuestionCard, QuizQuestion } from '../components/Training';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';

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
    const r: Record<string, AttemptResult> = {};
    try {
      for (const q of quiz) {
        const selected = picks[q.id];
        if (!selected) continue;
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
    } catch (e: any) {
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

        <div className="space-y-3">
          {quiz.map((q) => {
            const r = results[q.id];
            return (
              <QuizQuestionCard
                key={q.id}
                question={q}
                selected={picks[q.id] ?? null}
                onChange={(v) => setPicks({ ...picks, [q.id]: v })}
                result={
                  r
                    ? {
                        is_correct: r.is_correct,
                        correct_answer: r.correct_answer,
                        explanation: r.explanation ?? undefined,
                      }
                    : undefined
                }
              />
            );
          })}
        </div>

        {!score && quiz.length > 0 && (
          <div className="mt-5 flex justify-between">
            <button
              onClick={() => nav(-1)}
              className="border border-border text-ink text-sm px-4 py-2 rounded-lg hover:bg-hover"
            >
              Back
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="bg-ink text-bg text-sm font-semibold px-5 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? 'Submitting…'
                : `Submit (${Object.keys(picks).length} / ${quiz.length})`}
            </button>
          </div>
        )}
        {score && (
          <div className="mt-5 flex justify-end">
            <button
              onClick={() => nav(`/training/assignments/${id}`)}
              className="bg-ink text-bg text-sm font-semibold px-5 py-2 rounded-lg hover:opacity-90"
            >
              Back to course
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
