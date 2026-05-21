import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { TrainingCourseCard, CourseCardData } from '../components/Training';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { MANAGER_TIER, ADMIN_TIER } from '../types';

const CATEGORIES = [
  '',
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
  'Interview Preparation',
  'Communication Skills',
  'Resume Building',
  'Banking Domain',
  'Insurance Domain',
  'Healthcare Domain',
];

export function TrainingCourses() {
  const { profile } = useAuth();
  const isManager = !!profile && (MANAGER_TIER as string[]).includes(profile.role);
  const isAdmin = !!profile && (ADMIN_TIER as string[]).includes(profile.role);
  const [rows, setRows] = useState<CourseCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', category: '' });
  const [backfilling, setBackfilling] = useState(false);

  async function backfillAll() {
    if (
      !confirm(
        'Use AI to fill in the overview, roadmap, resources, and final project for every course that is missing them? Existing lessons are left unchanged.',
      )
    )
      return;
    setBackfilling(true);
    try {
      const r = await api.post('/training/courses/backfill');
      const enriched = (r.data?.results ?? []).filter((x: any) => x.result === 'enriched').length;
      toast.success(`Done · ${enriched} course(s) updated`);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const params: any = {};
      if (filter.status) params.status = filter.status;
      if (filter.category) params.category = filter.category;
      const r = await api.get('/training/courses', { params });
      setRows(r.data ?? []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to load courses');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [filter.status, filter.category]);

  return (
    <Layout
      title="Training courses"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Training', to: '/training' },
        { label: 'Courses' },
      ]}
    >
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
        <div className="flex items-center gap-2">
          <select
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            className="text-sm border border-slate-200 rounded-md px-2 py-1.5"
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <select
            value={filter.category}
            onChange={(e) => setFilter({ ...filter, category: e.target.value })}
            className="text-sm border border-slate-200 rounded-md px-2 py-1.5"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c || 'All categories'}
              </option>
            ))}
          </select>
          {isAdmin && (
            <button
              onClick={backfillAll}
              disabled={backfilling}
              title="Use AI to fill in missing course materials (overview, roadmap, resources, final project). Lessons are left unchanged."
              className="border border-brand-200 text-brand-700 bg-brand-50 text-sm px-3 py-2 rounded-lg hover:bg-brand-100 disabled:opacity-50"
            >
              {backfilling ? 'Filling in…' : '✦ Fill in missing materials'}
            </button>
          )}
          {isManager && (
            <Link
              to="/training/courses/new"
              className="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-800"
            >
              + New course
            </Link>
          )}
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} lines={3} />
          ))}
        </div>
      )}
      {!loading && rows.length === 0 && (
        <EmptyState
          icon="📚"
          title="No courses yet"
          description={
            isManager
              ? 'Create a course manually, or generate one with AI.'
              : 'No training courses are available yet.'
          }
        />
      )}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((c) => (
            <TrainingCourseCard key={c.id} course={c} to={`/training/courses/${c.id}`} />
          ))}
        </div>
      )}
    </Layout>
  );
}
