import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';

const CATEGORIES = [
  'Java',
  'Spring Boot',
  'React',
  'Angular',
  'Node.js',
  'QA Automation',
  'Selenium',
  'Playwright',
  'Cypress',
  'DevOps',
  'AWS',
  'Azure',
  'SQL',
  'Data Engineering',
  'Data Science',
  'Machine Learning',
  'AI',
  'Network Security',
  'Application Security',
  'Cybersecurity',
  'Cloud Security',
  'Interview Preparation',
  'Communication Skills',
  'Resume Building',
  'Banking Domain',
  'Insurance Domain',
  'Healthcare Domain',
];

export function CreateTrainingCourse() {
  const nav = useNavigate();
  const [form, setForm] = useState<any>({
    title: '',
    description: '',
    category: 'Java',
    difficulty: 'BEGINNER',
    estimated_duration_hours: '',
    tags: '',
    status: 'DRAFT',
    // I-983 fields — one item per line in the textareas.
    learning_objectives: '',
    skills_taught: '',
    assessment_methods: '',
    stem_relevance: '',
    weekly_hours: '',
  });
  const [saving, setSaving] = useState(false);

  function linesToArr(s: string): string[] {
    return s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async function save() {
    if (!form.title.trim()) {
      toast.error('Title required');
      return;
    }
    setSaving(true);
    try {
      const r = await api.post('/training/courses', {
        ...form,
        estimated_duration_hours: form.estimated_duration_hours
          ? Number(form.estimated_duration_hours)
          : null,
        tags: form.tags
          ? String(form.tags)
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [],
        learning_objectives: linesToArr(form.learning_objectives),
        skills_taught: linesToArr(form.skills_taught),
        assessment_methods: linesToArr(form.assessment_methods),
        stem_relevance: form.stem_relevance || null,
        weekly_hours: form.weekly_hours ? Number(form.weekly_hours) : null,
      });
      toast.success('Course created');
      nav(`/training/courses/${r.data.id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout
      title="New training course"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Training', to: '/training' },
        { label: 'Courses', to: '/training/courses' },
        { label: 'New' },
      ]}
    >
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight mb-5">New training course</h1>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <Field
            label="Title"
            value={form.title}
            onChange={(v) => setForm({ ...form, title: v })}
            required
          />
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Description
            </span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Selector
              label="Category"
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
              options={CATEGORIES}
            />
            <Selector
              label="Difficulty"
              value={form.difficulty}
              onChange={(v) => setForm({ ...form, difficulty: v })}
              options={['BEGINNER', 'INTERMEDIATE', 'ADVANCED']}
            />
            <Field
              type="number"
              label="Estimated duration (hours)"
              value={form.estimated_duration_hours}
              onChange={(v) => setForm({ ...form, estimated_duration_hours: v })}
            />
            <Selector
              label="Status"
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={['DRAFT', 'ACTIVE', 'ARCHIVED']}
            />
          </div>
          <Field
            label="Tags (comma separated)"
            value={form.tags}
            onChange={(v) => setForm({ ...form, tags: v })}
            hint="e.g. java, spring, rest"
          />
          <Field
            label="Thumbnail URL (optional)"
            value={form.thumbnail_url ?? ''}
            onChange={(v) => setForm({ ...form, thumbnail_url: v })}
          />
        </div>

        {/* I-983 STEM-OPT Training Plan metadata. Filling these in turns the
            course into an audit-ready training module the supervisor can
            attach to the I-983 Section 5 + 6. */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              I-983
            </span>
            <h2 className="text-sm font-semibold tracking-tight">STEM-OPT Training Plan fields</h2>
          </div>
          <p className="text-xs text-slate-500">
            These map directly to the DHS I-983 Section 5 + 6 attestation. Fill them in for any
            course you'll list on a STEM-OPT training plan.
          </p>
          <TextArea
            label="Learning objectives (one per line)"
            rows={5}
            value={form.learning_objectives}
            onChange={(v) => setForm({ ...form, learning_objectives: v })}
            hint="4–6 measurable objectives. Each becomes a bullet on the plan."
          />
          <TextArea
            label="Skills / knowledge / techniques taught (one per line)"
            rows={4}
            value={form.skills_taught}
            onChange={(v) => setForm({ ...form, skills_taught: v })}
          />
          <TextArea
            label="Assessment methods (one per line)"
            rows={3}
            value={form.assessment_methods}
            onChange={(v) => setForm({ ...form, assessment_methods: v })}
            hint="e.g. End-of-module quiz, capstone project, supervisor code review."
          />
          <TextArea
            label="STEM degree relevance"
            rows={3}
            value={form.stem_relevance}
            onChange={(v) => setForm({ ...form, stem_relevance: v })}
            hint="1–2 sentences tying this course to the student's STEM coursework."
          />
          <Field
            type="number"
            label="Weekly hours of focused training"
            value={form.weekly_hours}
            onChange={(v) => setForm({ ...form, weekly_hours: v })}
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => nav(-1)}
            className="border border-slate-200 text-slate-700 text-sm px-4 py-2 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-slate-900 text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </Layout>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  required,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      />
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </label>
  );
}
function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      />
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </label>
  );
}
function Selector({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
