import { useEffect, useState, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Modal } from './Modal';
import { Pill, PillTone } from './Pill';
import { api } from '../services/api';

/**
 * Shared widgets for the Training module:
 *   TrainingCourseCard, LessonCard, TrainingProgressBar, QuizQuestionCard,
 *   AssignmentTable, TrainingStatusBadge, CourseCategoryBadge,
 *   AssignTrainingModal, FeedbackModal, VideoLessonPlayer, DocumentViewer.
 */

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------
// Training status tones, expressed as shared PillTone objects so the badges
// match every other status pill in the app (height, radius, dot, font).
const STATUS_TONE: Record<string, PillTone> = {
  NOT_STARTED: { bg: 'bg-muted', text: 'text-foreground', dot: 'bg-muted-foreground' },
  IN_PROGRESS: {
    bg: 'bg-sky-50 dark:bg-sky-500/15',
    text: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  COMPLETED: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  OVERDUE: {
    bg: 'bg-rose-50 dark:bg-rose-500/15',
    text: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  FAILED: {
    bg: 'bg-rose-50 dark:bg-rose-500/15',
    text: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  QUIZ_PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  ASSIGNMENT_PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  FINAL_ASSESSMENT_PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  MANAGER_REVIEW_PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  DRAFT: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  ACTIVE: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  ARCHIVED: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};
const STATUS_DEFAULT_TONE: PillTone = {
  bg: 'bg-muted',
  text: 'text-foreground',
  dot: 'bg-muted-foreground',
};
// Active/waiting states get a soft pulsing dot so they draw the eye.
const STATUS_PULSING = new Set([
  'IN_PROGRESS',
  'QUIZ_PENDING',
  'ASSIGNMENT_PENDING',
  'FINAL_ASSESSMENT_PENDING',
  'MANAGER_REVIEW_PENDING',
]);
// Plain-language labels for the assignment + course statuses learners and
// managers see. Falls back to a de-underscored version for anything new.
const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  OVERDUE: 'Overdue',
  FAILED: 'Not passed',
  QUIZ_PENDING: 'Quiz to take',
  ASSIGNMENT_PENDING: 'Work to submit',
  FINAL_ASSESSMENT_PENDING: 'Final assessment due',
  MANAGER_REVIEW_PENDING: 'Awaiting manager review',
  DRAFT: 'Draft',
  ACTIVE: 'Published',
  ARCHIVED: 'Archived',
};
export function TrainingStatusBadge({ status }: { status: string }) {
  return (
    <Pill tone={STATUS_TONE[status] ?? STATUS_DEFAULT_TONE} pulseDot={STATUS_PULSING.has(status)}>
      {STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
    </Pill>
  );
}

const CATEGORY_TONE: Record<string, string> = {
  Java: 'bg-orange-50 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-100 dark:border-orange-500/20',
  'Spring Boot':
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20',
  React:
    'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-100 dark:border-cyan-500/20',
  Angular:
    'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/20',
  'Node.js':
    'bg-lime-50 dark:bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-100 dark:border-lime-500/20',
  'QA Automation':
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  Selenium:
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  Playwright:
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  Cypress:
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  DevOps:
    'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-100 dark:border-amber-500/20',
  AWS: 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-100 dark:border-amber-500/20',
  Azure:
    'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-500/20',
  SQL: 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-500/20',
  'Data Engineering':
    'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-500/20',
  'Data Science':
    'bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-500/20',
  'Machine Learning':
    'bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-100 dark:border-purple-500/20',
  AI: 'bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-100 dark:border-fuchsia-500/20',
  'Network Security':
    'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-100 dark:border-red-500/20',
  'Application Security':
    'bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30',
  Cybersecurity:
    'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/20',
  'Cloud Security':
    'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-500/20',
  'Interview Preparation':
    'bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-100 dark:border-fuchsia-500/20',
  'Communication Skills':
    'bg-pink-50 dark:bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-100 dark:border-pink-500/20',
  'Resume Building':
    'bg-pink-50 dark:bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-100 dark:border-pink-500/20',
  'Banking Domain': 'bg-muted text-foreground border-border',
  'Insurance Domain': 'bg-muted text-foreground border-border',
  'Healthcare Domain': 'bg-muted text-foreground border-border',
};
export function CourseCategoryBadge({ category }: { category: string }) {
  const tone = CATEGORY_TONE[category] ?? 'bg-muted text-foreground border-border';
  return (
    <span
      className={clsx(
        'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border',
        tone,
      )}
    >
      {category}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------
export function TrainingProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const tone =
    pct >= 100
      ? 'bg-emerald-500'
      : pct >= 50
        ? 'bg-brand-500'
        : pct > 0
          ? 'bg-amber-400'
          : 'bg-muted-foreground';
  return (
    <div>
      {label && (
        <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course card
// ---------------------------------------------------------------------------
export interface CourseCardData {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  estimated_duration_hours?: number | null;
  thumbnail_url?: string | null;
  tags?: string[];
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  content_status?: string | null;
  lessons?: { count: number }[];
  assignments?: { count: number }[];
}
export function TrainingCourseCard({
  course,
  to,
  action,
}: {
  course: CourseCardData;
  to?: string;
  action?: ReactNode;
}) {
  const inner = (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-brand-300 hover:shadow-sm transition flex flex-col h-full">
      <div className="aspect-video bg-muted flex items-center justify-center">
        {course.thumbnail_url ? (
          <img
            src={course.thumbnail_url}
            alt={course.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-3xl font-bold text-muted-foreground">
            {course.title.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <CourseCategoryBadge category={course.category} />
          <TrainingStatusBadge status={course.status} />
          {course.content_status &&
            course.content_status !== 'NONE' &&
            course.content_status !== 'READY' && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
                {course.content_status === 'OUTLINE_READY'
                  ? 'needs content'
                  : course.content_status}
              </span>
            )}
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {course.difficulty}
          </span>
        </div>
        <h3 className="text-base font-semibold text-foreground leading-tight">{course.title}</h3>
        {course.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{course.description}</p>
        )}
        <div className="mt-auto pt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {course.lessons?.[0]?.count ?? 0} lessons · {course.assignments?.[0]?.count ?? 0}{' '}
            assigned
          </span>
          {typeof course.estimated_duration_hours === 'number' && (
            <span>~{course.estimated_duration_hours}h</span>
          )}
        </div>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ---------------------------------------------------------------------------
// Lesson card
// ---------------------------------------------------------------------------
export interface LessonRow {
  id: string;
  title: string;
  description?: string | null;
  estimated_minutes?: number | null;
  lesson_order: number;
  video_url?: string | null;
  document_url?: string | null;
}
export function LessonCard({
  lesson,
  completed,
  onToggle,
}: {
  lesson: LessonRow;
  completed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
      <button
        onClick={onToggle}
        className={clsx(
          'w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center text-[10px] shrink-0 transition',
          completed
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-border hover:border-brand-500',
        )}
        title={completed ? 'Mark not completed' : 'Mark completed'}
      >
        {completed ? '✓' : ''}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
            #{lesson.lesson_order + 1}
          </span>
          <h4
            className={clsx(
              'text-sm font-semibold leading-tight',
              completed && 'line-through text-muted-foreground',
            )}
          >
            {lesson.title}
          </h4>
        </div>
        {lesson.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{lesson.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
          {lesson.video_url && <span>🎬 video</span>}
          {lesson.document_url && <span>📄 doc</span>}
          {typeof lesson.estimated_minutes === 'number' && (
            <span>· {lesson.estimated_minutes} min</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz question card
// ---------------------------------------------------------------------------
export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  points?: number;
}
export function QuizQuestionCard({
  question,
  selected,
  onChange,
  result,
}: {
  question: QuizQuestion;
  selected: string | null;
  onChange: (v: string) => void;
  result?: { is_correct: boolean; correct_answer: string; explanation?: string };
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-sm font-semibold text-foreground mb-3">{question.question}</div>
      <div className="space-y-2">
        {question.options.map((opt) => {
          const isPicked = selected === opt;
          const isCorrect = result?.correct_answer === opt;
          const isWrongPick = !!result && isPicked && !result.is_correct;
          return (
            <label
              key={opt}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition',
                isPicked && !result && 'border-brand-400 bg-brand-50',
                !isPicked && !result && 'border-border hover:bg-muted',
                result &&
                  isCorrect &&
                  'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-900',
                isWrongPick && 'border-rose-300 bg-rose-50 dark:bg-rose-500/15 text-rose-900',
                result && !isCorrect && !isWrongPick && 'border-border text-muted-foreground',
              )}
            >
              <input
                type="radio"
                className="hidden"
                checked={isPicked}
                onChange={() => onChange(opt)}
                disabled={!!result}
              />
              <span
                className={clsx(
                  'w-4 h-4 rounded-full border-2 flex-shrink-0',
                  isPicked ? 'border-brand-500 bg-brand-500' : 'border-border',
                )}
              />
              <span>{opt}</span>
              {result && isCorrect && (
                <span className="ml-auto text-xs font-semibold">Correct</span>
              )}
              {isWrongPick && <span className="ml-auto text-xs font-semibold">Your pick</span>}
            </label>
          );
        })}
      </div>
      {result?.explanation && (
        <div className="mt-3 text-xs text-muted-foreground bg-muted border border-border rounded-lg p-3">
          <strong className="text-foreground">Explanation:</strong> {result.explanation}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignment table
// ---------------------------------------------------------------------------
export interface AssignmentRow {
  id: string;
  course?: { id: string; title: string; category: string } | null;
  assignee?: { id: string; full_name: string | null; email: string; role: string } | null;
  due_date: string | null;
  status: string;
  progress_percentage: number;
  completed_at: string | null;
}
export function AssignmentTable({
  rows,
  includeAssignee = true,
  viewBase = '/training/assignments',
}: {
  rows: AssignmentRow[];
  includeAssignee?: boolean;
  viewBase?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground italic">
        No assignments.
      </div>
    );
  }
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2.5">Course</th>
            {includeAssignee && <th className="text-left px-3 py-2.5">Assignee</th>}
            <th className="text-left px-3 py-2.5">Due</th>
            <th className="text-left px-3 py-2.5">Status</th>
            <th className="text-left px-3 py-2.5 w-48">Progress</th>
            <th className="text-right px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-muted">
              <td className="px-4 py-2.5">
                <Link
                  to={`${viewBase}/${a.id}`}
                  className="font-medium text-foreground hover:text-brand-700"
                >
                  {a.course?.title ?? '—'}
                </Link>
                {a.course?.category && (
                  <div className="mt-0.5">
                    <CourseCategoryBadge category={a.course.category} />
                  </div>
                )}
              </td>
              {includeAssignee && (
                <td className="px-3 py-2.5">
                  <div className="text-sm text-foreground truncate">
                    {a.assignee?.full_name ?? a.assignee?.email ?? '—'}
                  </div>
                  {a.assignee?.role && (
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {a.assignee.role}
                    </div>
                  )}
                </td>
              )}
              <td className="px-3 py-2.5 text-xs tabular-nums">{a.due_date ?? '—'}</td>
              <td className="px-3 py-2.5">
                <TrainingStatusBadge status={a.status} />
              </td>
              <td className="px-3 py-2.5">
                <TrainingProgressBar value={a.progress_percentage} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link
                  to={`${viewBase}/${a.id}`}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign Training modal
// ---------------------------------------------------------------------------
interface UserLite {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

export function AssignTrainingModal({
  open,
  onClose,
  courseId,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  courseId: string;
  onAssigned: () => void;
}) {
  const [users, setUsers] = useState<UserLite[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reuse the consultants endpoint as the source of assignable users —
    // it includes embedded user info already.
    api
      .get('/consultants', { params: {} })
      .then((r) =>
        setUsers(
          (r.data ?? [])
            .map((c: any) => ({
              id: c.user?.id,
              full_name: c.user?.full_name,
              email: c.user?.email,
              role: c.user?.role ?? 'CONSULTANT',
            }))
            .filter((u: UserLite) => u.id),
        ),
      )
      .catch(() => {
        /* silent — managers can paste IDs if /consultants is empty */
      });
  }, [open]);

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    if (picked.size === 0) {
      toast.error('Pick at least one user');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/training/assign', {
        course_id: courseId,
        user_ids: Array.from(picked),
        due_date: dueDate || null,
      });
      toast.success(
        `${r.data.created.length} assigned${r.data.skipped.length ? `, ${r.data.skipped.length} already had it` : ''}`,
      );
      setPicked(new Set());
      setDueDate('');
      onAssigned();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to assign');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign training"
      footer={
        <button
          onClick={save}
          disabled={busy}
          className="bg-foreground text-background text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Assigning…' : `Assign ${picked.size || ''}`.trim()}
        </button>
      }
    >
      <label className="block mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Due date (optional)
        </span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
        />
      </label>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        Select users
      </div>
      <div className="max-h-72 overflow-y-auto border border-border rounded-lg divide-y divide-border">
        {users.length === 0 && (
          <div className="p-3 text-xs italic text-muted-foreground">No users loaded.</div>
        )}
        {users.map((u) => (
          <label
            key={u.id}
            className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer"
          >
            <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-foreground truncate">{u.full_name ?? u.email}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {u.role}
              </div>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Feedback modal
// ---------------------------------------------------------------------------
export function FeedbackModal({
  open,
  onClose,
  assignmentId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  onSaved: () => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [rating, setRating] = useState(5);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!feedback.trim()) {
      toast.error('Feedback is required');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/training/assignments/${assignmentId}/feedback`, { feedback, rating });
      toast.success('Feedback saved');
      setFeedback('');
      setRating(5);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manager feedback"
      footer={
        <button
          onClick={save}
          disabled={busy}
          className="bg-foreground text-background text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            Rating
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className={clsx(
                  'w-9 h-9 rounded-md border text-base',
                  n <= rating
                    ? 'bg-amber-100 dark:bg-amber-500/20 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300'
                    : 'border-border text-muted-foreground',
                )}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Feedback
          </span>
          <textarea
            rows={6}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
            placeholder="What did they do well? What should they improve?"
          />
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// VideoLessonPlayer — handles YouTube embed-style URL or raw mp4.
// ---------------------------------------------------------------------------
export function VideoLessonPlayer({ url }: { url: string }) {
  const isYT = /youtube\.com\/watch\?v=|youtu\.be\//.test(url);
  if (isYT) {
    const id = url.split(/v=|youtu\.be\//)[1]?.split(/[&?]/)[0];
    return (
      <div className="aspect-video w-full bg-black rounded-xl overflow-hidden">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${id}`}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return <video controls src={url} className="w-full max-h-[60dvh] rounded-xl bg-black" />;
}

// ---------------------------------------------------------------------------
// DocumentViewer — iframe-embeds PDFs/docs.
// ---------------------------------------------------------------------------
export function DocumentViewer({ url }: { url: string }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <iframe src={url} className="w-full h-[70dvh]" title="Document" />
      <div className="px-3 py-2 text-xs text-muted-foreground bg-muted border-t border-border">
        <a href={url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
          Open in new tab ↗
        </a>
      </div>
    </div>
  );
}
