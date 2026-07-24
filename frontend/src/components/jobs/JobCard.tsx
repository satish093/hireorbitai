import clsx from 'clsx';
import { Button } from '../Button';
import { useFeatureFlag } from '../../hooks/useFeatureFlags';
import { MatchRing, matchTone, matchBand } from './MatchRing';
import { CompanyLogo } from './CompanyLogo';
import { jobTags, TAG_TONE } from './jobTags';
import { cleanText } from '../../lib/jobFormat';
import { relative } from './helpers';
import { STATUS_LABEL } from './types';
import type { AppStatus, JobRow } from './types';

function CheckIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
    >
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Compact job card for the master-detail list column. Clicking selects the job
 * (rendered in the detail pane) — it does not navigate. Save + apply live in the
 * footer; the Applied tab swaps the apply action for a status dropdown.
 */
function JobCard({
  job,
  selected,
  onSelect,
  onToggleLike,
  onDismiss,
  onApply,
  onChangeStatus,
}: {
  job: JobRow;
  selected?: boolean;
  onSelect: () => void;
  onToggleLike: () => void;
  /** Optional — "Not interested". Supplied on the Recommended feed only. */
  onDismiss?: () => void;
  onApply: () => void;
  /** Optional — only supplied on the Applied tab when the row has an application_id. */
  onChangeStatus?: (next: AppStatus) => void;
}) {
  const aiMatchEnabled = useFeatureFlag('ai_match');
  const companyName = cleanText(
    job.company_name ?? job.client?.company_name ?? job.vendor?.company_name ?? 'Confidential',
  );
  const matchScore =
    aiMatchEnabled && typeof job.match_score === 'number' ? Math.round(job.match_score) : null;

  const reqs = job.requirements ?? {};
  const reasons =
    (job.match_reasons?.length ? job.match_reasons : null) ??
    (reqs.required_skills?.length ? reqs.required_skills : job.required_skills) ??
    [];
  // Structured matched/missing skills (recommended feed, when a consultant is
  // in context). When present we render green/muted chips instead of the
  // free-text reasons; otherwise fall back to the reasons pills.
  const matchedSkills = job.match_matched_skills ?? [];
  const missingSkills = job.match_missing_skills ?? [];
  const hasSkillSplit = matchedSkills.length > 0 || missingSkills.length > 0;
  const title = cleanText(job.title);
  const location = job.location ? cleanText(job.location) : job.remote ? 'Remote' : 'Location N/A';
  const tags = jobTags(job);

  return (
    // Wrapper establishes an isolated stacking context so the overlay button
    // sits below the action buttons without leaking z-index to the page.
    <div
      className={clsx(
        'relative isolate w-full rounded-xl border p-3.5 transition',
        selected
          ? 'bg-surface border-border-strong shadow-md'
          : 'bg-surface border-border hover:border-border-strong hover:shadow-sm',
      )}
    >
      {/* Full-card selection button — sits at z-0, below the action buttons.
          Fixes nested-interactive: interactive children are siblings, not
          descendants, of an interactive element. */}
      <button
        type="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        aria-label={`${title} at ${companyName}`}
        className="absolute inset-0 z-0 rounded-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />

      {/* Top: logo + title/company + match ring with band label */}
      <div className="flex items-start gap-3">
        <CompanyLogo name={companyName} applyUrl={job.apply_url} size={40} />
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-ink leading-tight truncate">{title}</h3>
          <div className="text-[12px] text-muted truncate mt-0.5">
            <span className="font-medium text-ink-2">{companyName}</span>
            <span> · {location}</span>
          </div>
        </div>
        {matchScore != null && (
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <MatchRing score={matchScore} size={46} label="" />
            <span
              className={clsx(
                'text-[9px] font-semibold uppercase tracking-wide leading-none',
                matchTone(matchScore),
              )}
            >
              {matchBand(matchScore).split(' ')[0]}
            </span>
          </div>
        )}
      </div>

      {/* Tag row — salary, work model, seniority, visa (Jobright-style) */}
      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span
              key={t.label}
              className={clsx(
                'inline-flex max-w-[180px] items-center truncate rounded-full border px-2 py-0.5 text-[11px]',
                TAG_TONE[t.tone],
              )}
            >
              {t.label}
            </span>
          ))}
        </div>
      )}

      {/* "Why you're a great fit" — one-line AI blurb above the skill pills.
          No positioning: stays under the full-card select overlay so a click
          here still opens the job (matches the header + reasons rows). */}
      {aiMatchEnabled && job.match_why && (
        <p className="mt-2 text-[12px] leading-snug text-ink-2 line-clamp-2">
          <span className="font-medium text-accent">✦ Why you fit · </span>
          {job.match_why}
        </p>
      )}

      {/* Skills: matched (green ✓) + missing (muted) chips when we have the
          structured split; otherwise the free-text reasons as check-pills. */}
      {hasSkillSplit ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {matchedSkills.slice(0, 4).map((s) => (
            <span
              key={`m-${s}`}
              className="inline-flex items-center gap-1 rounded-full bg-success-soft border border-success/30 px-1.5 py-0.5 text-[11px] text-success max-w-[140px]"
              title={`You have: ${s}`}
            >
              <span className="shrink-0">
                <CheckIcon />
              </span>
              <span className="truncate">{s}</span>
            </span>
          ))}
          {missingSkills.slice(0, 3).map((s) => (
            <span
              key={`x-${s}`}
              className="inline-flex items-center rounded-full bg-bg-sunken border border-border px-1.5 py-0.5 text-[11px] text-muted max-w-[140px]"
              title={`Not on the profile yet: ${s}`}
            >
              <span className="truncate">{s}</span>
            </span>
          ))}
          {matchedSkills.length + missingSkills.length > 7 && (
            <span className="text-[11px] font-mono text-faint">
              +{matchedSkills.length + missingSkills.length - 7}
            </span>
          )}
        </div>
      ) : reasons.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {reasons.slice(0, 3).map((r) => (
            <span
              key={r}
              className="inline-flex items-center gap-1 rounded-full bg-bg-sunken border border-border px-1.5 py-0.5 text-[11px] text-ink-2 max-w-[140px]"
            >
              <span className="text-success shrink-0">
                <CheckIcon />
              </span>
              <span className="truncate">{r}</span>
            </span>
          ))}
          {reasons.length > 3 && (
            <span className="text-[11px] font-mono text-faint">+{reasons.length - 3}</span>
          )}
        </div>
      ) : null}

      {/* Footer: comp + posted (mono) · save + apply.
          relative z-10 ensures action buttons sit above the overlay button. */}
      <div className="relative z-10 mt-3 flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] text-muted truncate">
          {relative(job.posted_at ?? job.created_at)}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              aria-label="Not interested — hide this job"
              title="Not interested"
              leftIcon={
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={(e) => {
              e.stopPropagation();
              onToggleLike();
            }}
            aria-label={job.liked ? 'Remove from saved' : 'Save job'}
            title={job.liked ? 'Saved — click to remove' : 'Save job'}
            leftIcon={
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill={job.liked ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                className={job.liked ? 'text-accent' : ''}
              >
                <path
                  d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          {onChangeStatus ? (
            <div onClick={(e) => e.stopPropagation()}>
              <StatusDropdown current={job.application_status} onChange={onChangeStatus} />
            </div>
          ) : (
            <Button
              variant="accent"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onApply();
              }}
            >
              Apply
            </Button>
          )}
        </div>
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
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as AppStatus)}
      className="text-[11px] font-semibold border border-border rounded-full px-2 py-1 bg-surface text-ink-2 outline-none focus:ring-2 focus:ring-accent"
      aria-label="Application status"
      title={label}
    >
      <option value="SUBMITTED">Applied</option>
      <option value="SCREENING">Applied · Screening</option>
      <option value="INTERVIEW">Interviewing</option>
      <option value="OFFER">Offer Received</option>
      <option value="REJECTED">Rejected</option>
      <option value="ARCHIVED">Archived</option>
    </select>
  );
}

export { JobCard };
