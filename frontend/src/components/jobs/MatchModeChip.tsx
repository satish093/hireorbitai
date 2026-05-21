/**
 * Single-line chip explaining a non-default match mode. Replaces the two
 * verbose banners we used to render when /jobs/recommended set the
 * x-match-mode header to "skills-only" or "no-consultant".
 */
export function MatchModeChip({
  mode,
  isRecruiterMode,
}: {
  mode: string;
  isRecruiterMode: boolean;
}) {
  if (mode === 'skills-only') {
    return (
      <span className="inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 rounded-full px-3 py-1 text-xs font-medium">
        <span aria-hidden="true">⚡</span>
        <span>
          Scored against your skills only —{' '}
          <a className="underline hover:text-amber-900" href="/resumes">
            upload a resume
          </a>{' '}
          for sharper matches.
        </span>
      </span>
    );
  }
  if (mode === 'no-consultant' && isRecruiterMode) {
    return (
      <span className="inline-flex items-center gap-2 bg-sky-50 dark:bg-sky-500/15 border border-sky-200 dark:border-sky-500/30 text-sky-800 dark:text-sky-300 rounded-full px-3 py-1 text-xs font-medium">
        <span aria-hidden="true">ℹ️</span>
        <span>Pick a consultant in the targeting bar to see resume-aware match scores.</span>
      </span>
    );
  }
  if (mode === 'no-signal') {
    return (
      <span className="inline-flex items-center gap-2 bg-hover border border-border text-ink rounded-full px-3 py-1 text-xs font-medium">
        <span aria-hidden="true">ℹ️</span>
        <span>Add skills to your profile for personalised matches.</span>
      </span>
    );
  }
  return null;
}
