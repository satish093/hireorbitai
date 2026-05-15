import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { TrainingCourseCard, CourseCardData } from '../components/Training';
import { useAuth } from '../context/AuthContext';
import { MANAGER_TIER } from '../types';

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
  const [rows, setRows] = useState<CourseCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', category: '' });

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

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && rows.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
          No courses yet. Apply <span className="font-mono text-xs">database/training.sql</span> and
          refresh — or create one.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((c) => (
          <TrainingCourseCard key={c.id} course={c} to={`/training/courses/${c.id}`} />
        ))}
      </div>
    </Layout>
  );
}
