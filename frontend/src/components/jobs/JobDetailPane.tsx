import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { JobDetailView } from '../JobDetailView';
import type { Job } from '../../lib/jobFormat';
import { relative, prettyType, prettyRate } from './helpers';
import type { JobRow } from './types';
import { CompBandCard } from './CompBandCard';
import { MatchBreakdownCard, type MatchFacet } from './MatchBreakdownCard';
import { BenchMatchesCard } from './BenchMatchesCard';
import { RecruiterNoteCard } from './RecruiterNoteCard';
import { InterviewTimeline } from './InterviewTimeline';
import {
  fetchBenchMatches,
  fetchRecruiterNote,
  saveRecruiterNote,
  type BenchMatch,
} from './jobsApi';

/** Small donut for the pane header match score. */
function Donut({ score }: { score: number | null }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = score ?? 0;
  const offset = c - (pct / 100) * c;
  const stroke =
    score == null
      ? 'var(--faint)'
      : score >= 85
        ? 'var(--success)'
        : score >= 75
          ? 'var(--accent)'
          : 'var(--muted)';
  return (
    <div className="relative shrink-0" style={{ width: 52, height: 52 }}>
      <svg viewBox="0 0 52 52" className="w-full h-full -rotate-90">
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--hover)" strokeWidth="5" />
        {score != null && (
          <circle
            cx="26"
            cy="26"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="5"
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[13px] font-mono font-semibold text-ink tabular-nums">
        {score == null ? '—' : `${score}%`}
      </span>
    </div>
  );
}

function MetaBit({ glyph, label }: { glyph: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-muted">
      <span aria-hidden="true">{glyph}</span>
      <span>{label}</span>
    </span>
  );
}

/**
 * Build the 5-facet match breakdown from whatever signals the job row carries.
 * Scores are anchored to the overall match_score (real per-facet scoring is a
 * backend concern). TODO: replace with server-provided facet scores.
 */
function buildFacets(job: JobRow): MatchFacet[] {
  const ms = typeof job.match_score === 'number' ? Math.round(job.match_score) : null;
  if (ms == null) return [];
  const reqs = job.requirements ?? {};
  const skills = (reqs.required_skills?.length ? reqs.required_skills : job.required_skills) ?? [];
  const minYears = reqs.min_years_of_experience ?? reqs.years_required ?? null;
  const auth = reqs.work_authorization ?? [];
  const workModel = reqs.work_model ?? (job.remote ? 'Remote-eligible' : 'Onsite');
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  return [
    {
      label: 'Skills match',
      score: ms,
      why: skills.length ? skills.slice(0, 4).join(' · ') : 'No skill signals on file',
    },
    {
      label: 'Years exp.',
      score: clamp(ms + 5),
      why: minYears != null ? `${minYears}+ years required` : 'Experience flexible',
    },
    {
      label: 'Location · visa',
      score: clamp(ms - 3),
      why: [workModel, auth.length ? auth.join(' / ') : null].filter(Boolean).join(' · '),
    },
    {
      label: 'Comp alignment',
      score: clamp(ms - 6),
      why:
        job.rate_min != null || job.rate_max != null
          ? `Ask within ${prettyRate(job.rate_min, job.rate_max)}`
          : 'No comp data',
    },
    {
      label: 'Recent activity',
      score: clamp(ms - 10),
      why: `Posted ${relative(job.posted_at ?? job.created_at)}`,
    },
  ];
}

/**
 * Master-detail right pane. Header + action bar are fixed; the body scrolls
 * independently. The body reuses <JobDetailView> for About/Requirements/Copilot
 * and surrounds it with the new comp/match/bench/note cards.
 */
export function JobDetailPane({
  job,
  isConsultant,
  isRecruiterMode,
  selectedConsultantId,
  applyUrl,
  onSave,
  onPitch,
  onApply,
  onViewApplication,
  onSeeBench,
}: {
  job: JobRow;
  isConsultant: boolean;
  isRecruiterMode: boolean;
  selectedConsultantId?: string | null;
  applyUrl: string;
  onSave: () => void;
  onPitch: () => void;
  onApply: () => void;
  onViewApplication?: () => void;
  onSeeBench?: () => void;
}) {
  const applied = !!job.application_id;
  const companyName =
    job.company_name ?? job.client?.company_name ?? job.vendor?.company_name ?? 'Confidential';
  const matchScore = typeof job.match_score === 'number' ? Math.round(job.match_score) : null;
  const facets = buildFacets(job);

  // Comp band — derive a market band around the role band (stub until the
  // backend serves real market data). TODO: wire to real comp benchmarks.
  const roleMin = job.rate_min ?? job.rate_max ?? null;
  const roleMax = job.rate_max ?? job.rate_min ?? null;
  const hasComp = roleMin != null && roleMax != null;

  // Bench matches + recruiter note are recruiter-mode concerns.
  const [bench, setBench] = useState<BenchMatch[]>([]);
  const [benchLoading, setBenchLoading] = useState(false);
  const [note, setNote] = useState<{
    body: string;
    author?: string | null;
    updated_at?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!isRecruiterMode) return;
    let alive = true;
    setBenchLoading(true);
    fetchBenchMatches(job.id)
      .then((m) => alive && setBench(m))
      .finally(() => alive && setBenchLoading(false));
    fetchRecruiterNote(job.id).then((n) => alive && setNote(n));
    return () => {
      alive = false;
    };
  }, [job.id, isRecruiterMode]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-elev">
      {/* Header (fixed) */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <span
            className="shrink-0 grid place-items-center rounded-[7px] bg-accent-soft text-accent text-sm font-semibold"
            style={{ width: 40, height: 40 }}
            aria-hidden="true"
          >
            {companyName.slice(0, 2).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-muted truncate">
              <span className="font-medium text-ink-2">{companyName}</span>
              {job.source && <span> · {job.source}</span>}
              <span> · {relative(job.posted_at ?? job.created_at)}</span>
            </div>
            <h2 className="text-lg font-semibold text-ink leading-tight mt-0.5">{job.title}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
              <MetaBit
                glyph="📍"
                label={job.location ?? (job.remote ? 'Remote' : 'Location N/A')}
              />
              <MetaBit glyph="💼" label={prettyType(job.job_type)} />
              {hasComp && <MetaBit glyph="$" label={prettyRate(job.rate_min, job.rate_max)} />}
            </div>
          </div>
          <Donut score={matchScore} />
        </div>
      </div>

      {/* Body (scrolls independently) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">
            Interview loop
          </div>
          <InterviewTimeline />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
          <div className="min-w-0">
            <JobDetailView job={job as unknown as Job} isConsultant={isConsultant} />
          </div>
          <div className="space-y-4">
            {hasComp && (
              <CompBandCard
                marketRange={[Math.round(roleMin! * 0.8), Math.round(roleMax! * 1.2)]}
                roleRange={[roleMin!, roleMax!]}
                askValue={null}
              />
            )}
            {facets.length > 0 && <MatchBreakdownCard facets={facets} />}
            {isRecruiterMode && (
              <BenchMatchesCard
                matches={bench}
                loading={benchLoading}
                selectedConsultantId={selectedConsultantId}
                onSeeAll={onSeeBench}
              />
            )}
            {isRecruiterMode && (
              <RecruiterNoteCard
                note={note?.body ?? ''}
                author={note?.author ?? undefined}
                updatedAt={note?.updated_at ?? undefined}
                onSave={async (body) => {
                  await saveRecruiterNote(job.id, body);
                  setNote({ body, author: note?.author, updated_at: new Date().toISOString() });
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Action bar (fixed) */}
      <div className="shrink-0 border-t border-border bg-bg-elev px-5 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0 text-[11px] font-mono text-muted truncate">
          {job.last_synced_at ? `synced ${relative(job.last_synced_at)}` : 'live posting'}
          <a
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-accent hover:underline"
          >
            View original posting ↗
          </a>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onSave}>
            {job.liked ? 'Saved' : 'Save'}
          </Button>
          <Button variant="outline" size="sm" onClick={onPitch}>
            Pitch
          </Button>
          {applied ? (
            <Button variant="outline" size="sm" onClick={onViewApplication}>
              Applied · view
            </Button>
          ) : (
            <Button variant="accent" size="sm" onClick={onApply}>
              Apply with AI
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
