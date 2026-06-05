import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { JobDetailView } from '../JobDetailView';
import { SkeletonCard } from '../Skeleton';
import { resolveApplyUrl, type Job } from '../../lib/jobFormat';

/**
 * Jobright-style right-edge preview drawer. Clicking a card in the feed opens
 * this instead of navigating to /jobs/:id, so the user keeps their place in the
 * list. It fetches the full job (same payload as the detail page) and reuses
 * <JobDetailView> verbatim — including the recruiter "Candidate tools" panel.
 *
 * Follows the shared modal rules: portaled to <body> (so the fixed overlay
 * anchors to the viewport, not the transformed <main>), full-screen blurred
 * backdrop, Escape-to-close, body scroll lock. The panel anchors to the right
 * edge (flex justify-end) and slides in via animate-slide-in-panel.
 */
export function JobPreviewDrawer({
  jobId,
  matchScore,
  isConsultant,
  onClose,
}: {
  jobId: string | null;
  matchScore?: number | null;
  isConsultant: boolean;
  onClose: () => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const open = jobId != null;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Job preview"
    >
      <div
        className="relative h-dvh w-full max-w-3xl bg-bg shadow-2xl overflow-y-auto animate-slide-in-panel safe-pb"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header: title + close + full-page escape hatch. The focal
            match ring lives in the JobDetailView header just below. */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-bg/95 backdrop-blur px-4 py-3 safe-pt">
          <span className="text-sm font-semibold text-ink truncate min-w-0">Job preview</span>
          <div className="flex items-center gap-3 shrink-0">
            {jobId && (
              <Link
                to={`/jobs/${jobId}`}
                onClick={onClose}
                className="text-xs text-muted hover:text-ink whitespace-nowrap"
              >
                Open full page ↗
              </Link>
            )}
            <button
              onClick={onClose}
              aria-label="Close preview"
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-hover transition press"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 pb-24">
          {loading || !job ? (
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : (
            <JobDetailView job={job} isConsultant={isConsultant} headlineScore={matchScore} />
          )}
        </div>

        {/* Sticky apply bar — always reachable while scrolling the long detail. */}
        {job && (
          <div className="sticky bottom-0 z-10 border-t border-border bg-bg/95 backdrop-blur px-4 py-3 safe-pb">
            <a
              href={resolveApplyUrl(job)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full bg-ink text-bg text-sm font-medium px-4 py-2.5 rounded-lg hover:opacity-90 press"
            >
              Apply on company site <span aria-hidden="true">↗</span>
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
