import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { TrainingProgressBar } from '../components/Training';
import { DashboardCard } from '../components/DashboardCard';
import { SkeletonMetricGrid } from '../components/Skeleton';
import { StemOptDisclaimer } from '../components/StemOptDisclaimer';

export function TrainingReports() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/training/reports')
      .then((r) => setData(r.data))
      .catch((e) =>
        toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.'),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout
      title="Training reports"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Training', to: '/training' },
        { label: 'Reports' },
      ]}
    >
      <h1 className="text-2xl font-semibold tracking-tight mb-5">Training effectiveness</h1>
      {loading && <SkeletonMetricGrid count={4} />}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <DashboardCard
              label="Courses (active)"
              value={`${data.active_courses}/${data.total_courses}`}
              accent="blue"
            />
            <DashboardCard
              label="Total assignments"
              value={data.total_assignments}
              accent="slate"
            />
            <DashboardCard label="Completed" value={data.completed_assignments} accent="green" />
            <DashboardCard label="Overdue" value={data.overdue_assignments} accent="amber" />
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 mb-5">
            <div className="text-[10px] font-semibold tracking-widest uppercase text-muted mb-2">
              Completion rate
            </div>
            <TrainingProgressBar
              value={data.completion_rate}
              label={`${data.completed_assignments} of ${data.total_assignments}`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Top consultants">
              {data.top_consultants.length === 0 ? (
                <p className="text-xs italic text-muted">No completions yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {data.top_consultants.map((t: any) => (
                    <li key={t.user_id} className="flex justify-between">
                      <span className="font-mono text-xs text-muted">{t.user_id.slice(0, 8)}…</span>
                      <span className="font-semibold tabular-nums">{t.completed}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="By category">
              <ul className="space-y-1.5 text-sm">
                {data.by_category.map((c: any) => (
                  <li key={c.category} className="flex justify-between">
                    <span className="text-ink">{c.category}</span>
                    <span className="font-semibold tabular-nums">{c.courses}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
      <StemOptDisclaimer />
    </Layout>
  );
}

function Panel({ title, children }: { title: string; children: any }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-muted mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}
