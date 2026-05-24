import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { Modal } from './Modal';
import { Pill, PillTone } from './Pill';

/**
 * Manager-only authoring widgets for AI-generated courses.
 *
 * Generation is progressive: `generateCourse` returns an outline + lesson
 * stubs fast, then the client loops `generateLessonContent` one lesson at a
 * time so each AI call stays bounded and a single failure is retryable.
 */

export interface GeneratedLessonStub {
  id: string;
  title: string;
  content_status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
}

const CONTENT_STATUS_TONE: Record<string, PillTone> = {
  PENDING: { bg: 'bg-hover', text: 'text-muted', dot: 'bg-muted' },
  GENERATING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  READY: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  FAILED: {
    bg: 'bg-rose-50 dark:bg-rose-500/15',
    text: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  NONE: { bg: 'bg-hover', text: 'text-muted', dot: 'bg-muted' },
  OUTLINE_READY: {
    bg: 'bg-sky-50 dark:bg-sky-500/15',
    text: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
};

// Plain-language labels so authors don't have to decode the raw enum.
const CONTENT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Not written yet',
  GENERATING: 'Writing…',
  READY: 'Ready',
  FAILED: 'Failed — retry',
  NONE: 'Not written yet',
  OUTLINE_READY: 'Needs content',
};

export function ContentStatusChip({ status }: { status?: string | null }) {
  const s = status ?? 'NONE';
  return (
    <Pill tone={CONTENT_STATUS_TONE[s] ?? CONTENT_STATUS_TONE.NONE} pulseDot={s === 'GENERATING'}>
      {CONTENT_STATUS_LABEL[s] ?? s.replace(/_/g, ' ')}
    </Pill>
  );
}

// Editorial lifecycle pill: DRAFT → GENERATED → REVIEWED → PUBLISHED → ARCHIVED.
const REVIEW_STATUS_TONE: Record<string, PillTone> = {
  DRAFT: { bg: 'bg-hover', text: 'text-muted', dot: 'bg-muted' },
  GENERATED: {
    bg: 'bg-sky-50 dark:bg-sky-500/15',
    text: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  REVIEWED: {
    bg: 'bg-indigo-50 dark:bg-indigo-500/15',
    text: 'text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500',
  },
  PUBLISHED: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  ARCHIVED: { bg: 'bg-hover', text: 'text-muted', dot: 'bg-muted' },
};
const REVIEW_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  GENERATED: 'Generated',
  REVIEWED: 'Reviewed',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};
export function ReviewStatusPill({ status }: { status?: string | null }) {
  if (!status) return null;
  return (
    <Pill tone={REVIEW_STATUS_TONE[status] ?? REVIEW_STATUS_TONE.DRAFT}>
      {REVIEW_STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
    </Pill>
  );
}

/** Generate content for lessons in parallel batches of 3, surfacing live
 *  progress. Batching limits rate-limit exposure while being 3× faster than
 *  purely sequential. Returns when all lessons are attempted. */
export async function generateAllLessons(
  lessonIds: string[],
  onProgress: (done: number, total: number, currentId: string) => void,
  aiToken?: string,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  let done = 0;
  const BATCH = 3;
  const body = aiToken ? { aiToken } : {};

  for (let i = 0; i < lessonIds.length; i += BATCH) {
    const batch = lessonIds.slice(i, i + BATCH);
    onProgress(done, lessonIds.length, batch[0] ?? '');
    const results = await Promise.allSettled(
      batch.map((lid) => api.post(`/training/lessons/${lid}/generate-content`, body)),
    );
    for (const r of results) {
      done++;
      if (r.status === 'fulfilled' && !r.value.data?.degraded) ok++;
      else failed++;
    }
    onProgress(done, lessonIds.length, '');
  }
  return { ok, failed };
}

/** Inline progress bar for the per-lesson generation loop. */
export function GenerationProgress({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: string;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="flex items-center justify-between text-xs text-muted mb-1.5">
        <span>{label ?? 'Generating lessons…'}</span>
        <span>
          {done}/{total}
        </span>
      </div>
      <div className="h-2 rounded-full bg-hover overflow-hidden">
        <div
          className="h-full bg-brand-500 transition-all"
          style={{ width: `${pct}%` }}
          aria-valuenow={pct}
          role="progressbar"
        />
      </div>
    </div>
  );
}

/**
 * Capstone editor — generate a course-level final-assessment template with AI
 * and review the result. Persisted on training_courses.capstone and seeded
 * onto each assignment's final_assessment when the course is assigned.
 */
export function CapstoneEditor({
  courseId,
  capstone,
  onChanged,
}: {
  courseId: string;
  capstone: any | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const r = await api.post(`/training/courses/${courseId}/generate-capstone`);
      if (r.data?.degraded) toast('Capstone stub created — AI was unavailable, edit it manually.');
      else toast.success('Capstone generated');
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-lg font-semibold tracking-tight">Final project (capstone)</h2>
        <button
          onClick={generate}
          disabled={busy}
          className="border border-brand-200 text-brand-700 bg-brand-50 text-sm px-3 py-1.5 rounded-lg hover:bg-brand-100 disabled:opacity-50"
        >
          {busy ? 'Generating…' : capstone ? '✦ Regenerate' : '✦ Generate with AI'}
        </button>
      </div>
      {!capstone ? (
        <p className="text-sm text-muted italic">
          No final project yet. Generate one — it becomes each learner's final assessment when the
          course is assigned to them.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {capstone.assessment_type}
          </div>
          {capstone.instructions && (
            <p className="text-sm text-ink whitespace-pre-wrap">{capstone.instructions}</p>
          )}
          {Array.isArray(capstone.questions) && capstone.questions.length > 0 && (
            <ol className="list-decimal list-outside pl-5 space-y-1 text-sm text-ink">
              {capstone.questions.map((q: any, i: number) => (
                <li key={i}>{q.prompt ?? q.question ?? String(q)}</li>
              ))}
            </ol>
          )}
          {Array.isArray(capstone.rubric) && capstone.rubric.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {capstone.rubric.map((r: any, i: number) => (
                <span key={i} className="text-[11px] bg-hover text-ink px-2 py-0.5 rounded-full">
                  {r.criterion} · {r.weight}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Inline lesson + quiz editor (manager-tier). Edits a generated/seeded lesson
// body, exercises, takeaways, and its knowledge-check questions before publish.
// ===========================================================================
const LESSON_STATUSES = ['PENDING', 'GENERATING', 'READY', 'FAILED'] as const;

function linesToArr(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function LessonEditorModal({
  lesson,
  quizzes,
  onClose,
  onSaved,
}: {
  lesson: any;
  quizzes: any[]; // lesson quiz rows WITH answers (from the manager course embed)
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: lesson.title ?? '',
    summary: lesson.summary ?? '',
    estimated_minutes: String(lesson.estimated_minutes ?? ''),
    video_url: lesson.video_url ?? '',
    document_url: lesson.document_url ?? '',
    content: lesson.content ?? '',
    key_takeaways: Array.isArray(lesson.key_takeaways) ? lesson.key_takeaways.join('\n') : '',
    content_status: lesson.content_status ?? 'READY',
  });
  const [exercises, setExercises] = useState<any[]>(
    Array.isArray(lesson.exercises) ? lesson.exercises : [],
  );
  const [qs, setQs] = useState<any[]>(quizzes ?? []);
  const [saving, setSaving] = useState(false);

  async function saveLesson() {
    setSaving(true);
    try {
      await api.put(`/training/lessons/${lesson.id}`, {
        title: form.title,
        summary: form.summary || null,
        content: form.content || null,
        video_url: form.video_url || null,
        document_url: form.document_url || null,
        estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
        key_takeaways: linesToArr(form.key_takeaways),
        exercises,
        content_status: form.content_status,
      });
      toast.success('Lesson saved');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function addQuestion() {
    try {
      const r = await api.post(`/training/lessons/${lesson.id}/quiz`, {
        question: 'New question',
        options: ['Option A', 'Option B'],
        correct_answer: 'Option A',
        points: 1,
        question_order: qs.length,
      });
      setQs([...qs, r.data]);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }
  async function saveQuestion(q: any) {
    try {
      await api.put(`/training/quizzes/${q.id}`, {
        question: q.question,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation ?? null,
        points: Number(q.points) || 1,
      });
      toast.success('Question saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed (the answer must match an option)');
    }
  }
  async function deleteQuestion(id: string) {
    try {
      await api.delete(`/training/quizzes/${id}`);
      setQs(qs.filter((x) => x.id !== id));
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit lesson · ${lesson.title}`}
      size="xl"
      footer={
        <button
          onClick={saveLesson}
          disabled={saving}
          className="bg-ink text-bg text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save lesson'}
        </button>
      }
    >
      <div className="space-y-3">
        <EditField
          label="Title"
          value={form.title}
          onChange={(v) => setForm({ ...form, title: v })}
        />
        <EditField
          label="Summary"
          value={form.summary}
          onChange={(v) => setForm({ ...form, summary: v })}
        />
        <div className="grid grid-cols-3 gap-3">
          <EditField
            label="Minutes"
            type="number"
            value={form.estimated_minutes}
            onChange={(v) => setForm({ ...form, estimated_minutes: v })}
          />
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Status
            </span>
            <select
              value={form.content_status}
              onChange={(e) => setForm({ ...form, content_status: e.target.value })}
              className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5 bg-surface"
            >
              {LESSON_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONTENT_STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </label>
          <EditField
            label="Video URL"
            value={form.video_url}
            onChange={(v) => setForm({ ...form, video_url: v })}
          />
        </div>
        <EditField
          label="Document URL"
          value={form.document_url}
          onChange={(v) => setForm({ ...form, document_url: v })}
        />
        <EditArea
          label="Lesson body (markdown)"
          rows={10}
          value={form.content}
          onChange={(v) => setForm({ ...form, content: v })}
        />
        <EditArea
          label="Key takeaways (one per line)"
          rows={4}
          value={form.key_takeaways}
          onChange={(v) => setForm({ ...form, key_takeaways: v })}
        />

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Exercises
            </span>
            <button
              onClick={() =>
                setExercises([...exercises, { prompt: '', expected_outcome: '', hints: [] }])
              }
              className="text-xs text-brand-700 hover:underline"
            >
              + Add exercise
            </button>
          </div>
          <div className="space-y-2">
            {exercises.map((ex, i) => (
              <div key={i} className="border border-border rounded-lg p-2 space-y-1.5">
                <input
                  value={ex.prompt ?? ''}
                  placeholder="Prompt"
                  onChange={(e) => {
                    const next = [...exercises];
                    next[i] = { ...ex, prompt: e.target.value };
                    setExercises(next);
                  }}
                  className="w-full text-sm border border-border rounded-md px-2 py-1"
                />
                <input
                  value={ex.expected_outcome ?? ''}
                  placeholder="Expected outcome"
                  onChange={(e) => {
                    const next = [...exercises];
                    next[i] = { ...ex, expected_outcome: e.target.value };
                    setExercises(next);
                  }}
                  className="w-full text-sm border border-border rounded-md px-2 py-1"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => setExercises(exercises.filter((_, j) => j !== i))}
                    className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Knowledge-check questions ({qs.length})
            </span>
            <button onClick={addQuestion} className="text-xs text-brand-700 hover:underline">
              + Add question
            </button>
          </div>
          <div className="space-y-3">
            {qs.map((q, i) => (
              <QuizQuestionEditor
                key={q.id}
                q={q}
                onChange={(nq) => {
                  const next = [...qs];
                  next[i] = nq;
                  setQs(next);
                }}
                onSave={() => saveQuestion(qs[i])}
                onDelete={() => deleteQuestion(q.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function QuizQuestionEditor({
  q,
  onChange,
  onSave,
  onDelete,
}: {
  q: any;
  onChange: (q: any) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const optionsText = Array.isArray(q.options) ? q.options.join('\n') : '';
  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <input
        value={q.question ?? ''}
        placeholder="Question"
        onChange={(e) => onChange({ ...q, question: e.target.value })}
        className="w-full text-sm font-medium border border-border rounded-md px-2 py-1"
      />
      <EditArea
        label="Options (one per line)"
        rows={3}
        value={optionsText}
        onChange={(v) => onChange({ ...q, options: linesToArr(v) })}
      />
      <div className="grid grid-cols-2 gap-2">
        <EditField
          label="Correct answer (must match an option)"
          value={q.correct_answer ?? ''}
          onChange={(v) => onChange({ ...q, correct_answer: v })}
        />
        <EditField
          label="Points"
          type="number"
          value={String(q.points ?? 1)}
          onChange={(v) => onChange({ ...q, points: v })}
        />
      </div>
      <EditField
        label="Explanation"
        value={q.explanation ?? ''}
        onChange={(v) => onChange({ ...q, explanation: v })}
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onDelete}
          className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
        >
          Delete
        </button>
        <button
          onClick={onSave}
          className="text-xs border border-border px-2.5 py-1 rounded-lg hover:bg-hover"
        >
          Save question
        </button>
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
      />
    </label>
  );
}

function EditArea({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
        {label}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5 font-mono"
      />
    </label>
  );
}
