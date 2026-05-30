import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { StickyActionBar } from '../components/StickyActionBar';
import { Button } from '../components/Button';
import { JobDetailView } from '../components/JobDetailView';
import { BenchMatchesCard } from '../components/jobs/BenchMatchesCard';
import { RecruiterNoteCard } from '../components/jobs/RecruiterNoteCard';
import { NewSubmissionModal } from '../components/NewSubmissionModal';
import {
  fetchBenchMatches,
  fetchRecruiterNote,
  saveRecruiterNote,
  type BenchMatch,
} from '../components/jobs/jobsApi';
import { useAuth } from '../context/AuthContext';
import { useFeatureFlag } from '../hooks/useFeatureFlags';
import { api } from '../services/api';
import type { Job } from '../lib/jobFormat';
import clsx from 'clsx';

/**
 * Full-page job detail at /jobs/:id.
 * Desktop: JobDetailView + bench matches + recruiter note (side panel for operators).
 * Mobile: same content + sticky "Submit a consultant" bar at bottom.
 */
export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const aiMatchEnabled = useFeatureFlag('ai_match');

  const isConsultant = profile?.role === 'CONSULTANT';
  const isRecruiterMode = !!profile && profile.role !== 'CONSULTANT';

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submissionOpen, setSubmissionOpen] = useState(false);

  // Recruiter-mode extras
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

  const matchScore = aiMatchEnabled && job?.match_score != null ? job.match_score : null;

  return (
    <Layout title="Job detail" crumbs={[{ label: 'Jobs', to: '/jobs' }, { label: 'Detail' }]}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link to="/jobs" className="text-sm text-muted hover:text-ink">
          ← Back to jobs
        </Link>

        {/* AI match pill — desktop only (mobile sees it inline) */}
        {matchScore != null && (
          <div className="hidden md:flex items-center gap-1.5">
            <MatchPill score={matchScore} />
          </div>
        )}

        {/* Desktop submit CTA */}
        {isRecruiterMode && job && (
          <Button
            variant="accent"
            className="hidden md:inline-flex"
            onClick={() => setSubmissionOpen(true)}
          >
            Submit a consultant
          </Button>
        )}
      </div>

      {/* Mobile: AI match pill inline */}
      {matchScore != null && (
        <div className="md:hidden flex items-center gap-2 mb-3">
          <MatchPill score={matchScore} />
        </div>
      )}

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
        /* Extra padding on mobile so the StickyActionBar doesn't overlap content */
        <div className={clsx('space-y-5', isRecruiterMode && 'pb-20 md:pb-0')}>
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

      {/* ── Mobile sticky "Submit a consultant" bar ── */}
      {isRecruiterMode && job && !loading && !notFound && (
        <div className="md:hidden">
          <StickyActionBar>
            <Button variant="accent" block onClick={() => setSubmissionOpen(true)}>
              Submit a consultant
            </Button>
          </StickyActionBar>
        </div>
      )}

      {/* ── New submission modal pre-filled with this job ── */}
      {job && (
        <NewSubmissionModal
          open={submissionOpen}
          onClose={() => setSubmissionOpen(false)}
          preJobId={job.id}
          preJobLabel={job.title}
          preJobSublabel={job.company_name ?? job.client?.company_name ?? undefined}
          onSuccess={() => setSubmissionOpen(false)}
        />
      )}
    </Layout>
  );
}

// ── AI match pill ─────────────────────────────────────────────────────────

function MatchPill({ score }: { score: number }) {
  const color = score >= 88 ? 'var(--emerald)' : score >= 75 ? 'var(--blue)' : 'var(--amber)';
  return (
    <span
      className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-lg"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      ✦ {score}% match
    </span>
  );
}
