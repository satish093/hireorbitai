import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { api } from '../services/api';
import {
  CourseCategoryBadge,
  TrainingStatusBadge,
  AssignTrainingModal,
  CourseCover,
} from '../components/Training';
import {
  ContentStatusChip,
  GenerationProgress,
  generateAllLessons,
  CapstoneEditor,
  LessonEditorModal,
  ReviewStatusPill,
} from '../components/TrainingAuthoring';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { MANAGER_TIER, ADMIN_TIER } from '../types';

interface Lesson {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  content: string | null;
  summary: string | null;
  content_status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | null;
  exercises: any[] | null;
  key_takeaways: any[] | null;
  video_url: string | null;
  document_url: string | null;
  lesson_order: number;
  estimated_minutes: number | null;
}
interface Course {
  id: string;
  title: string;
  description: string | null;
  category: string;
  difficulty: string;
  estimated_duration_hours: number | null;
  tags: string[];
  status: string;
  content_status: string | null;
  review_status: string | null;
  target_audience: string | null;
  overview: string | null;
  roadmap: any[] | null;
  resources: any[] | null;
  capstone: any | null;
  thumbnail_url: string | null;
  lessons: Lesson[];
  quizzes: any[];
  // I-983 metadata
  learning_objectives: string[] | null;
  skills_taught: string[] | null;
  assessment_methods: string[] | null;
  stem_relevance: string | null;
  weekly_hours: number | null;
}

