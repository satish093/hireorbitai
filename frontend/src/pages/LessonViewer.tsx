import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import {
  LessonCard,
  TrainingProgressBar,
  TrainingStatusBadge,
  VideoLessonPlayer,
  DocumentViewer,
  FeedbackModal,
} from '../components/Training';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import {
  AcknowledgementCard,
  ComplianceReportButton,
  CompletionGatesPanel,
  FinalAssessmentCard,
  SupervisionNotesPanel,
  useCompletionGates,
} from '../components/TrainingCompliance';
import { useAuth } from '../context/AuthContext';
import { MANAGER_TIER } from '../types';
import { Button } from '../components/Button';

/**
 * Student-facing training plan walkthrough.
 *
 * Upgrades in this version:
 *   - Auto study-time tracking: measures time on each lesson and submits
 *     `time_spent_minutes` so the activity heatmap + streak actually populate.
 *   - Interactive exercises: textarea inputs + reveal-on-demand hints.
 *   - Richer LessonBody: fenced code blocks, blockquotes, horizontal rules,
 *     heading anchors for the inline Table of Contents.
 *   - Estimated read time shown in the lesson header.
 *   - Table of Contents sidebar for lessons with 3+ headings.
 */
interface CoachMsg {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Inline AI learning coach. Answers are grounded strictly in the active lesson's
 * content (the backend refuses to fabricate). Chat resets when the lesson changes.
 */
function LessonCoach({ assignmentId, lessonId }: { assignmentId: string; lessonId: string }) {
  const [messages, setMessages] = useState<CoachMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  // Grounded per-lesson — never carry context across lessons.
  useEffect(() => {
    setMessages([]);
    setInput('');
  }, [lessonId]);

  const suggestions = [
    'Explain this lesson in simple terms.',
    'What are the key points to remember?',
    'Give me an example of this concept.',
  ];

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const { data } = await api.post(`/training/assignments/${assignmentId}/coach`, {
        question: q,
        lesson_id: lessonId,
      });
      setMessages((m) => [...m, { role: 'assistant', text: data?.answer ?? 'No answer.' }]);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'The coach is unavailable right now.';
      setMessages((m) => [...m, { role: 'assistant', text: `⚠ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border border-violet-200 dark:border-violet-500/25 bg-violet-50/50 dark:bg-violet-500/10 rounded-xl p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700 dark:text-violet-300 mb-2">
        ✦ Ask the Coach
      </div>
      {messages.length === 0 ? (
        <p className="text-sm text-muted mb-3">
          Stuck on something? Ask about this lesson — the coach answers only from what you're
          reading here.
        </p>
      ) : (
        <div className="space-y-2.5 mb-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                'text-sm rounded-xl px-3 py-2 max-w-[90%] whitespace-pre-wrap break-words ' +
                (m.role === 'user'
                  ? 'ml-auto bg-ink text-bg'
                  : 'mr-auto bg-hover border border-border text-ink')
              }
            >
              {m.text}
            </div>
          ))}
          {busy && <div className="text-xs text-muted">Thinking…</div>}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              disabled={busy}
              className="text-[11px] px-2 py-1 rounded-full border border-border text-muted hover:bg-hover disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask(input);
          }}
          placeholder="Ask about this lesson…"
          className="flex-1 min-w-0 text-sm h-9 rounded-lg border border-border px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <button
          onClick={() => ask(input)}
          disabled={busy || !input.trim()}
          className="h-9 px-4 rounded-lg bg-ink text-bg text-sm font-medium hover:opacity-90 disabled:opacity-50 press"
        >
          Ask
        </button>
      </div>
    </div>
  );
}

export function LessonViewer() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const isManager = !!profile && (MANAGER_TIER as string[]).includes(profile.role);
  const [assignment, setAssignment] = useState<any | null>(null);
  const [course, setCourse] = useState<any | null>(null);
  const [evals, setEvals] = useState<any[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const nav = useNavigate();
  const gates = useCompletionGates(id);
  const isConsultantOwner = !!(
    profile &&
    assignment &&
    profile.id === assignment.assigned_to_user_id
  );

  // Exercise interactivity
  const [exerciseAnswers, setExerciseAnswers] = useState<Record<string, string>>({});
  const [hintsOpen, setHintsOpen] = useState<Record<string, boolean>>({});

  // Study-time tracking: measure time per lesson, submit on lesson switch / unmount.
  const lessonStartRef = useRef<number>(Date.now());
  const prevLessonIdRef = useRef<string | null>(null);

  function submitElapsedTime(lessonId: string) {
    if (!id) return;
    const mins = Math.round((Date.now() - lessonStartRef.current) / 60_000);
    if (mins < 1) return;
    api
      .put(`/training/assignments/${id}/progress`, {
        lesson_id: lessonId,
        time_spent_minutes: mins,
      })
      .catch(() => {});
  }

  const [loadError, setLoadError] = useState<{ status?: number; message?: string } | null>(null);
  async function load() {
    if (!id) return;
    setLoadError(null);
    try {
      const r = await api.get(`/training/assignments/${id}`);
      setAssignment(r.data);
      const cc = r.data.course_content ?? {};
      const courseObj = {
        ...(cc.course ?? {}),
        lessons: cc.lessons ?? [],
        quizzes: cc.quizzes ?? [],
      };
      setCourse(courseObj);
      try {
        const er = await api.get(`/training/assignments/${id}/evaluations`);
        setEvals(er.data ?? []);
      } catch {
        setEvals([]);
      }
      if (!activeLessonId && courseObj.lessons.length) {
        const ordered = courseObj.lessons
          .slice()
          .sort((a: any, b: any) => a.lesson_order - b.lesson_order);
        const doneIds = new Set(
          (r.data.lesson_progress ?? [])
            .filter((p: any) => p.completed)
            .map((p: any) => p.lesson_id),
        );
        const lastViewed = ordered.find((l: any) => l.id === r.data.last_viewed_lesson_id);
        const firstIncomplete = ordered.find((l: any) => !doneIds.has(l.id));
        setActiveLessonId((lastViewed ?? firstIncomplete ?? ordered[0]).id);
      }
    } catch (e: any) {
      // Track the error so the loading guard below renders an EmptyState
      // instead of an infinite skeleton. 404/403 → "Assignment not
      // available"; everything else surfaces the server message.
      const status = e?.response?.status as number | undefined;
      const message = (e?.response?.data?.error as string | undefined) ?? 'Failed to load';
      setLoadError({ status, message });
      toast.error(message);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [id]);

  // Submit time for the previous lesson when switching, then reset the clock.
  useEffect(() => {
    if (prevLessonIdRef.current && prevLessonIdRef.current !== activeLessonId) {
      submitElapsedTime(prevLessonIdRef.current);
    }
    prevLessonIdRef.current = activeLessonId;
    lessonStartRef.current = Date.now();
    /* eslint-disable-next-line */
  }, [activeLessonId]);

  // Flush remaining time when navigating away.
  useEffect(() => {
    return () => {
      if (prevLessonIdRef.current) submitElapsedTime(prevLessonIdRef.current);
    }; /* eslint-disable-next-line */
  }, [id]);

  // Record the current lesson for resume + analytics (owner only).
  useEffect(() => {
    if (!id || !activeLessonId || !isConsultantOwner) return;
    api.put(`/training/assignments/${id}/viewed`, { lesson_id: activeLessonId }).catch(() => {});
  }, [id, activeLessonId, isConsultantOwner]);

  const progressById = new Map<string, any>(
    (assignment?.lesson_progress ?? []).map((p: any) => [p.lesson_id, p]),
  );
  const lessons = useMemo(
    () => (course?.lessons ?? []).slice().sort((a: any, b: any) => a.lesson_order - b.lesson_order),
    [course],
  );
  const activeLesson = lessons.find((l: any) => l.id === activeLessonId);
  const activeIdx = lessons.findIndex((l: any) => l.id === activeLessonId);
  const lessonQuizCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of course?.quizzes ?? []) {
      if (q.lesson_id) counts[q.lesson_id] = (counts[q.lesson_id] ?? 0) + 1;
    }
    return counts;
  }, [course]);

  // Estimated read time (words / 200 wpm, rounded up to nearest minute).
  const estimatedReadMin = useMemo(() => {
    const words = (activeLesson?.content ?? '').trim().split(/\s+/).filter(Boolean).length;
    return words > 60 ? Math.max(1, Math.round(words / 200)) : null;
  }, [activeLesson]);

  // Table of contents: headings extracted from lesson content.
  const toc = useMemo(() => extractToc(activeLesson?.content ?? ''), [activeLesson]);

  async function toggle(lesson: any) {
    const cur = progressById.get(lesson.id);
    const completing = !cur?.completed;
    // Include time when marking complete; reset the per-lesson clock.
    const mins = completing
      ? Math.max(0, Math.round((Date.now() - lessonStartRef.current) / 60_000))
      : undefined;
    if (completing) lessonStartRef.current = Date.now();
    try {
      const r = await api.put(`/training/assignments/${id}/progress`, {
        lesson_id: lesson.id,
        completed: completing,
        ...(mins != null && mins > 0 ? { time_spent_minutes: mins } : {}),
      });
      setAssignment({
        ...assignment,
        progress_percentage: r.data.progress_percentage,
        status: r.data.status,
        completed_at: r.data.completed_at,
      });
      const a = await api.get(`/training/assignments/${id}`);
      setAssignment(a.data);
      gates.refresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  // Explicit course completion — only enabled once every gate is green
  // (status READY_TO_COMPLETE). Replaces the old auto-flip to COMPLETED.
  async function completeCourse() {
    setCompleting(true);
    try {
      const r = await api.post(`/training/assignments/${id}/complete`);
      setAssignment(r.data);
      gates.refresh();
      toast.success('Course completed 🎉');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Not all requirements are met yet.');
    } finally {
      setCompleting(false);
    }
  }

  async function refreshAll() {
    if (!id) return;
    try {
      const a = await api.get(`/training/assignments/${id}`);
      setAssignment(a.data);
      gates.refresh();
    } catch {
      /* swallow — toast already fired in child */
    }
  }

  if (loadError && (!assignment || !course)) {
    const isNotFound = loadError.status === 404 || loadError.status === 403;
    return (
      <Layout title="Training plan">
        <EmptyState
          title={isNotFound ? 'Assignment not available' : 'Could not load assignment'}
          description={
            isNotFound
              ? 'This training assignment may have been removed or is outside your scope.'
              : (loadError.message ?? 'Please try again in a moment.')
          }
          action={
            <Link
              to="/training"
              className="text-sm px-4 py-2 rounded-lg bg-ink text-bg hover:opacity-90"
            >
              Back to my training
            </Link>
          }
        />
      </Layout>
    );
  }

  if (!assignment || !course)
    return (
      <Layout title="Training plan">
        <div className="space-y-4">
          <SkeletonCard lines={3} />
          <div className="grid grid-cols-1 lg:grid-cols-[300px,1fr] gap-5">
            <SkeletonCard lines={5} />
            <SkeletonCard lines={8} />
          </div>
        </div>
      </Layout>
    );

  const start = assignment.training_start_date ? new Date(assignment.training_start_date) : null;
  const end = assignment.training_end_date ? new Date(assignment.training_end_date) : null;
  const today = new Date();
  const weeksTotal =
    start && end
      ? Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)))
      : null;
  const weeksDone =
    start && end
      ? Math.max(
          0,
          Math.min(
            weeksTotal ?? 0,
            Math.round((today.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)),
          ),
        )
      : null;
  const has12Mo = evals.some((e) => e.kind === 'SELF_12_MONTH');
  const hasFinal = evals.some((e) => e.kind === 'FINAL');
  const month12 = start ? new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000) : null;
  const due12 = !has12Mo && month12 && today >= month12;

  return (
    <Layout
      title={course.title}
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'My training', to: '/training/my' },
        { label: course.title },
      ]}
    >
      {/* =================== PLAN HEADER =================== */}
      <section className="bg-surface border border-border rounded-2xl p-6 mb-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
                I-983 training plan
              </span>
              <TrainingStatusBadge status={assignment.status} />
              {typeof course.weekly_hours === 'number' && (
                <span className="text-[10px] text-muted">· ~{course.weekly_hours} h/week</span>
              )}
              {assignment.due_date && (
                <span className="text-[10px] text-muted">· due {assignment.due_date}</span>
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
            {course.stem_relevance && (
              <p className="text-sm text-muted mt-1.5 max-w-3xl">{course.stem_relevance}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to={`/training/assignments/${id}/plan`}
              className="border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 text-xs px-3 py-1.5 rounded-lg hover:bg-emerald-100"
            >
              View I-983 plan
            </Link>
            {isManager && (
              <Button variant="ghost" size="sm" onClick={() => setFeedbackOpen(true)}>
                + Feedback
              </Button>
            )}
          </div>
        </div>

        {/* Explicit completion CTA — shown once all requirements are met. The
            course no longer auto-completes; the learner confirms here. */}
        {assignment.status === 'READY_TO_COMPLETE' && (
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3">
            <div className="text-sm text-emerald-800 dark:text-emerald-200">
              <span className="font-semibold">All requirements met.</span> Mark this course complete
              to finish it.
            </div>
            <Button variant="primary" onClick={completeCourse} loading={completing}>
              {completing ? 'Completing…' : 'Complete course'}
            </Button>
          </div>
        )}
        {assignment.status === 'COMPLETED' && (
          <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            ✓ Course completed
            {assignment.completed_at
              ? ` on ${new Date(assignment.completed_at).toLocaleDateString()}`
              : ''}
            .
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-4 mt-5">
          <Stat label="Overall progress">
            <TrainingProgressBar value={assignment.progress_percentage} />
            <div className="text-[11px] text-muted mt-1">
              {Math.round(assignment.progress_percentage)}% complete · {lessons.length} lessons
            </div>
          </Stat>
          <Stat label="Schedule">
            <div className="text-sm text-ink">
              {start ? (
                start.toLocaleDateString()
              ) : (
                <span className="italic text-muted">Start date not set</span>
              )}
              {' → '}
              {end ? (
                end.toLocaleDateString()
              ) : (
                <span className="italic text-muted">end not set</span>
              )}
            </div>
            {weeksTotal != null && (
              <div className="text-[11px] text-muted mt-1">
                Week {Math.max(1, weeksDone ?? 0)} of {weeksTotal}
              </div>
            )}
          </Stat>
          <Stat label="Evaluations">
            <div className="text-sm text-ink space-y-0.5">
              <div className="flex items-center gap-2">
                <Tick on={has12Mo} />
                <span>12-month self-evaluation</span>
                {due12 && !has12Mo && (
                  <Link
                    to={`/training/assignments/${id}/plan`}
                    className="text-[11px] text-rose-700 dark:text-rose-300 underline"
                  >
                    due
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Tick on={hasFinal} />
                <span>Final evaluation</span>
              </div>
            </div>
          </Stat>
        </div>

        {(course.learning_objectives?.length || course.assessment_methods?.length) && (
          <div className="grid md:grid-cols-2 gap-5 mt-5 pt-5 border-t border-border">
            {course.learning_objectives?.length ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">
                  What you'll learn
                </div>
                <ul className="list-disc list-outside pl-5 space-y-1 text-sm text-ink">
                  {course.learning_objectives.map((o: string) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {course.assessment_methods?.length ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">
                  How you'll be assessed
                </div>
                <ul className="list-disc list-outside pl-5 space-y-1 text-sm text-ink">
                  {course.assessment_methods.map((m: string) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* =================== CURRICULUM =================== */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px,1fr] gap-5">
        <aside className="space-y-3">
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">
              Curriculum
            </div>
            <div className="space-y-1.5">
              {lessons.map((l: any) => (
                <div
                  key={l.id}
                  className={l.id === activeLessonId ? 'ring-2 ring-brand-300 rounded-lg' : ''}
                >
                  <div onClick={() => setActiveLessonId(l.id)} className="cursor-pointer">
                    <LessonCard
                      lesson={l}
                      completed={progressById.get(l.id)?.completed}
                      onToggle={() => toggle(l)}
                    />
                  </div>
                </div>
              ))}
            </div>

            {course.quizzes?.length > 0 && (
              <Button
                variant="primary"
                block
                className="mt-3"
                onClick={() => nav(`/training/assignments/${id}/quiz`)}
              >
                Take quiz ({course.quizzes.length} Q)
              </Button>
            )}
          </div>

          {course.skills_taught?.length ? (
            <div className="bg-surface border border-border rounded-xl p-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">
                Skills
              </div>
              <div className="flex flex-wrap gap-1.5">
                {course.skills_taught.map((s: string) => (
                  <span key={s} className="text-[11px] bg-hover text-ink px-2 py-0.5 rounded-full">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        {/* =================== ACTIVE LESSON =================== */}
        <main>
          {!activeLesson && (
            <p className="text-sm text-muted">Pick a lesson on the left to begin.</p>
          )}
          {activeLesson && (
            <article className="bg-surface border border-border rounded-2xl p-6">
              {/* Lesson meta */}
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Lesson {activeIdx + 1} of {lessons.length}
                  {typeof activeLesson.estimated_minutes === 'number' &&
                    ` · ${activeLesson.estimated_minutes} min`}
                </div>
                {estimatedReadMin && (
                  <span className="text-[10px] text-muted">~{estimatedReadMin} min read</span>
                )}
              </div>
              <h2 className="text-xl font-semibold tracking-tight mt-0.5">{activeLesson.title}</h2>
              {activeLesson.description && (
                <p className="text-muted mt-1">{activeLesson.description}</p>
              )}

              {/* Table of contents for lessons with 3+ headings */}
              {toc.length >= 3 && (
                <div className="mt-4 border border-border rounded-xl p-3 bg-hover">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">
                    In this lesson
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {toc.map((h) => (
                      <a
                        key={h.id}
                        href={`#${h.id}`}
                        className="text-xs text-accent hover:underline"
                      >
                        {h.text}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {activeLesson.video_url && (
                <div className="mt-4">
                  <VideoLessonPlayer url={activeLesson.video_url} />
                </div>
              )}
              {activeLesson.content && (
                <div className="mt-4 max-w-none text-ink">
                  <LessonBody text={activeLesson.content} />
                </div>
              )}
              {activeLesson.practical_example && (
                <div className="mt-4 border border-border rounded-xl bg-hover p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">
                    Worked example
                  </div>
                  <LessonBody text={activeLesson.practical_example} />
                </div>
              )}

              {/* Interactive exercises */}
              {Array.isArray(activeLesson.exercises) && activeLesson.exercises.length > 0 && (
                <div className="mt-5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-3">
                    Exercises
                  </div>
                  <div className="space-y-3">
                    {activeLesson.exercises.map((ex: any, i: number) => {
                      const key = `${activeLesson.id}-${i}`;
                      return (
                        <div
                          key={i}
                          className="border border-border rounded-xl p-4 space-y-3 bg-hover/40"
                        >
                          <div className="text-sm font-medium text-ink">{ex.prompt}</div>
                          {ex.expected_outcome && (
                            <div className="text-xs text-muted">
                              <span className="font-semibold">Goal:</span> {ex.expected_outcome}
                            </div>
                          )}
                          <textarea
                            className="w-full min-h-[90px] text-sm rounded-lg border border-border bg-surface px-3 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand-300 resize-y placeholder:text-muted"
                            placeholder="Type your answer here…"
                            value={exerciseAnswers[key] ?? ''}
                            onChange={(e) =>
                              setExerciseAnswers((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                          {Array.isArray(ex.hints) && ex.hints.length > 0 && (
                            <div>
                              <button
                                className="text-xs text-accent hover:underline"
                                onClick={() =>
                                  setHintsOpen((prev) => ({ ...prev, [key]: !prev[key] }))
                                }
                              >
                                {hintsOpen[key] ? 'Hide hints' : `Show hints (${ex.hints.length})`}
                              </button>
                              {hintsOpen[key] && (
                                <ul className="mt-2 space-y-1 text-xs text-muted list-disc list-inside">
                                  {ex.hints.map((h: string, j: number) => (
                                    <li key={j}>{h}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {Array.isArray(activeLesson.key_takeaways) &&
                activeLesson.key_takeaways.length > 0 && (
                  <div className="mt-4 border border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/60 rounded-xl p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 mb-1.5">
                      Key takeaways
                    </div>
                    <ul className="list-disc list-outside pl-5 space-y-1 text-sm text-ink">
                      {activeLesson.key_takeaways.map((k: string, i: number) => (
                        <li key={i}>{k}</li>
                      ))}
                    </ul>
                  </div>
                )}
              {activeLesson.document_url && (
                <div className="mt-4">
                  <DocumentViewer url={activeLesson.document_url} />
                </div>
              )}
              {lessonQuizCounts[activeLesson.id] > 0 && (
                <div className="mt-4">
                  <Button
                    variant="outline"
                    onClick={() =>
                      nav(`/training/assignments/${id}/quiz?lesson=${activeLesson.id}`)
                    }
                  >
                    Take knowledge check ({lessonQuizCounts[activeLesson.id]} Q)
                  </Button>
                </div>
              )}

              <LessonCoach assignmentId={id!} lessonId={activeLesson.id} />

              <div className="mt-6 pt-4 border-t border-border flex items-center justify-between flex-wrap gap-2">
                <Button
                  variant={progressById.get(activeLesson.id)?.completed ? 'outline' : 'primary'}
                  onClick={() => toggle(activeLesson)}
                >
                  {progressById.get(activeLesson.id)?.completed ? '✓ Completed' : 'Mark complete'}
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={activeIdx <= 0}
                    onClick={() => setActiveLessonId(lessons[activeIdx - 1]?.id ?? null)}
                  >
                    ← Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={activeIdx >= lessons.length - 1}
                    onClick={() => setActiveLessonId(lessons[activeIdx + 1]?.id ?? null)}
                  >
                    Next →
                  </Button>
                </div>
              </div>
            </article>
          )}

          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-lg font-semibold tracking-tight">Finishing this course</h2>
              <div className="flex items-center gap-2">
                {course.quizzes?.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => nav(`/training/assignments/${id}/quiz`)}
                  >
                    Take quiz
                  </Button>
                )}
                <Link
                  to={`/training/assignments/${id}/plan`}
                  className="text-xs border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-3 py-1.5 rounded-lg hover:bg-emerald-100"
                >
                  I-983 plan + evaluation
                </Link>
                <ComplianceReportButton assignmentId={assignment.id} />
              </div>
            </div>

            <CompletionGatesPanel evaluation={gates.data} />
            <AcknowledgementCard
              assignmentId={assignment.id}
              isConsultant={isConsultantOwner}
              onChanged={refreshAll}
            />
            <FinalAssessmentCard
              assignmentId={assignment.id}
              isManager={isManager}
              isConsultant={isConsultantOwner}
              onChanged={refreshAll}
            />
            <SupervisionNotesPanel assignmentId={assignment.id} isManager={isManager} />
          </div>
        </main>
      </div>

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        assignmentId={assignment.id}
        onSaved={load}
      />
    </Layout>
  );
}

// ===========================================================================
// Small presentational helpers
// ===========================================================================
function Stat({ label, children }: { label: string; children: any }) {
  return (
    <div className="bg-hover border border-border rounded-xl px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
function Tick({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold ${on ? 'bg-emerald-500 text-white' : 'bg-hover text-muted'}`}
    >
      {on ? '✓' : '—'}
    </span>
  );
}

// ===========================================================================
// Helpers for Table of Contents
// ===========================================================================
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractToc(text: string): { id: string; text: string }[] {
  if (!text) return [];
  const results: { id: string; text: string }[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const mdMatch = line.match(/^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+\s*)?$/);
    if (mdMatch) {
      const t = mdMatch[1].trim();
      results.push({ id: slugify(t), text: t });
      continue;
    }
    if (
      /^[A-Z0-9][A-Z0-9 \-/&+(),.]{2,79}$/.test(line) &&
      line === line.toUpperCase() &&
      /[A-Z]/.test(line)
    ) {
      results.push({ id: slugify(line), text: line });
    }
  }
  return results;
}

// ===========================================================================
// LessonBody — rich plain-text / Markdown renderer
//
// Supports:
//   • ATX headings (#, ##, …) and ALL-CAPS legacy headings
//   • Fenced code blocks (```lang … ```)  ← new
//   • Blockquotes (> text)                ← new
//   • Horizontal rules (--- / ***)        ← new
//   • Bullet and numbered lists
//   • Inline **bold** and `code`
//   • Heading anchors for the ToC         ← new
// ===========================================================================
function LessonBody({ text }: { text: string }) {
  // Pre-extract fenced code blocks so they survive the line-by-line parser.
  const codeBlocks: { lang: string; code: string }[] = [];
  const withoutCode = text
    .replace(/\r\n/g, '\n')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang ?? '', code: code.trimEnd() });
      return `\n__CODE_BLOCK_${idx}__\n`;
    });

  type Kind = 'heading' | 'para' | 'ul' | 'ol' | 'blockquote' | 'code' | 'hr';
  const blocks: { kind: Kind; lines: string[]; meta?: string }[] = [];
  let buf: string[] = [];
  let mode: 'para' | 'ul' | 'ol' | 'blockquote' | null = null;

  function flush() {
    if (buf.length === 0) return;
    blocks.push({ kind: mode ?? 'para', lines: buf });
    buf = [];
    mode = null;
  }

  for (const raw of withoutCode.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }

    // Code block placeholder
    const codeMatch = line.match(/^__CODE_BLOCK_(\d+)__$/);
    if (codeMatch) {
      flush();
      blocks.push({ kind: 'code', lines: [], meta: codeMatch[1] });
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'hr', lines: [] });
      continue;
    }

    // Markdown heading
    const mdHead = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (mdHead) {
      flush();
      blocks.push({ kind: 'heading', lines: [mdHead[2].replace(/\s+#+\s*$/, '')] });
      continue;
    }

    // ALL-CAPS legacy heading
    if (
      /^[A-Z0-9][A-Z0-9 \-/&+(),.]{2,79}$/.test(line) &&
      line === line.toUpperCase() &&
      /[A-Z]/.test(line)
    ) {
      flush();
      blocks.push({ kind: 'heading', lines: [line] });
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      if (mode !== 'blockquote') flush();
      mode = 'blockquote';
      buf.push(line.replace(/^\s*>\s?/, ''));
      continue;
    }

    // Bullet list
    if (/^\s*[-•*+]\s+/.test(line)) {
      if (mode !== 'ul') flush();
      mode = 'ul';
      buf.push(line.replace(/^\s*[-•*+]\s+/, ''));
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (mode !== 'ol') flush();
      mode = 'ol';
      buf.push(line.replace(/^\s*\d+\.\s+/, ''));
      continue;
    }

    if (mode !== 'para') flush();
    mode = 'para';
    buf.push(line);
  }
  flush();

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.kind === 'code') {
          const cb = codeBlocks[parseInt(b.meta ?? '0')];
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-xl bg-[oklch(0.18_0.02_250)] text-[oklch(0.92_0.03_240)] text-[0.82em] px-5 py-4 font-mono leading-relaxed my-1"
            >
              <code>{cb?.code ?? ''}</code>
            </pre>
          );
        }
        if (b.kind === 'hr') {
          return <hr key={i} className="border-border my-1" />;
        }
        if (b.kind === 'heading') {
          const id = slugify(b.lines[0]);
          return (
            <h3
              id={id}
              key={i}
              className="text-[11px] font-semibold tracking-widest uppercase text-muted mt-4 scroll-mt-20"
            >
              {b.lines[0]}
            </h3>
          );
        }
        if (b.kind === 'ul') {
          return (
            <ul key={i} className="list-disc list-outside pl-5 space-y-1">
              {b.lines.map((l, j) => (
                <li key={j}>{inlineMd(l)}</li>
              ))}
            </ul>
          );
        }
        if (b.kind === 'ol') {
          return (
            <ol key={i} className="list-decimal list-outside pl-5 space-y-1">
              {b.lines.map((l, j) => (
                <li key={j}>{inlineMd(l)}</li>
              ))}
            </ol>
          );
        }
        if (b.kind === 'blockquote') {
          return (
            <blockquote
              key={i}
              className="border-l-4 border-accent/40 pl-4 py-0.5 text-muted italic space-y-1"
            >
              {b.lines.map((l, j) => (
                <p key={j}>{inlineMd(l)}</p>
              ))}
            </blockquote>
          );
        }
        // para
        return (
          <p key={i} className="whitespace-pre-wrap">
            {b.lines.map((l, j) => (
              <span key={j}>
                {inlineMd(l)}
                {j < b.lines.length - 1 ? '\n' : ''}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// Inline markdown: **bold**, `code`, and _italic_.
function inlineMd(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p))
      return (
        <strong key={i} className="font-semibold text-ink">
          {p.slice(2, -2)}
        </strong>
      );
    if (/^`[^`]+`$/.test(p))
      return (
        <code key={i} className="text-[0.85em] bg-hover text-ink rounded px-1 py-0.5 font-mono">
          {p.slice(1, -1)}
        </code>
      );
    if (/^_[^_]+_$/.test(p))
      return (
        <em key={i} className="italic">
          {p.slice(1, -1)}
        </em>
      );
    return p;
  });
}
