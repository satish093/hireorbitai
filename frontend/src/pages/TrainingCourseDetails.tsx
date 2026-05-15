import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { api } from '../services/api';
import {
  CourseCategoryBadge,
  TrainingStatusBadge,
  LessonCard,
  AssignTrainingModal,
} from '../components/Training';
import { useAuth } from '../context/AuthContext';
import { MANAGER_TIER } from '../types';

interface Lesson {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  content: string | null;
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
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
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
      toast.error(e?.response?.data?.error ?? 'Failed');
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
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setAiBusy(false);
    }
  }

  if (loading || !course)
    return (
      <Layout title="Course">
        <div className="text-sm text-slate-500">{loading ? 'Loading…' : 'Not found.'}</div>
      </Layout>
    );

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
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-6">
        {course.thumbnail_url && (
          <img src={course.thumbnail_url} alt={course.title} className="w-full h-48 object-cover" />
        )}
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CourseCategoryBadge category={course.category} />
                <TrainingStatusBadge status={course.status} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {course.difficulty}
                </span>
                {typeof course.estimated_duration_hours === 'number' && (
                  <span className="text-[10px] text-slate-500">
                    · ~{course.estimated_duration_hours}h
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
              {course.description && <p className="text-slate-600 mt-2">{course.description}</p>}
              {course.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {course.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full"
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
                  className="border border-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
                >
                  Edit
                </Link>
                <button
                  onClick={() => setAssignOpen(true)}
                  className="bg-slate-900 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-slate-800"
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
        <div className="bg-white border border-emerald-200 rounded-2xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              I-983
            </span>
            <h2 className="text-sm font-semibold tracking-tight">STEM-OPT Training Plan</h2>
            {typeof course.weekly_hours === 'number' && (
              <span className="text-[10px] text-slate-500">· ~{course.weekly_hours} h/week</span>
            )}
          </div>

          {course.stem_relevance && (
            <div className="mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                STEM degree relevance
              </div>
              <p className="text-sm text-slate-700">{course.stem_relevance}</p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {course.learning_objectives?.length ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                  Learning objectives
                </div>
                <ul className="list-disc list-outside pl-5 space-y-1 text-sm text-slate-700">
                  {course.learning_objectives.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {course.skills_taught?.length ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                  Skills / techniques taught
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {course.skills_taught.map((s) => (
                    <span
                      key={s}
                      className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {course.assessment_methods?.length ? (
              <div className="md:col-span-2">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                  Assessment methods
                </div>
                <ul className="list-disc list-outside pl-5 space-y-1 text-sm text-slate-700">
                  {course.assessment_methods.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Lessons */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Lessons ({course.lessons.length})</h2>
        {isManager && (
          <button
            onClick={() => setLessonOpen(true)}
            className="bg-slate-900 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800"
          >
            + Add lesson
          </button>
        )}
      </div>
      <div className="space-y-2 mb-8">
        {course.lessons.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No lessons yet.</p>
        ) : (
          course.lessons
            .sort((a, b) => a.lesson_order - b.lesson_order)
            .map((l) => <LessonCard key={l.id} lesson={l} />)
        )}
      </div>

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
        <p className="text-sm text-slate-400 italic">
          No quiz questions yet. Use the AI generator on a lesson body to create them.
        </p>
      ) : (
        <ul className="space-y-2">
          {course.quizzes.map((q: any) => (
            <li key={q.id} className="bg-white border border-slate-200 rounded-lg p-3">
              <div className="text-sm font-medium text-slate-900">{q.question}</div>
              <ul className="mt-1 text-xs text-slate-500 list-disc list-inside">
                {(q.options ?? []).map((o: string) => (
                  <li
                    key={o}
                    className={o === q.correct_answer ? 'text-emerald-700 font-semibold' : ''}
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
            className="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-800"
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
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Content (markdown supported)
            </span>
            <textarea
              rows={5}
              value={lessonForm.content}
              onChange={(e) => setLessonForm({ ...lessonForm, content: e.target.value })}
              className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5"
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
            className="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50"
          >
            {aiBusy ? 'Generating…' : '✦ Generate 5 questions'}
          </button>
        }
      >
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Lesson content
          </span>
          <textarea
            rows={10}
            value={aiContent}
            onChange={(e) => setAiContent(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 font-mono"
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
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5"
      />
    </label>
  );
}
