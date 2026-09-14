import { useEffect, useState, type ReactNode } from 'react';
import {
  listHireorbitSyncedJobs,
  getHireorbitJobInsights,
  type HireorbitSyncedJob,
  type HireorbitAgentOutput,
} from './jobsApi';

const INSIGHT_FIELD_LABELS: Record<string, string> = {
  match_percentage: 'Match Percentage',
  match_score: 'Match Percentage',
  readiness: 'Readiness',
  roadmap: 'Upskilling Roadmap',
  upskilling_roadmap: 'Upskilling Roadmap',
  technical_questions: 'Technical Interview Questions',
  behavioral_questions: 'Behavioral Interview Questions',
  interview_questions: 'Interview Questions',
  portfolio_pitch: 'Tailored Portfolio Pitch',
  tailored_portfolio_pitch: 'Tailored Portfolio Pitch',
  github_scout: 'GitHub Scout',
};

function insightFieldLabel(key: string): string {
  return (
    INSIGHT_FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function renderInsightValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p className="text-sm">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc pl-4 text-sm">
        {value.map((item, i) => (
          <li key={i}>{typeof item === 'object' ? JSON.stringify(item) : String(item)}</li>
        ))}
      </ul>
    );
  }
  return (
    <pre className="whitespace-pre-wrap text-xs text-muted">{JSON.stringify(value, null, 2)}</pre>
  );
}

/** One agent's pre-computed output (public.hireorbit_agent_outputs), rendered generically —
 * the JSONB payload shape is whatever Antigravity sends, so known keys get friendly labels
 * and anything else still renders instead of being silently dropped. */
function AgentOutputCard({ output }: { output: HireorbitAgentOutput }) {
  const entries = Object.entries(output.payload);
  return (
    <div className="rounded-lg border border-border/60 p-2">
      <div className="mb-1 text-xs font-medium text-muted">{output.agent_id}</div>
      <div className="flex flex-col gap-2">
        {entries.map(([key, value]) => {
          const rendered = renderInsightValue(value);
          if (!rendered) return null;
          return (
            <div key={key}>
              <div className="text-xs font-medium">{insightFieldLabel(key)}</div>
              {rendered}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Collapsible "AI Agent Insights" sub-panel for one synced job — fetches
 * public.hireorbit_agent_outputs for that job's fingerprint on first expand.
 * Purely a display of what Antigravity already computed; never calls the
 * app's own native copilot/cover-letter/skill-gap endpoints. */
function AgentInsights({ fingerprint }: { fingerprint: string }) {
  const [open, setOpen] = useState(false);
  const [outputs, setOutputs] = useState<HireorbitAgentOutput[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getHireorbitJobInsights(fingerprint)
      .then((rows) => {
        if (cancelled) return;
        setOutputs(rows);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load AI insights right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded, fingerprint]);

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        aria-expanded={open}
      >
        {open ? 'Hide AI Agent Insights' : 'Show AI Agent Insights'}
      </button>
      {open && (
        <div className="mt-2">
          {loading && <div className="text-xs text-muted">Loading insights…</div>}
          {error && <div className="text-xs text-danger">{error}</div>}
          {!loading && !error && loaded && outputs.length === 0 && (
            <div className="text-xs text-muted">No AI insights synced for this job yet.</div>
          )}
          {!loading && outputs.length > 0 && (
            <div className="flex flex-col gap-2">
              {outputs.map((o) => (
                <AgentOutputCard key={o.id} output={o} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
                  <AgentInsights fingerprint={j.fingerprint} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
