import { useState } from 'react';
import clsx from 'clsx';
import { Avatar } from '../TaskBits';
import { Button } from '../Button';
import { SkillGap } from '../SkillGap';
import { useFeatureFlag } from '../../hooks/useFeatureFlags';
import { SOURCE_LABEL, SourceBadge, PublisherBadge } from './sourceTokens';
import { isEarly, prettyRate, prettyType, relative, scoreLabel } from './helpers';
import { STATUS_LABEL } from './types';
import type { AppStatus, JobRow } from './types';

function JobCard({
  job,
  isConsultant,
  onToggleLike,
  onOpenInsight,
  onApply,
  onChangeStatus,
}: {
  job: JobRow;
  isConsultant: boolean;
  onToggleLike: () => void;
  onOpenInsight: () => void;
  onApply: () => void;
  /** Optional — only supplied on the Applied tab when the row has an application_id. */
  onChangeStatus?: (next: AppStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // ai_match flag hides every AI match-score affordance (pill + circular
  // score in the expanded view). Default-allow on missing flag so older
  // installs keep showing the score.
  const aiMatchEnabled = useFeatureFlag('ai_match');
  const companyName =
    job.company_name ?? job.client?.company_name ?? job.vendor?.company_name ?? 'Confidential';
  const matchScore =
    aiMatchEnabled && typeof job.match_score === 'number' ? Math.round(job.match_score) : null;

  const reqs = job.requirements ?? {};
  const recTags = reqs.recommendation_tags ?? [];
  const authBullets = reqs.work_authorization ?? [];
  const highlights = reqs.highlights ?? [];
  const responsibilities = reqs.core_responsibilities ?? [];
  const skillSummaries = reqs.skill_summaries ?? [];
  const benefits = reqs.benefits_summaries ?? [];

  const minYears = reqs.min_years_of_experience ?? reqs.years_required ?? null;
  const seniority = reqs.job_seniority ?? reqs.level ?? job.level ?? null;
  const workModel = reqs.work_model ?? (job.remote ? 'Remote' : 'Onsite');
  const requiredSkills =
    (reqs.required_skills?.length ? reqs.required_skills : job.required_skills) ?? [];
  const enriched = !!job.requirements;

  return (
    // Entire card is clickable — opens the slide-in detail panel via
    // onOpenInsight. Interactive child elements (Apply, Like, expand, status
    // dropdown) stop propagation so they don't double-trigger the panel.
    // role="button" + tabIndex makes the card keyboard-accessible.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenInsight}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenInsight();
        }
      }}
      className="bg-surface border border-border rounded-xl flex overflow-hidden hover:border-border hover:shadow-md transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      {/* Left: job content */}
      <div className="flex-1 p-5 min-w-0">
        <div className="flex items-start gap-3">
          <Avatar name={companyName} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs text-muted">
                {relative(job.posted_at ?? job.created_at)}
              </span>
              {isEarly(job.posted_at ?? job.created_at) && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                  Be an early applicant
                </span>
              )}
              {job.source && <SourceBadge source={job.source} />}
              {/* Skip the publisher badge when it just repeats the source
                  (e.g. source 'linkedin' + publisher 'LinkedIn' → "LinkedIn
                  LinkedIn"). */}
              {job.publisher &&
                job.publisher.trim().toLowerCase() !==
                  (SOURCE_LABEL[job.source ?? ''] ?? job.source ?? '').toLowerCase() && (
                  <PublisherBadge publisher={job.publisher} />
                )}
              {aiMatchEnabled && typeof job.match_score === 'number' && (
                <MatchScoreChip score={Math.round(job.match_score)} />
              )}
              {job.application_status && !onChangeStatus && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                  {STATUS_LABEL[job.application_status as AppStatus] ?? job.application_status}
                </span>
              )}
              {job.applied_method && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded">
                  {job.applied_method === 'CUSTOMIZED' ? '✦ Customized' : 'Original'}
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={onOpenInsight}
              className="text-left !justify-start !h-auto !px-0 !bg-transparent group"
              title="View full requirements + match insight"
            >
              <h3 className="text-lg font-semibold text-ink leading-tight group-hover:text-brand-700 transition-colors">
                {job.title}
              </h3>
            </Button>
            <div className="text-sm text-muted mt-0.5">
              <span className="font-medium">{companyName}</span>
              {job.client && job.client.company_name !== companyName && (
                <span className="text-muted"> · {job.client.company_name}</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            pill
            leftIcon={<span>🔖</span>}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLike();
            }}
            title={job.liked ? 'Saved — click to remove' : 'Save job'}
            aria-label={job.liked ? 'Remove from saved' : 'Save job'}
            className={clsx(
              'shrink-0 border',
              job.liked
                ? 'bg-brand-50 border-brand-200 text-brand-600'
                : 'bg-surface border-border text-muted hover:text-brand-600 hover:border-brand-200',
            )}
          />
        </div>

        {/* Meta strip — Jobright-style key facts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-y-1.5 gap-x-6 mt-3 text-sm">
          <MetaItem icon="◎" label={job.location ?? 'Unknown location'} />
          <MetaItem icon="⌂" label={workModel} />
          <MetaItem icon="◷" label={prettyType(job.job_type)} />
          {(job.rate_min != null || job.rate_max != null) && (
            <MetaItem icon="$" label={prettyRate(job.rate_min, job.rate_max)} />
          )}
          <MetaItem icon="◯" label={seniority ?? 'Level not specified'} />
          <MetaItem
            icon="⌛"
            label={minYears != null ? `${minYears}+ years exp` : 'Experience not specified'}
          />
        </div>

        {/* Salary + high-signal flags — colored pills that read at a glance.
            Hidden entirely when there's no rate AND no recommendation tags
            so the card stays compact for un-enriched jobs. */}
        {(job.rate_min != null || job.rate_max != null || recTags.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <SalaryPill min={job.rate_min} max={job.rate_max} />
            {recTags.slice(0, 4).map((t) => (
              <HighlightTagChip key={t} tag={t} />
            ))}
          </div>
        )}

        {/* Description excerpt — visible even when AI enrichment hasn't run yet.
            Strips HTML tags, caps at 200 chars. Hidden when expanded so the
            expanded responsibilities + skills sections take over. */}
        {!expanded && job.description && (
          <p className="mt-3 text-sm text-muted leading-snug line-clamp-2">
            {job.description
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 200)}
            {job.description.length > 200 ? '…' : ''}
          </p>
        )}

        {/* The recommendation-tag chip row used to live here; the highest-
            signal flags (Sponsor / Remote / Hybrid / Clearance / Relocation)
            now appear in the meta-pill row directly under the title. */}

        {/* Required skills tags — capped to 6 visible with a "+N more" chip
            when the job has more, so the card height stays predictable. */}
        {requiredSkills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {requiredSkills.slice(0, 6).map((s) => (
              <span
                key={s}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-hover text-ink"
              >
                {s}
              </span>
            ))}
            {requiredSkills.length > 6 && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-hover text-muted border border-border">
                +{requiredSkills.length - 6} more
              </span>
            )}
          </div>
        )}

        {/* Skill gap card — only when expanded; cheap deterministic call, no AI */}
        {expanded && (
          <div className="mt-4">
            <SkillGap jobId={job.id} />
          </div>
        )}

        {/* Expanded details — skill summaries + responsibilities */}
        {expanded && enriched && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
            {responsibilities.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-1.5">
                  Core responsibilities
                </div>
                <ul className="space-y-1 text-sm text-ink">
                  {responsibilities.slice(0, 6).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-muted">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {skillSummaries.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-1.5">
                  Skill requirements
                </div>
                <ul className="space-y-1 text-sm text-ink">
                  {skillSummaries.slice(0, 6).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-muted">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {highlights.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-1.5">
                  Why it might fit
                </div>
                <ul className="space-y-1 text-sm text-ink">
                  {highlights.slice(0, 4).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-sky-500">★</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {benefits.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-1.5">
                  Benefits
                </div>
                <ul className="space-y-1 text-sm text-ink">
                  {benefits.slice(0, 4).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-emerald-500">+</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Applied-on caption (only on the Applied tab). */}
        {job.applied_at && (
          <div className="mt-3 text-xs text-muted">
            Applied on{' '}
            {new Date(job.applied_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </div>
        )}

        {/* Footer: Apply / Status + expand. Each interactive control stops
            propagation so it doesn't double-trigger the card's onOpenInsight. */}
        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          {onChangeStatus ? (
            <div onClick={(e) => e.stopPropagation()}>
              <StatusDropdown current={job.application_status} onChange={onChangeStatus} />
            </div>
          ) : (
            <Button
              variant="accent"
              size="md"
              onClick={(e) => {
                e.stopPropagation();
                onApply();
              }}
              rightIcon={<span>↗</span>}
            >
              Apply on company site
            </Button>
          )}
          <div className="flex items-center gap-3">
            {isConsultant && (
              <Button
                variant="outline"
                size="sm"
                pill
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInsight();
                }}
                title="Score your resume against this job's requirements"
              >
                ✦ Match Insight
              </Button>
            )}
            {!enriched && (
              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-100 dark:border-amber-500/20 px-2 py-0.5 rounded">
                Not yet enriched
              </span>
            )}
            {enriched && (responsibilities.length > 0 || skillSummaries.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? 'Show less ▴' : 'Show details ▾'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Right: match panel — shown whenever we have a score (consultant
          viewing their own page, OR recruiter mode with a targeted consultant). */}
      {(isConsultant || typeof job.match_score === 'number') && (
        <button
          type="button"
          onClick={onOpenInsight}
          className="w-64 shrink-0 bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 flex flex-col text-left hover:from-slate-800 hover:to-slate-700 transition"
          title="Open match insight"
        >
          <div className="relative w-20 h-20 self-center mb-2">
            <CircularScore score={matchScore} />
          </div>
          <div className="text-center">
            <div className="text-[11px] font-semibold tracking-widest text-emerald-300 uppercase">
              {scoreLabel(matchScore)}
            </div>
          </div>
          <ul className="text-xs text-white/80 mt-3 space-y-1 leading-snug">
            {(job.match_reasons ?? []).slice(0, 3).map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-emerald-300">✓</span>
                <span>{r}</span>
              </li>
            ))}
            {authBullets.slice(0, 2).map((w, i) => (
              <li key={`auth-${i}`} className="flex items-start gap-1.5">
                <span className="text-amber-300">•</span>
                <span>{w}</span>
              </li>
            ))}
            {highlights.slice(0, 1).map((h, i) => (
              <li key={`hl-${i}`} className="flex items-start gap-1.5">
                <span className="text-sky-300">★</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
          <span className="mt-auto pt-3 text-[11px] text-white/60 hover:text-white">
            View details →
          </span>
        </button>
      )}
    </div>
  );
}

function MetaItem({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-muted">
      <span className="text-muted">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

/**
 * Prominent colored match-score chip on every job card. Replaces the
 * easy-to-miss tiny "Match X%" badge. Color band:
 *   ≥ 85  → emerald   (strong)
 *   ≥ 70  → sky       (good)
 *   ≥ 50  → amber     (fair)
 *   < 50  → rose      (weak)
 */
function MatchScoreChip({ score }: { score: number }) {
  const tone =
    score >= 85
      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 ring-emerald-100'
      : score >= 70
        ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30 ring-sky-100'
        : score >= 50
          ? 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 ring-amber-100'
          : 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30 ring-rose-100';
  const dot =
    score >= 85
      ? 'bg-emerald-500'
      : score >= 70
        ? 'bg-sky-500'
        : score >= 50
          ? 'bg-amber-500'
          : 'bg-rose-500';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ring-2 font-semibold text-xs tabular-nums',
        tone,
      )}
      title={`AI match score: ${score}%`}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', dot)} aria-hidden="true" />
      <span>{score}% match</span>
    </span>
  );
}

/**
 * Salary range pill — rendered next to the meta row when the job has any rate
 * data. Hidden completely when both rate fields are null (jobright-style:
 * skip rather than show "undisclosed" noise).
 */
function SalaryPill({ min, max }: { min?: number | null; max?: number | null }) {
  if (min == null && max == null) return null;
  const label =
    min != null && max != null
      ? `$${min}–$${max}/hr`
      : min != null
        ? `$${min}+/hr`
        : `Up to $${max}/hr`;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-500/20 text-[11px] font-medium">
      <span aria-hidden="true">$</span>
      {label}
    </span>
  );
}

/**
 * Surface high-signal recommendation tags (H1B Sponsor / Remote / Hybrid /
 * Clearance / Relocation) as prominent colored chips. Falls back to a neutral
 * slate tone for tags we don't recognize.
 */
function HighlightTagChip({ tag }: { tag: string }) {
  const t = tag.toLowerCase();
  let tone = 'bg-hover text-ink border-border';
  let label = tag;
  if (/(no sponsor|no h1b)/.test(t)) {
    tone =
      'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30';
  } else if (/(sponsor|h1b)/.test(t)) {
    tone =
      'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30';
    label = 'H1B Sponsor';
  } else if (/clearance|secret/.test(t)) {
    tone =
      'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
  } else if (/remote/.test(t)) {
    tone =
      'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30';
    label = 'Remote';
  } else if (/hybrid/.test(t)) {
    tone =
      'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30';
    label = 'Hybrid';
  } else if (/relocat/.test(t)) {
    tone =
      'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
    label = 'Relocation';
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium',
        tone,
      )}
    >
      {label}
    </span>
  );
}

function CircularScore({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color =
    score == null
      ? '#475569'
      : score >= 90
        ? '#10b981'
        : score >= 75
          ? '#22d3ee'
          : score >= 50
            ? '#fbbf24'
            : '#f87171';
  return (
    // Outer wrapper holds the rotated SVG; the number sits on top as a
    // plain absolutely-positioned span so it's always upright + centered.
    <div className="relative w-full h-full">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="6" />
        {score != null && (
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-white font-bold leading-none tabular-nums"
          style={{ fontSize: '15px' }}
        >
          {score == null ? '—' : `${Math.round(score)}%`}
        </span>
      </div>
    </div>
  );
}

export function StatusDropdown({
  current,
  onChange,
}: {
  current: AppStatus | string | undefined;
  onChange: (next: AppStatus) => void;
}) {
  const status = (current ?? 'SUBMITTED') as AppStatus;
  const label = STATUS_LABEL[status] ?? status;
  const tone =
    status === 'OFFER'
      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
      : status === 'INTERVIEW'
        ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30'
        : status === 'REJECTED'
          ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30'
          : status === 'ARCHIVED' || status === 'WITHDRAWN'
            ? 'bg-hover text-muted border-border'
            : 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as AppStatus)}
      className={clsx(
        'text-xs font-semibold border rounded-full px-2.5 py-1 outline-none focus:ring-2 focus:ring-brand-500/40',
        tone,
      )}
      aria-label="Application status"
    >
      <option value="SUBMITTED">Applied</option>
      <option value="SCREENING">Applied · Screening</option>
      <option value="INTERVIEW">Interviewing</option>
      <option value="OFFER">Offer Received</option>
      <option value="REJECTED">Rejected</option>
      <option value="ARCHIVED">Archived</option>
    </select>
  );
  // Note: select default-renders the option text — we render `label` only
  // as a fallback if browsers strip select styling.
  void label;
}

export { JobCard };
