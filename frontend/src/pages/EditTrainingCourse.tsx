import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { SkeletonCard } from '../components/Skeleton';
import { Button } from '../components/Button';

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

export function EditTrainingCourse() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [form, setForm] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .get(`/training/courses/${id}`)
      .then((r) =>
        setForm({
          ...r.data,
          tags: (r.data.tags ?? []).join(', '),
          learning_objectives: (r.data.learning_objectives ?? []).join('\n'),
          skills_taught: (r.data.skills_taught ?? []).join('\n'),
          assessment_methods: (r.data.assessment_methods ?? []).join('\n'),
          stem_relevance: r.data.stem_relevance ?? '',
          weekly_hours: r.data.weekly_hours ?? '',
        }),
      )
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load'));
  }, [id]);

  function linesToArr(s: string): string[] {
    return String(s ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/training/courses/${id}`, {
        title: form.title,
        description: form.description,
        category: form.category,
        difficulty: form.difficulty,
        estimated_duration_hours: form.estimated_duration_hours
          ? Number(form.estimated_duration_hours)
          : null,
        tags:
          typeof form.tags === 'string'
            ? form.tags
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean)
            : (form.tags ?? []),
        status: form.status,
        thumbnail_url: form.thumbnail_url ?? null,
        learning_objectives: linesToArr(form.learning_objectives),
        skills_taught: linesToArr(form.skills_taught),
        assessment_methods: linesToArr(form.assessment_methods),
        stem_relevance: form.stem_relevance || null,
        weekly_hours: form.weekly_hours ? Number(form.weekly_hours) : null,
      });
      toast.success('Course saved');
      nav(`/training/courses/${id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (!form)
    return (
      <Layout title="Edit course">
        <div className="max-w-2xl">
          <SkeletonCard lines={6} />
        </div>
      </Layout>
    );

  return (
    <Layout
      title="Edit course"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Training', to: '/training' },
        { label: 'Courses', to: '/training/courses' },
        { label: form.title },
      ]}
    >
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight mb-5">Edit course</h1>
        <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
          <Field
            label="Title"
            value={form.title}
            onChange={(v) => setForm({ ...form, title: v })}
          />
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Description
            </span>
            <textarea
              rows={3}
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              label="Duration (hours)"
              value={form.estimated_duration_hours ?? ''}
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
            value={form.tags ?? ''}
            onChange={(v) => setForm({ ...form, tags: v })}
          />
          <Field
            label="Thumbnail URL"
            value={form.thumbnail_url ?? ''}
            onChange={(v) => setForm({ ...form, thumbnail_url: v })}
          />
        </div>

        {/* I-983 STEM-OPT Training Plan metadata. */}
        <div className="bg-surface border border-border rounded-2xl p-6 space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
              I-983
            </span>
            <h2 className="text-sm font-semibold tracking-tight">STEM-OPT Training Plan fields</h2>
          </div>
          <TextArea
            label="Learning objectives (one per line)"
            rows={5}
            value={form.learning_objectives ?? ''}
            onChange={(v) => setForm({ ...form, learning_objectives: v })}
          />
          <TextArea
            label="Skills / knowledge / techniques taught (one per line)"
            rows={4}
            value={form.skills_taught ?? ''}
            onChange={(v) => setForm({ ...form, skills_taught: v })}
          />
          <TextArea
            label="Assessment methods (one per line)"
            rows={3}
            value={form.assessment_methods ?? ''}
            onChange={(v) => setForm({ ...form, assessment_methods: v })}
          />
          <TextArea
            label="STEM degree relevance"
            rows={3}
            value={form.stem_relevance ?? ''}
            onChange={(v) => setForm({ ...form, stem_relevance: v })}
          />
          <Field
            type="number"
            label="Weekly hours"
            value={form.weekly_hours ?? ''}
            onChange={(v) => setForm({ ...form, weekly_hours: v })}
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => nav(-1)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving} loading={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
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
}: {
  label: string;
  value: any;
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
function TextArea({
  label,
  value,
  onChange,
  rows = 3,
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
        className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
      />
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
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5 bg-surface"
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
