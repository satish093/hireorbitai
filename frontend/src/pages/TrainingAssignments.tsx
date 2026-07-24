import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { AssignmentTable, AssignmentRow } from '../components/Training';
import { SkeletonCard } from '../components/Skeleton';

export function TrainingAssignments() {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params: any = {};
      if (status) params.status = status;
      const r = await api.get('/training/assignments', { params });
      setRows(r.data ?? []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [status]);

  return (
    <Layout
      title="Training assignments"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Training', to: '/training' },
        { label: 'Assignments' },
      ]}
    >
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="text-sm border border-border rounded-md px-2 py-1.5"
        >
          <option value="">All statuses</option>
          {[
            ['NOT_STARTED', 'Not started'],
            ['IN_PROGRESS', 'In progress'],
            ['COMPLETED', 'Completed'],
            ['OVERDUE', 'Overdue'],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <SkeletonCard lines={6} />
      ) : (
        <AssignmentTable rows={rows} viewBase="/training/assignments" />
      )}
    </Layout>
  );
}
