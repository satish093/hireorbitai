import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { JobsLayout } from '../components/JobsLayout';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { JobDetailView } from '../components/JobDetailView';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import type { Job } from '../lib/jobFormat';

/**
 * Full-page job detail at /jobs/:id. Replaces the old slide-in overlay so the
 * content lives in normal document flow (no off-screen clipping). Fetches the
 * single job via GET /jobs/:id and hands it to JobDetailView.
 */
export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const isConsultant = profile?.role === 'CONSULTANT';

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    api
      .get(`/jobs/${id}`)
      .then((r) => {
        if (!cancelled) setJob(r.data as Job);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <JobsLayout>
      <div className="mb-4">
        <Link to="/jobs" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to jobs
        </Link>
      </div>

      {loading ? (
        <div className="max-w-5xl mx-auto space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : notFound || !job ? (
        <div className="max-w-5xl mx-auto">
          <EmptyState
            title="Job not found"
            description="This listing may have been removed or is no longer active."
            action={
              <Link
                to="/jobs"
                className="text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
              >
                Browse jobs
              </Link>
            }
          />
        </div>
      ) : (
        <JobDetailView job={job} isConsultant={isConsultant} />
      )}
    </JobsLayout>
  );
}
