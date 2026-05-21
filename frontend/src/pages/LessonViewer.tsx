import { useEffect, useMemo, useState } from 'react';
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

/**
 * Student-facing training plan walkthrough.
 *
 * This is the page a consultant lands on when they open one of their training
 * assignments. It is designed to feel like a proper STEM-OPT training program
 * — not just a list of clickable lessons:
 *
 *   1. Plan overview header — objectives, skills, weekly cadence, due date,
 *      and the milestone status (12-month self-eval / final eval).
 *   2. Curriculum on the left rail — lessons sequenced + progress checkboxes.
 *   3. Active lesson body on the right with mark-complete + quiz CTA.
 *   4. Inline links into the I-983 plan view + evaluation submission.
 *
 * Manager-tier viewers also see the "+ Add feedback" affordance.
 */
export function LessonViewer() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const isManager = !!profile && (MANAGER_TIER as string[]).includes(profile.role);
  const [assignment, setAssignment] = useState<any | null>(null);
  const [course, setCourse] = useState<any | null>(null);
  const [evals, setEvals] = useState<any[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const nav = useNavigate();
  const gates = useCompletionGates(id);
  const isConsultantOwner = !!(
    profile &&
    assignment &&
    profile.id === assignment.assigned_to_user_id
  );

  async function load() {
    if (!id) return;
    try {
      const r = await api.get(`/training/assignments/${id}`);
      setAssignment(r.data);
      // Course content is served pinned-to-version (or live for legacy) by the
      // assignment endpoint — answer-stripped. No separate /courses fetch, so a
      // later edit to the live course never changes what this student sees.
      const cc = r.data.course_content ?? {};
      const courseObj = {
        ...(cc.course ?? {}),
        lessons: cc.lessons ?? [],
        quizzes: cc.quizzes ?? [],
      };
      setCourse(courseObj);
      // Evaluations endpoint exists for everyone authed against an assignment
      // they own (or manager-tier). It may 403 for stragglers — swallow.
      try {
        const er = await api.get(`/training/assignments/${id}/evaluations`);
        setEvals(er.data ?? []);
      } catch {
        setEvals([]);
      }
      // Resume: prefer the student's last-viewed lesson, else the first
      // incomplete (or the first lesson). Only on initial load.
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
      toast.error(e?.response?.data?.error ?? 'Failed to load');
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [id]);

  // Record the current lesson for resume + "current lesson" analytics. Owner
  // only — managers previewing shouldn't overwrite a student's position.
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
  // Per-lesson quiz counts, derived from the course quiz set (which carries
  // lesson_id). Lets each lesson surface its own knowledge check.
  const lessonQuizCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of course?.quizzes ?? []) {
      if (q.lesson_id) counts[q.lesson_id] = (counts[q.lesson_id] ?? 0) + 1;
    }
    return counts;
  }, [course]);

  async function toggle(lesson: any) {
    const cur = progressById.get(lesson.id);
    try {
      const r = await api.put(`/training/assignments/${id}/progress`, {
        lesson_id: lesson.id,
        completed: !cur?.completed,
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

  // Reload assignment + gates after any compliance action (ack, final-assessment,
  // supervision note). The child components own the API call; we just need the
  // parent's assignment row to reflect the new status.
  async function refreshAll() {
    if (!id) return;
    try {
      const a = await api.get(`/training/assignments/${id}`);
      setAssignment(a.data);
      gates.refresh();
    } catch {
      /* swallow — toast already fired in the child */
    }
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

  // Compute training-plan milestones.
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
              <button
                onClick={() => setFeedbackOpen(true)}
                className="text-xs border border-border text-ink px-3 py-1.5 rounded-lg hover:bg-hover"
              >
                + Feedback
              </button>
            )}
          </div>
        </div>

        {/* Overall progress + milestones strip */}
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

        {/* Objectives + assessment methods — the I-983 Section 5 contract */}
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
              <button
                onClick={() => nav(`/training/assignments/${id}/quiz`)}
                className="mt-3 w-full bg-ink text-bg text-sm px-3 py-2 rounded-lg hover:opacity-90"
              >
                Take quiz ({course.quizzes.length} Q)
              </button>
            )}
          </div>

          {/* Skills you'll be picking up. Mirrors I-983 Section 6 on a small card. */}
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
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Lesson {activeIdx + 1} of {lessons.length}
                {typeof activeLesson.estimated_minutes === 'number' &&
                  ` · ${activeLesson.estimated_minutes} min`}
              </div>
              <h2 className="text-xl font-semibold tracking-tight mt-1">{activeLesson.title}</h2>
              {activeLesson.description && (
                <p className="text-muted mt-1">{activeLesson.description}</p>
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
              {Array.isArray(activeLesson.exercises) && activeLesson.exercises.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">
                    Exercises
                  </div>
                  <div className="space-y-2">
                    {activeLesson.exercises.map((ex: any, i: number) => (
                      <div key={i} className="border border-border rounded-lg p-3">
                        <div className="text-sm font-medium text-ink">{ex.prompt}</div>
                        {ex.expected_outcome && (
                          <div className="text-xs text-muted mt-1">
                            <span className="font-semibold">Goal:</span> {ex.expected_outcome}
                          </div>
                        )}
                        {Array.isArray(ex.hints) && ex.hints.length > 0 && (
                          <ul className="mt-1 text-xs text-muted list-disc list-inside">
                            {ex.hints.map((h: string, j: number) => (
                              <li key={j}>{h}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
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
                  <button
                    onClick={() =>
                      nav(`/training/assignments/${id}/quiz?lesson=${activeLesson.id}`)
                    }
                    className="text-sm border border-brand-200 text-brand-700 bg-brand-50 px-4 py-2 rounded-lg hover:bg-brand-100"
                  >
                    Take knowledge check ({lessonQuizCounts[activeLesson.id]} Q)
                  </button>
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-border flex items-center justify-between flex-wrap gap-2">
                <button
                  onClick={() => toggle(activeLesson)}
                  className={`text-sm font-semibold px-4 py-2 rounded-lg ${
                    progressById.get(activeLesson.id)?.completed
                      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30'
                      : 'bg-ink text-bg hover:opacity-90'
                  }`}
                >
                  {progressById.get(activeLesson.id)?.completed ? '✓ Completed' : 'Mark complete'}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    disabled={activeIdx <= 0}
                    onClick={() => setActiveLessonId(lessons[activeIdx - 1]?.id ?? null)}
                    className="text-xs border border-border text-ink px-3 py-1.5 rounded-lg hover:bg-hover disabled:opacity-40 disabled:hover:bg-surface"
                  >
                    ← Previous
                  </button>
                  <button
                    disabled={activeIdx >= lessons.length - 1}
                    onClick={() => setActiveLessonId(lessons[activeIdx + 1]?.id ?? null)}
                    className="text-xs border border-border text-ink px-3 py-1.5 rounded-lg hover:bg-hover disabled:opacity-40 disabled:hover:bg-surface"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </article>
          )}

          {/* Completion workflow — always visible so the consultant can see
              every remaining gate, not just lessons. Server-side multi-gate
              evaluation: lessons + time + quiz + uploads + acknowledgement +
              final assessment + manager approval. */}
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-lg font-semibold tracking-tight">Finishing this course</h2>
              <div className="flex items-center gap-2">
                {course.quizzes?.length > 0 && (
                  <button
                    onClick={() => nav(`/training/assignments/${id}/quiz`)}
                    className="text-xs border border-border text-ink px-3 py-1.5 rounded-lg hover:bg-hover"
                  >
                    Take quiz
                  </button>
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
// LessonBody — render plain-text lesson content into ALL-CAPS headings,
// bullets, and numbered lists without a markdown dependency.
// ===========================================================================
function LessonBody({ text }: { text: string }) {
  const blocks: { kind: 'heading' | 'para' | 'ul' | 'ol'; lines: string[] }[] = [];
  let buf: string[] = [];
  let mode: 'para' | 'ul' | 'ol' | null = null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  function flush() {
    if (buf.length === 0) return;
    blocks.push({ kind: mode ?? 'para', lines: buf });
    buf = [];
    mode = null;
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    // Markdown ATX heading (#, ##, ###) — strip the hashes.
    const md = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (md) {
      flush();
      blocks.push({ kind: 'heading', lines: [md[2].replace(/\s+#+\s*$/, '')] });
      continue;
    }
    // ALL-CAPS line treated as a heading (legacy plain-text lessons).
    if (
      /^[A-Z0-9][A-Z0-9 \-/&+(),.]{2,79}$/.test(line) &&
      line === line.toUpperCase() &&
      /[A-Z]/.test(line)
    ) {
      flush();
      blocks.push({ kind: 'heading', lines: [line] });
      continue;
    }
    if (/^\s*[-•*+]\s+/.test(line)) {
      if (mode !== 'ul') flush();
      mode = 'ul';
      buf.push(line.replace(/^\s*[-•*+]\s+/, ''));
      continue;
    }
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
        if (b.kind === 'heading') {
          return (
            <h3
              key={i}
              className="text-[11px] font-semibold tracking-widest uppercase text-muted mt-4"
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

// Render inline markdown — **bold** and `code` — without a dependency.
function inlineMd(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (/^`[^`]+`$/.test(p)) {
      return (
        <code key={i} className="text-[0.85em] bg-hover text-ink rounded px-1 py-0.5">
          {p.slice(1, -1)}
        </code>
      );
    }
    return p;
  });
}
