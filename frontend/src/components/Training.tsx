import { useEffect, useState, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Modal } from './Modal';
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
const STATUS_TONE: Record<string, string> = {
  NOT_STARTED: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-100',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  OVERDUE: 'bg-rose-50 text-rose-700 border-rose-100',
  FAILED: 'bg-rose-50 text-rose-700 border-rose-100',
  DRAFT: 'bg-slate-100 text-slate-500 border-slate-200',
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  ARCHIVED: 'bg-slate-100 text-slate-400 border-slate-200',
};
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
  const tone = STATUS_TONE[status] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span
      className={clsx(
        'text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border',
        tone,
      )}
    >
      {STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
    </span>
  );
}

const CATEGORY_TONE: Record<string, string> = {
  Java: 'bg-orange-50 text-orange-800 border-orange-100',
  'Spring Boot': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  React: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  Angular: 'bg-rose-50 text-rose-700 border-rose-100',
  'Node.js': 'bg-lime-50 text-lime-700 border-lime-100',
  'QA Automation': 'bg-violet-50 text-violet-700 border-violet-100',
  Selenium: 'bg-violet-50 text-violet-700 border-violet-100',
  Playwright: 'bg-violet-50 text-violet-700 border-violet-100',
  Cypress: 'bg-violet-50 text-violet-700 border-violet-100',
  DevOps: 'bg-amber-50 text-amber-800 border-amber-100',
  AWS: 'bg-amber-50 text-amber-800 border-amber-100',
  Azure: 'bg-sky-50 text-sky-700 border-sky-100',
  SQL: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Data Engineering': 'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Data Science': 'bg-teal-50 text-teal-700 border-teal-100',
  'Machine Learning': 'bg-purple-50 text-purple-700 border-purple-100',
  AI: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
  'Network Security': 'bg-red-50 text-red-700 border-red-100',
  'Application Security': 'bg-red-50 text-red-800 border-red-200',
  Cybersecurity: 'bg-rose-50 text-rose-700 border-rose-100',
  'Cloud Security': 'bg-orange-50 text-orange-700 border-orange-100',
  'Interview Preparation': 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
  'Communication Skills': 'bg-pink-50 text-pink-700 border-pink-100',
  'Resume Building': 'bg-pink-50 text-pink-700 border-pink-100',
  'Banking Domain': 'bg-slate-100 text-slate-700 border-slate-200',
  'Insurance Domain': 'bg-slate-100 text-slate-700 border-slate-200',
  'Healthcare Domain': 'bg-slate-100 text-slate-700 border-slate-200',
};
export function CourseCategoryBadge({ category }: { category: string }) {
  const tone = CATEGORY_TONE[category] ?? 'bg-slate-100 text-slate-700 border-slate-200';
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
          : 'bg-slate-300';
  return (
    <div>
      {label && (
        <div className="flex justify-between text-[11px] text-slate-600 mb-1">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
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
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-brand-300 hover:shadow-sm transition flex flex-col h-full">
      <div className="aspect-video bg-slate-50 flex items-center justify-center">
        {course.thumbnail_url ? (
          <img
            src={course.thumbnail_url}
            alt={course.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-3xl font-bold text-slate-300">
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
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                {course.content_status === 'OUTLINE_READY'
                  ? 'needs content'
                  : course.content_status}
              </span>
            )}
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            {course.difficulty}
          </span>
        </div>
        <h3 className="text-base font-semibold text-slate-900 leading-tight">{course.title}</h3>
        {course.description && (
          <p className="text-sm text-slate-600 mt-1 line-clamp-2">{course.description}</p>
        )}
        <div className="mt-auto pt-3 flex items-center justify-between text-xs text-slate-500">
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
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-start gap-3">
      <button
        onClick={onToggle}
        className={clsx(
          'w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center text-[10px] shrink-0 transition',
          completed
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-slate-300 hover:border-brand-500',
        )}
        title={completed ? 'Mark not completed' : 'Mark completed'}
      >
        {completed ? '✓' : ''}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-slate-400 tabular-nums">
            #{lesson.lesson_order + 1}
          </span>
          <h4
            className={clsx(
              'text-sm font-semibold leading-tight',
              completed && 'line-through text-slate-400',
            )}
          >
            {lesson.title}
          </h4>
        </div>
        {lesson.description && (
          <p className="text-xs text-slate-500 mt-0.5 truncate">{lesson.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
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
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-semibold text-slate-900 mb-3">{question.question}</div>
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
                !isPicked && !result && 'border-slate-200 hover:bg-slate-50',
                result && isCorrect && 'border-emerald-300 bg-emerald-50 text-emerald-900',
                isWrongPick && 'border-rose-300 bg-rose-50 text-rose-900',
                result && !isCorrect && !isWrongPick && 'border-slate-200 text-slate-500',
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
                  isPicked ? 'border-brand-500 bg-brand-500' : 'border-slate-300',
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
        <div className="mt-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <strong className="text-slate-800">Explanation:</strong> {result.explanation}
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
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 italic">
        No assignments.
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          <tr>
            <th className="text-left px-4 py-2.5">Course</th>
            {includeAssignee && <th className="text-left px-3 py-2.5">Assignee</th>}
            <th className="text-left px-3 py-2.5">Due</th>
            <th className="text-left px-3 py-2.5">Status</th>
            <th className="text-left px-3 py-2.5 w-48">Progress</th>
            <th className="text-right px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5">
                <Link
                  to={`${viewBase}/${a.id}`}
                  className="font-medium text-slate-900 hover:text-brand-700"
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
                  <div className="text-sm text-slate-800 truncate">
                    {a.assignee?.full_name ?? a.assignee?.email ?? '—'}
                  </div>
                  {a.assignee?.role && (
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
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
          className="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Assigning…' : `Assign ${picked.size || ''}`.trim()}
        </button>
      }
    >
      <label className="block mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Due date (optional)
        </span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5"
        />
      </label>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
        Select users
      </div>
      <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
        {users.length === 0 && (
          <div className="p-3 text-xs italic text-slate-400">No users loaded.</div>
        )}
        {users.map((u) => (
          <label
            key={u.id}
            className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer"
          >
            <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-900 truncate">{u.full_name ?? u.email}</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{u.role}</div>
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
          className="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50"
        >
          Save
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
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
                    ? 'bg-amber-100 border-amber-200 text-amber-700'
                    : 'border-slate-200 text-slate-400',
                )}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Feedback
          </span>
          <textarea
            rows={6}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5"
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
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <iframe src={url} className="w-full h-[70dvh]" title="Document" />
      <div className="px-3 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
        <a href={url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
          Open in new tab ↗
        </a>
      </div>
    </div>
  );
}
