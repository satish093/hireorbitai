import { useEffect, useState } from 'react';
import { listHireorbitSyncedJobs, type HireorbitSyncedJob } from './jobsApi';

/**
 * Read-only display of jobs synced in from the external HACP/Oracle agent
 * (public.hireorbit_jobs). Fully self-contained — its own fetch/state,
 * independent of useJobSearch()/JobCard/TabKey. Deliberately not merged
 * into the main job board: this data comes from a separate, immutable
 * table and separate ingestion pipeline.
 */
export function HireorbitSyncedPanel() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<HireorbitSyncedJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listHireorbitSyncedJobs()
      .then((rows) => {
        if (cancelled) return;
        setJobs(rows);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load synced jobs right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  function formatSalary(j: HireorbitSyncedJob): string | null {
    if (!j.salary_min && !j.salary_max) return null;
    const cur = j.salary_currency ?? 'USD';
    const lo = j.salary_min ? j.salary_min.toLocaleString() : null;
    const hi = j.salary_max ? j.salary_max.toLocaleString() : null;
    if (lo && hi) return `${cur} ${lo}–${hi}`;
    return `${cur} ${lo ?? hi}`;
  }

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium">Externally Synced Jobs</span>
          <span className="rounded-full bg-muted/10 px-2 py-0.5 text-[11px] text-muted">
            HACP agent feed · read-only
          </span>
        </span>
        <span className="text-xs text-muted">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-3 text-xs text-muted">
            Jobs synced in from the external HACP/Oracle agent. This is a separate feed from the job
            board above — it isn't deduped or matched against your profile.
          </p>

          {loading && <div className="text-sm text-muted">Loading…</div>}
          {error && <div className="text-sm text-danger">{error}</div>}
          {!loading && !error && loaded && jobs.length === 0 && (
            <div className="text-sm text-muted">No synced jobs yet.</div>
          )}

          {!loading && jobs.length > 0 && (
            <ul className="flex flex-col gap-2">
              {jobs.map((j) => (
                <li key={j.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-medium">{j.title}</span>
                    <span className="text-xs text-muted">
                      {[j.company, j.location].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    {j.work_model && <span>{j.work_model}</span>}
                    {j.seniority_level && <span>{j.seniority_level}</span>}
                    {j.h1b_sponsorship && <span>H1B sponsorship</span>}
                    {formatSalary(j) && <span>{formatSalary(j)}</span>}
                    {j.posted_date && <span>Posted {j.posted_date}</span>}
                  </div>
                  {j.skills_tags && <div className="mt-1 text-xs text-muted">{j.skills_tags}</div>}
                  {j.apply_url && (
                    <a
                      href={j.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-primary underline"
                    >
                      View listing
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