export function TrainingCourseDetails() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const isManager = !!profile && (MANAGER_TIER as string[]).includes(profile.role);
  // AI generation (course/lesson/capstone) is admin-only.
  const isAdmin = !!profile && (ADMIN_TIER as string[]).includes(profile.role);
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [gen, setGen] = useState<{ running: boolean; done: number; total: number }>({
    running: false,
    done: 0,
    total: 0,
  });
  const [publishing, setPublishing] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lessonForm, setLessonForm] = useState<any>({
    title: '',
    description: '',
    content: '',
    video_url: '',
    document_url: '',
    lesson_order: 0,
    estimated_minutes: 30,
  });

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const r = await api.get(`/training/courses/${id}`);
      setCourse(r.data);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [id]);

  async function addLesson() {
    if (!lessonForm.title.trim()) {
      toast.error('Title required');
      return;
    }
    try {
      await api.post(`/training/courses/${id}/lessons`, {
        ...lessonForm,
        lesson_order: course?.lessons.length ?? 0,
        estimated_minutes: Number(lessonForm.estimated_minutes) || null,
      });
      toast.success('Lesson added');
      setLessonForm({
        title: '',
        description: '',
        content: '',
        video_url: '',
        document_url: '',
        lesson_order: 0,
        estimated_minutes: 30,
      });
      setLessonOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  async function generateQuizFromContent() {
    if (!aiContent.trim()) {
      toast.error('Paste some lesson content first');
      return;
    }
    setAiBusy(true);
    try {
      const r = await api.post('/training/ai/generate-quiz', {
        lesson_content: aiContent,
        count: 5,
        course_id: id,
      });
      toast.success(`Generated ${r.data.questions.length} quiz questions`);
      setAiOpen(false);
      setAiContent('');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setAiBusy(false);
    }
  }

  // Generate (or regenerate) content for the given lessons, one call at a time.
  async function runGeneration(lessonIds: string[]) {
    if (lessonIds.length === 0) {
      toast('All lessons already have content.');
      return;
    }
    setGen({ running: true, done: 0, total: lessonIds.length });
    const { ok, failed } = await generateAllLessons(lessonIds, (done, total) =>
      setGen({ running: true, done, total }),
    );
    setGen({ running: false, done: 0, total: 0 });
    if (failed > 0) toast(`${ok} lesson(s) generated · ${failed} failed — retry the failed ones.`);
    else toast.success(`${ok} lesson(s) generated`);
    await load();
  }

  async function generateOneLesson(lessonId: string) {
    setGen({ running: true, done: 0, total: 1 });
    try {
      const r = await api.post(`/training/lessons/${lessonId}/generate-content`);
      if (r.data?.degraded) toast('Generation failed for this lesson — try again.');
      else toast.success('Lesson generated');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setGen({ running: false, done: 0, total: 0 });
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      const r = await api.post(`/training/courses/${id}/publish`);
      toast.success(`Published v${r.data?.version?.version_number ?? ''}`);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  }

  async function markReviewed() {
    setLifecycleBusy(true);
    try {
      await api.post(`/training/courses/${id}/review`);
      toast.success('Marked reviewed');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function enrich() {
    setLifecycleBusy(true);
    try {
      const r = await api.post(`/training/courses/${id}/enrich`);
      if (r.data?.degraded) toast('Enrich stub written — AI unavailable, edit manually.');
      else toast.success('Course enriched');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setLifecycleBusy(false);
    }
  }

  if (loading || !course)
    return (
      <Layout title="Course">
        {loading ? (
          <div className="space-y-4">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={5} />
          </div>
        ) : (
          <EmptyState
            icon="🔍"
            title="Course not found"
            description="It may have been removed, or you don't have access."
          />
        )}
      </Layout>
    );

  const sortedLessons = course.lessons.slice().sort((a, b) => a.lesson_order - b.lesson_order);
  const pendingLessonIds = sortedLessons
    .filter((l) => (l.content_status ?? 'READY') !== 'READY')
    .map((l) => l.id);
  const allReady = sortedLessons.length > 0 && pendingLessonIds.length === 0;

  return (
    <Layout
      title={course.title}
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Training', to: '/training' },
        { label: 'Courses', to: '/training/courses' },
        { label: course.title },
      ]}
    >
      <div className="bg-card border border-border rounded-2xl overflow-hidden mb-6">
        <div className="h-48 overflow-hidden">
          {course.thumbnail_url ? (
            <img
              src={course.thumbnail_url}
              alt={course.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <CourseCover id={course.id} title={course.title} category={course.category} />
          )}
        </div>
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CourseCategoryBadge category={course.category} />
                <TrainingStatusBadge status={course.status} />
                <ReviewStatusPill status={course.review_status} />
                {course.content_status &&
                  course.content_status !== 'NONE' &&
                  course.content_status !== 'READY' && (
                    <ContentStatusChip status={course.content_status} />
                  )}
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {course.difficulty}
                </span>
                {typeof course.estimated_duration_hours === 'number' && (
                  <span className="text-[10px] text-muted-foreground">
                    · ~{course.estimated_duration_hours}h
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
              {course.description && (
                <p className="text-muted-foreground mt-2">{course.description}</p>
              )}
              {course.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {course.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[11px] bg-muted text-foreground px-2 py-0.5 rounded-full"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {isManager && (
              <div className="flex items-center gap-2">
                <Link
                  to={`/training/courses/${course.id}/edit`}
                  className="border border-border text-foreground text-sm px-3 py-1.5 rounded-lg hover:bg-muted"
                >
                  Edit
                </Link>
                {isAdmin && (
                  <button
                    onClick={enrich}
                    disabled={lifecycleBusy}
                    title="Use AI to fill in the overview, roadmap, resources, and final project. Lessons are left unchanged."
                    className="border border-brand-200 text-brand-700 bg-brand-50 text-sm px-3 py-1.5 rounded-lg hover:bg-brand-100 disabled:opacity-50"
                  >
                    ✦ Fill in materials
                  </button>
                )}
                {course.review_status !== 'REVIEWED' && course.review_status !== 'PUBLISHED' && (
                  <button
                    onClick={markReviewed}
                    disabled={lifecycleBusy}
                    className="border border-border text-foreground text-sm px-3 py-1.5 rounded-lg hover:bg-muted disabled:opacity-50"
                  >
                    Mark reviewed
                  </button>
                )}
                {course.status !== 'ACTIVE' && (
                  <button
                    onClick={publish}
                    disabled={publishing || !allReady}
                    title={
                      allReady ? 'Publish course' : 'All lessons need content before publishing'
                    }
                    className="border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 text-sm px-3 py-1.5 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {publishing ? 'Publishing…' : 'Publish'}
                  </button>
                )}
                <button
                  onClick={() => setAssignOpen(true)}
                  className="bg-foreground text-background text-sm px-4 py-1.5 rounded-lg hover:opacity-90"
                >
                  Assign
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* I-983 Training Plan metadata. Renders only if at least one of the
          fields is populated, so old courses still look clean. */}
      {course.learning_objectives?.length ||
      course.skills_taught?.length ||
      course.assessment_methods?.length ||
      course.stem_relevance ||
      course.weekly_hours ? (
        <div className="bg-card border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
              I-983
            </span>
            <h2 className="text-sm font-semibold tracking-tight">STEM-OPT Training Plan</h2>
            {typeof course.weekly_hours === 'number' && (
              <span className="text-[10px] text-muted-foreground">
                · ~{course.weekly_hours} h/week
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Details that go onto the official Form I-983 training plan for STEM OPT students. Shown
            here so you can confirm the course matches what's on the plan.
          </p>

          {course.stem_relevance && (
            <div className="mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                STEM degree relevance
              </div>
              <p className="text-sm text-foreground">{course.stem_relevance}</p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {course.learning_objectives?.length ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                  Learning objectives
                </div>
                <ul className="list-disc list-outside pl-5 space-y-1 text-sm text-foreground">
                  {course.learning_objectives.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {course.skills_taught?.length ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                  Skills / techniques taught
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {course.skills_taught.map((s) => (
                    <span
                      key={s}
                      className="text-[11px] bg-muted text-foreground px-2 py-0.5 rounded-full"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {course.assessment_methods?.length ? (
              <div className="md:col-span-2">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                  Assessment methods
                </div>
                <ul className="list-disc list-outside pl-5 space-y-1 text-sm text-foreground">
                  {course.assessment_methods.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Course overview (AI-generated, editable). */}
      {(course.overview || course.roadmap?.length || course.resources?.length) && (
        <div className="bg-card border border-border rounded-2xl p-6 mb-6 space-y-5">
          {course.overview && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Overview
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{course.overview}</p>
            </div>
          )}
          {course.roadmap?.length ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Roadmap
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {course.roadmap.map((p: any, i: number) => (
                  <div key={i} className="border border-border rounded-lg p-3 bg-muted">
                    <div className="text-sm font-medium text-foreground">{p.phase}</div>
                    <div className="text-[11px] text-muted-foreground">{p.duration_label}</div>
                    {Array.isArray(p.focus_areas) && (
                      <ul className="mt-1 text-xs text-muted-foreground list-disc list-inside">
                        {p.focus_areas.map((f: string) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {course.resources?.length ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Recommended resources
              </div>
              <ul className="space-y-1 text-sm">
                {course.resources.map((r: any, i: number) => (
                  <li key={i}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-brand-700 hover:underline"
                    >
                      {r.title}
                    </a>
                    {r.type && (
                      <span className="text-[11px] text-muted-foreground ml-1.5">· {r.type}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {/* Lessons */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-lg font-semibold tracking-tight">Lessons ({course.lessons.length})</h2>
        {isManager && (
          <div className="flex items-center gap-2">
            {isAdmin && pendingLessonIds.length > 0 && (
              <button
                onClick={() => runGeneration(pendingLessonIds)}
                disabled={gen.running}
                className="border border-brand-200 text-brand-700 bg-brand-50 text-sm px-3 py-1.5 rounded-lg hover:bg-brand-100 disabled:opacity-50"
              >
                {gen.running ? 'Writing…' : `✦ Write ${pendingLessonIds.length} lesson(s) with AI`}
              </button>
            )}
            <button
              onClick={() => setLessonOpen(true)}
              className="bg-foreground text-background text-sm px-3 py-1.5 rounded-lg hover:opacity-90"
            >
              + Add lesson
            </button>
          </div>
        )}
      </div>
      {gen.running && (
        <div className="mb-3">
          <GenerationProgress done={gen.done} total={gen.total} />
        </div>
      )}
      <div className="space-y-2 mb-8">
        {sortedLessons.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No lessons yet.</p>
        ) : (
          sortedLessons.map((l) => {
            const status = l.content_status ?? 'READY';
            return (
              <div
                key={l.id}
                className="bg-card border border-border rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">{l.title}</span>
                    {isManager && <ContentStatusChip status={status} />}
                  </div>
                  {(l.summary || l.description) && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {l.summary || l.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isManager && (
                    <button
                      onClick={() => setEditingLesson(l)}
                      className="text-xs border border-border text-foreground px-2.5 py-1 rounded-lg hover:bg-muted"
                    >
                      Edit
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => generateOneLesson(l.id)}
                      disabled={gen.running}
                      className="text-xs border border-border text-foreground px-2.5 py-1 rounded-lg hover:bg-muted disabled:opacity-50"
                    >
                      {status === 'READY'
                        ? '✦ Regenerate'
                        : status === 'FAILED'
                          ? 'Retry'
                          : '✦ Generate'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {editingLesson && (
        <LessonEditorModal
          lesson={editingLesson}
          quizzes={(course.quizzes ?? []).filter((q: any) => q.lesson_id === editingLesson.id)}
          onClose={() => setEditingLesson(null)}
          onSaved={load}
        />
      )}

      {/* Capstone — AI generation is admin-only. */}
      {isAdmin && (
        <div className="mb-8">
          <CapstoneEditor courseId={course.id} capstone={course.capstone} onChanged={load} />
        </div>
      )}

      {/* Quizzes */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Quiz ({course.quizzes?.length ?? 0} questions)
        </h2>
        {isManager && (
          <button
            onClick={() => setAiOpen(true)}
            className="border border-brand-200 text-brand-700 bg-brand-50 text-sm px-3 py-1.5 rounded-lg hover:bg-brand-100"
          >
            ✦ Generate with AI
          </button>
        )}
      </div>
      {(course.quizzes?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No quiz questions yet. Use the AI generator on a lesson body to create them.
        </p>
      ) : (
        <ul className="space-y-2">
          {course.quizzes.map((q: any) => (
            <li key={q.id} className="bg-card border border-border rounded-lg p-3">
              <div className="text-sm font-medium text-foreground">{q.question}</div>
              <ul className="mt-1 text-xs text-muted-foreground list-disc list-inside">
                {(q.options ?? []).map((o: string) => (
                  <li
                    key={o}
                    className={
                      o === q.correct_answer
                        ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
                        : ''
                    }
                  >
                    {o}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <AssignTrainingModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        courseId={course.id}
        onAssigned={load}
      />

      <Modal
        open={lessonOpen}
        onClose={() => setLessonOpen(false)}
        title="New lesson"
        footer={
          <button
            onClick={addLesson}
            className="bg-foreground text-background text-sm px-4 py-2 rounded-lg hover:opacity-90"
          >
            Add
          </button>
        }
      >
        <div className="space-y-3">
          <LField
            label="Title"
            value={lessonForm.title}
            onChange={(v) => setLessonForm({ ...lessonForm, title: v })}
          />
          <LField
            label="Description"
            value={lessonForm.description}
            onChange={(v) => setLessonForm({ ...lessonForm, description: v })}
          />
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Content (markdown supported)
            </span>
            <textarea
              rows={5}
              value={lessonForm.content}
              onChange={(e) => setLessonForm({ ...lessonForm, content: e.target.value })}
              className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <LField
              label="Video URL"
              value={lessonForm.video_url}
              onChange={(v) => setLessonForm({ ...lessonForm, video_url: v })}
            />
            <LField
              label="Document URL"
              value={lessonForm.document_url}
              onChange={(v) => setLessonForm({ ...lessonForm, document_url: v })}
            />
            <LField
              type="number"
              label="Minutes"
              value={lessonForm.estimated_minutes}
              onChange={(v) => setLessonForm({ ...lessonForm, estimated_minutes: v })}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title="Generate quiz from lesson content"
        footer={
          <button
            onClick={generateQuizFromContent}
            disabled={aiBusy}
            className="bg-foreground text-background text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {aiBusy ? 'Generating…' : '✦ Generate 5 questions'}
          </button>
        }
      >
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Lesson content
          </span>
          <textarea
            rows={10}
            value={aiContent}
            onChange={(e) => setAiContent(e.target.value)}
            className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5 font-mono"
            placeholder="Paste 100+ words from the lesson body. The AI will only use this content to write questions — it won't introduce outside facts."
          />
        </label>
      </Modal>
    </Layout>
  );
}

function LField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
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
