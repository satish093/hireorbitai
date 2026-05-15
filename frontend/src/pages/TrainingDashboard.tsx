import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { TrainingProgressBar } from '../components/Training';
import { DashboardCard } from '../components/DashboardCard';

export function TrainingDashboard() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/training/reports')
      .then((r) => setData(r.data))
      .catch((e) =>
        toast.error(
          e?.response?.data?.error ?? 'Failed to load reports (run database/training.sql)',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout
      title="Training"
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Training' }]}
    >
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Training overview</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/training/courses"
            className="border border-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
          >
            Courses
          </Link>
          <Link
            to="/training/assignments"
            className="border border-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
          >
            Assignments
          </Link>
          <Link
            to="/training/reports"
            className="bg-slate-900 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800"
          >
            Reports →
          </Link>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <DashboardCard label="Active courses" value={data.active_courses} accent="blue" />
            <DashboardCard
              label="Total assignments"
              value={data.total_assignments}
              accent="slate"
            />
            <DashboardCard label="Completed" value={data.completed_assignments} accent="green" />
            <DashboardCard label="Overdue" value={data.overdue_assignments} accent="amber" />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
            <div className="text-[10px] font-semibold tracking-widest uppercase text-slate-500 mb-2">
              Overall completion rate
            </div>
            <TrainingProgressBar
              value={data.completion_rate}
              label={`${data.completed_assignments}/${data.total_assignments} assignments completed`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Top consultants (by completed)">
              {data.top_consultants.length === 0 ? (
                <p className="text-xs italic text-slate-400">No completions yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {data.top_consultants.map((t: any) => (
                    <li key={t.user_id} className="flex justify-between">
                      <Link
                        to={`/users/${t.user_id}`}
                        className="text-slate-700 hover:text-brand-700 truncate font-mono text-xs"
                      >
                        {t.user_id.slice(0, 8)}…
                      </Link>
                      <span className="text-slate-900 font-semibold tabular-nums">
                        {t.completed}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Courses by category">
              <ul className="space-y-1.5 text-sm">
                {data.by_category.map((c: any) => (
                  <li key={c.category} className="flex justify-between">
                    <span className="text-slate-700">{c.category}</span>
                    <span className="text-slate-900 font-semibold tabular-nums">{c.courses}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </>
      )}
    </Layout>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-slate-500 mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}
