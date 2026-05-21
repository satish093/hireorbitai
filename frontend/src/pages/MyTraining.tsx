import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { StemOptDisclaimer } from '../components/StemOptDisclaimer';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import {
  TrainingProgressBar,
  TrainingStatusBadge,
  CourseCategoryBadge,
} from '../components/Training';

/**
 * Student / consultant landing page for their STEM-OPT training assignments.
 *
 * Instead of a flat table, each assignment is rendered as a "plan card" with
 * the things a student actually cares about while going through training:
 *   - which course + category + difficulty
 *   - what they'll learn (top objectives)
 *   - progress + weeks-into-plan + due date
 *   - the upcoming milestone (next lesson, quiz, or evaluation).
 *
 * Clicking the card lands on the LessonViewer plan walkthrough; the explicit
 * "I-983 plan" link goes to the printable Form-I-983 view.
 */
export function MyTraining() {
  const [rows, setRows] = useState<any[]>([]);
  const [courses, setCourses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/training/my-training');
        const list = r.data ?? [];
        setRows(list);
        // Fetch the courses referenced by these assignments so we can show
        // objectives + weekly hours on each card. /training/my-training only
        // joins a slim `course` summary, not the I-983 metadata.
        const courseIds = Array.from(
          new Set(list.map((a: any) => a.course_id).filter(Boolean)),
        ) as string[];
        const detail: Record<string, any> = {};
        await Promise.all(
          courseIds.map(async (cid) => {
            try {
              const cr = await api.get(`/training/courses/${cid}`);
              detail[cid] = cr.data;
            } catch {
              /* skip on failure */
            }
          }),
        );
        setCourses(detail);
      } catch (e: any) {
        toast.error(e?.response?.data?.error ?? 'Failed to load training');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Layout
      title="My training"
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'My training' }]}
    >
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My training</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your assigned STEM-OPT training plans. Click a card to start a session.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🎓"
          title="No training assigned yet"
          description="When your manager assigns a course, it'll show up here to start."
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {rows.map((a) => (
            <PlanCard key={a.id} a={a} course={courses[a.course_id]} />
          ))}
        </div>
      )}
      <StemOptDisclaimer />
    </Layout>
  );
}

function PlanCard({ a, course }: { a: any; course: any | undefined }) {
  const start = a.training_start_date ? new Date(a.training_start_date) : null;
  const end = a.training_end_date ? new Date(a.training_end_date) : null;
  const today = new Date();

  const weeksTotal =
    start && end
      ? Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)))
      : null;
  const weeksDone =
    start && weeksTotal
      ? Math.max(
          0,
          Math.min(
            weeksTotal,
            Math.round((today.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)),
          ),
        )
      : null;

  // Next-action hint — the most useful thing the student should click into.
  let nextAction = 'Continue training';
  if (a.progress_percentage <= 0) nextAction = 'Start training';
  else if (a.progress_percentage >= 100) nextAction = 'Submit evaluation';

  const courseTitle = a.course?.title ?? course?.title ?? '—';
  const category = a.course?.category ?? course?.category;
  const objectives: string[] = course?.learning_objectives ?? [];
  const weekly_hours = course?.weekly_hours ?? null;

  return (
    <Link
      to={`/training/assignments/${a.id}`}
      className="block bg-card border border-border rounded-2xl p-5 hover:border-brand-300 hover:shadow-sm transition"
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {category && <CourseCategoryBadge category={category} />}
        <TrainingStatusBadge status={a.status} />
        {typeof weekly_hours === 'number' && (
          <span className="text-[10px] text-muted-foreground">· ~{weekly_hours} h/week</span>
        )}
        {a.due_date && (
          <span className="text-[10px] text-muted-foreground">· due {a.due_date}</span>
        )}
      </div>

      <h2 className="text-lg font-semibold tracking-tight text-foreground">{courseTitle}</h2>

      {objectives.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            You will learn
          </div>
          <ul className="text-sm text-foreground list-disc list-outside pl-5 space-y-0.5">
            {objectives.slice(0, 3).map((o) => (
              <li key={o} className="line-clamp-1">
                {o}
              </li>
            ))}
            {objectives.length > 3 && (
              <li className="italic text-muted-foreground">+{objectives.length - 3} more</li>
            )}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <TrainingProgressBar value={a.progress_percentage} label="Progress" />
      </div>

      <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
        <span>
          {weeksTotal != null
            ? `Week ${Math.max(1, weeksDone ?? 0)} of ${weeksTotal}`
            : 'Schedule not set'}
        </span>
        <span className="text-xs font-semibold text-brand-700">{nextAction} →</span>
      </div>
    </Link>
  );
}
