import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { JobDetailView } from '../components/JobDetailView';
import { BenchMatchesCard } from '../components/jobs/BenchMatchesCard';
import { RecruiterNoteCard } from '../components/jobs/RecruiterNoteCard';
import {
  fetchBenchMatches,
  fetchRecruiterNote,
  saveRecruiterNote,
  type BenchMatch,
} from '../components/jobs/jobsApi';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import type { Job } from '../lib/jobFormat';

/**
 * Full-page job detail at /jobs/:id. Each job card on the list links here.
 * Renders the shared JobDetailView (About / Requirements / AI Copilot) and, for
 * recruiter/manager viewers, the bench-matches + recruiter-note cards that
 * previously lived in the list's side pane.
 */
export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isConsultant = profile?.role === 'CONSULTANT';
  const isRecruiterMode = !!profile && profile.role !== 'CONSULTANT';

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Recruiter-mode extras.
  const [bench, setBench] = useState<BenchMatch[]>([]);
  const [benchLoading, setBenchLoading] = useState(false);
  const [note, setNote] = useState<{
    body: string;
    author?: string | null;
    updated_at?: string | null;
  } | null>(null);

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

  useEffect(() => {
    if (!id || !isRecruiterMode) return;
    let alive = true;
    setBenchLoading(true);
    fetchBenchMatches(id)
      .then((m) => alive && setBench(m))
      .finally(() => alive && setBenchLoading(false));
    fetchRecruiterNote(id).then((n) => alive && setNote(n));
    return () => {
      alive = false;
    };
  }, [id, isRecruiterMode]);

  return (
    <Layout title="Job detail" crumbs={[{ label: 'Jobs', to: '/jobs' }, { label: 'Detail' }]}>
      <div className="mb-4">
        <Link to="/jobs" className="text-sm text-muted hover:text-ink">
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
                className="text-sm px-4 py-2 rounded-lg bg-ink text-bg hover:opacity-90"
              >
                Browse jobs
              </Link>
            }
          />
        </div>
      ) : (
        <div className="space-y-5">
          <JobDetailView job={job} isConsultant={isConsultant} />
          {isRecruiterMode && (
            <div className="grid gap-4 lg:grid-cols-2 items-start">
              <BenchMatchesCard
                matches={bench}
                loading={benchLoading}
                selectedConsultantId={null}
                onSeeAll={() => navigate('/consultants')}
              />
              <RecruiterNoteCard
                note={note?.body ?? ''}
                author={note?.author ?? undefined}
                updatedAt={note?.updated_at ?? undefined}
                onSave={async (body) => {
                  // Use the server's response so the author + updated_at are
                  // the fresh values (previously the UI fell back to the
                  // stale `note?.author` from before the save — which is
                  // undefined for first-time notes — and the byline was
                  // blank until a full page reload).
                  const saved = await saveRecruiterNote(job.id, body);
                  setNote({
                    body: saved.body,
                    author: saved.author ?? null,
                    updated_at: saved.updated_at ?? new Date().toISOString(),
                  });
                }}
              />
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
