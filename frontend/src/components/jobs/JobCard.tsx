import clsx from 'clsx';
import { Button } from '../Button';
import { useFeatureFlag } from '../../hooks/useFeatureFlags';
import { relative, prettyRate } from './helpers';
import { STATUS_LABEL } from './types';
import type { AppStatus, JobRow } from './types';

/** Company initials for the avatar block (max 2 chars). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

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

/** Compact match-score pill for the list card. Tone by band. */
function MatchPill({ score }: { score: number }) {
  const tone =
    score >= 85
      ? 'text-success border-success/40 bg-success-soft'
      : score >= 75
        ? 'text-accent border-accent/40 bg-accent-soft'
        : 'text-muted border-border bg-bg-sunken';
  return (
    <span
      className={clsx(
        'shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-mono font-semibold tabular-nums',
        tone,
      )}
      title={`AI match score: ${score}%`}
    >
      {score}%
    </span>
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
  const companyName =
    job.company_name ?? job.client?.company_name ?? job.vendor?.company_name ?? 'Confidential';
  const matchScore =
    aiMatchEnabled && typeof job.match_score === 'number' ? Math.round(job.match_score) : null;

  const reqs = job.requirements ?? {};
  const reasons =
    (job.match_reasons?.length ? job.match_reasons : null) ??
    (reqs.required_skills?.length ? reqs.required_skills : job.required_skills) ??
    [];
  const location = job.location ?? (job.remote ? 'Remote' : 'Location N/A');

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
        aria-label={`${job.title} at ${companyName}`}
        className="absolute inset-0 z-0 rounded-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />

      {/* Top: initials + title/company + match pill */}
      <div className="flex items-start gap-3">
        <span
          className="shrink-0 grid place-items-center rounded-[7px] bg-accent-soft text-accent text-[12px] font-semibold"
          style={{ width: 34, height: 34 }}
          aria-hidden="true"
        >
          {initials(companyName)}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-ink leading-tight truncate">{job.title}</h3>
          <div className="text-[12px] text-muted truncate mt-0.5">
            <span className="font-medium text-ink-2">{companyName}</span>
            <span> · {location}</span>
          </div>
        </div>
        {matchScore != null && <MatchPill score={matchScore} />}
      </div>

      {/* Match reasons — top 3 as check-pills with +N overflow */}
      {reasons.length > 0 && (
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
      )}

      {/* Footer: comp + posted (mono) · save + apply.
          relative z-10 ensures action buttons sit above the overlay button. */}
      <div className="relative z-10 mt-3 flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] text-muted truncate">
          {job.rate_min != null || job.rate_max != null
            ? prettyRate(job.rate_min, job.rate_max)
            : '—'}
          <span className="text-faint"> · {relative(job.posted_at ?? job.created_at)}</span>
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
