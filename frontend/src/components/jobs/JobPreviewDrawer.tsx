import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { JobDetailPane } from './JobDetailPane';

/**
 * Mobile/tablet preview: a right-edge drawer that renders <JobDetailPane>.
 * (On desktop the same pane lives inline in the master-detail split, so the
 * drawer is only mounted below lg.) Follows the shared modal rules: portaled to
 * <body>, full-screen blurred backdrop, Escape-to-close, body scroll lock.
 */
export function JobPreviewDrawer({
  jobId,
  matchScore,
  matchWhy,
  matchedSkills = [],
  missingSkills = [],
  isConsultant,
  onClose,
}: {
  jobId: string | null;
  matchScore?: number | null;
  matchWhy?: string | null;
  matchedSkills?: string[];
  missingSkills?: string[];
  isConsultant: boolean;
  onClose: () => void;
}) {
  const open = jobId != null;

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
        className="relative flex h-dvh w-full max-w-3xl flex-col bg-bg shadow-2xl animate-slide-in-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur safe-pt">
          <span className="min-w-0 truncate text-sm font-semibold text-ink">Job preview</span>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              to={`/jobs/${jobId}`}
              onClick={onClose}
              className="whitespace-nowrap text-xs text-muted hover:text-ink"
            >
              Open full page ↗
            </Link>
            <button
              onClick={onClose}
              aria-label="Close preview"
              className="press inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>

        <JobDetailPane
          jobId={jobId}
          matchScore={matchScore}
          matchWhy={matchWhy}
          matchedSkills={matchedSkills}
          missingSkills={missingSkills}
          isConsultant={isConsultant}
          className="flex-1"
        />
      </div>
    </div>,
    document.body,
  );
}
