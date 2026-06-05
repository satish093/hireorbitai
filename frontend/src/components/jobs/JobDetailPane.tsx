import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../services/api';
import { JobDetailView } from '../JobDetailView';
import { SkeletonCard } from '../Skeleton';
import { MatchExplain } from './MatchExplain';
import { resolveApplyUrl, type Job } from '../../lib/jobFormat';

/**
 * Fetches the full job for a selected feed row and renders the detail content:
 * the "why this score" explainer (from the feed-carried match context), the full
 * <JobDetailView>, and a pinned Apply bar. Shared by the mobile preview drawer
 * (overlay) and the desktop master-detail split (right pane). The parent owns
 * the height + chrome; this is a self-scrolling flex column.
 */
export function JobDetailPane({
  jobId,
  matchScore,
  matchWhy,
  matchedSkills = [],
  missingSkills = [],
  isConsultant,
  className,
}: {
  jobId: string;
  matchScore?: number | null;
  matchWhy?: string | null;
  matchedSkills?: string[];
  missingSkills?: string[];
  isConsultant: boolean;
  className?: string;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setJob(null);
    api
      .get(`/jobs/${jobId}`)
      .then((r) => alive && setJob(r.data as Job))
      .catch(() => alive && setJob(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [jobId]);

  return (
    <div className={clsx('flex min-h-0 flex-col', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {typeof matchScore === 'number' && (
          <MatchExplain
            score={matchScore}
            why={matchWhy ?? null}
            matched={matchedSkills}
            missing={missingSkills}
            className="mb-4"
          />
        )}
        {loading || !job ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <JobDetailView job={job} isConsultant={isConsultant} embedded />
        )}
      </div>

      {job && (
        <div className="shrink-0 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur safe-pb">
          <a
            href={resolveApplyUrl(job)}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex w-full items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90"
          >
            Apply on company site <span aria-hidden="true">↗</span>
          </a>
        </div>
      )}
    </div>
  );
}
