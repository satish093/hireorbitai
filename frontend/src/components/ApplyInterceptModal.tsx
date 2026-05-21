import { useState } from 'react';
import { Avatar } from './TaskBits';

/**
 * Pre-apply "Customize your resume" intercept — Jobright-style.
 *
 * Triggered when a consultant clicks "Apply on company site". Surfaces the
 * gap between their saved skills and the job's required skills, and offers:
 *   - Fix My Resume Now  → opens the Match Insight modal (per-skill + ATS scoring)
 *   - Apply Without Customizing → opens the company URL in a new tab
 *   - Do not remind me again → persists a flag in localStorage, suppressing
 *     the modal on future Apply clicks (key: tb_apply_no_intercept).
 */

const REMIND_KEY = 'tb_apply_no_intercept';
export function shouldShowApplyIntercept(): boolean {
  try {
    return localStorage.getItem(REMIND_KEY) !== '1';
  } catch {
    return true;
  }
}
export function suppressApplyIntercept() {
  try {
    localStorage.setItem(REMIND_KEY, '1');
  } catch {
    /* ignore */
  }
}

interface JobLite {
  id: string;
  title: string;
  company_name?: string | null;
  required_skills?: string[] | null;
  match_score?: number | null;
  requirements?: { required_skills?: string[] } | null;
}

export function ApplyInterceptModal({
  job,
  mySkills,
  applyUrl,
  onClose,
  onCustomize,
  onApplyAnyway,
}: {
  job: JobLite;
  mySkills: string[];
  applyUrl: string;
  onClose: () => void;
  onCustomize: () => void;
  /** Optional override for the "Apply Without Customizing" link — supplied by
   *  recruiter mode so it can chain into the "Did you apply?" confirmation. */
  onApplyAnyway?: () => void;
}) {
  const [dontRemind, setDontRemind] = useState(false);

  const company = job.company_name ?? 'Confidential';
  const requiredSkills =
    (job.requirements?.required_skills?.length
      ? job.requirements.required_skills
      : job.required_skills) ?? [];
  const mineLower = new Set(mySkills.map((s) => s.toLowerCase()));
  const missing = requiredSkills.filter((s) => !mineLower.has(s.toLowerCase())).slice(0, 16);

  // Score on a 0..10 scale to match Jobright's gauge. Fall back to a derived
  // value when we don't have a precomputed AI match score yet.
  const score10 = scoreOnTen(job, requiredSkills, mineLower);
  const tone = scoreTone(score10);

  function handleApply() {
    if (dontRemind) suppressApplyIntercept();
    if (onApplyAnyway) {
      // Recruiter mode wants to record the application after the user comes
      // back from the company site — let the parent orchestrate the flow.
      onApplyAnyway();
      return;
    }
    window.open(applyUrl, '_blank', 'noopener,noreferrer');
    onClose();
  }
  function handleCustomize() {
    if (dontRemind) suppressApplyIntercept();
    onCustomize();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 flex items-center justify-between border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            Customize Your Resume in 10 seconds
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Status banner */}
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-500/15 border border-amber-100 dark:border-amber-500/20 rounded-xl px-3 py-2.5">
            <span className="text-lg leading-none">
              {score10 >= 7 ? '🙂' : score10 >= 5 ? '😐' : '😕'}
            </span>
            <p className="text-sm font-semibold text-foreground leading-snug">
              {score10 >= 7
                ? 'Your resume is on the right track, but a few keywords are still missing'
                : score10 >= 5
                  ? 'Your resume is on the right track, but essential keywords are missing'
                  : 'Your resume is missing several critical keywords for this role'}
            </p>
          </div>

          {/* Job + score card */}
          <div className="border border-border rounded-xl p-4 flex items-start gap-3">
            <Avatar name={company} size={40} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground truncate">{company}</div>
              <div className="text-sm font-semibold text-foreground leading-snug truncate">
                {job.title}
              </div>
            </div>
            <ScoreGauge value={score10} tone={tone} />
          </div>

          {/* Missing skills */}
          {missing.length > 0 ? (
            <div>
              <p className="text-sm text-foreground mb-2">
                Missing <span className="font-semibold">{missing.length}</span> key skill
                {missing.length === 1 ? '' : 's'}
                {missing.length >= 5 ? ' & bullet point alignment' : ''}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missing.slice(0, 8).map((s) => (
                  <span
                    key={s}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300"
                  >
                    {s}
                  </span>
                ))}
                {missing.length > 8 && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-foreground">
                    +{missing.length - 8}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/20 rounded-lg px-3 py-2">
              ✓ Your skills cover the job's required keywords. You can still review the per-skill
              match.
            </p>
          )}

          {/* CTAs */}
          <button
            onClick={handleCustomize}
            className="w-full bg-emerald-400 hover:bg-emerald-500 text-foreground font-semibold text-sm py-3 rounded-xl transition"
          >
            ✦ Fix My Resume &amp; Apply
          </button>

          <button
            onClick={handleApply}
            className="w-full text-sm text-foreground hover:text-foreground underline underline-offset-2"
          >
            Apply Without Customizing
          </button>

          <label className="flex items-center justify-center gap-2 text-xs text-muted-foreground select-none cursor-pointer">
            <input
              type="checkbox"
              checked={dontRemind}
              onChange={(e) => setDontRemind(e.target.checked)}
              className="rounded border-border"
            />
            Do not remind me again
          </label>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map the AI match_score (0..100) onto Jobright's 0..10 gauge. Falls back to
 *  a coverage ratio when we don't have a precomputed score yet. */
function scoreOnTen(job: JobLite, required: string[], mineLower: Set<string>): number {
  if (typeof job.match_score === 'number') {
    return Math.round((job.match_score / 10) * 10) / 10;
  }
  if (required.length === 0) return 0;
  const matched = required.filter((s) => mineLower.has(s.toLowerCase())).length;
  return Math.round((matched / required.length) * 100) / 10;
}

function scoreTone(s: number): 'good' | 'fair' | 'weak' {
  if (s >= 8) return 'good';
  if (s >= 5) return 'fair';
  return 'weak';
}

function ScoreGauge({ value, tone }: { value: number; tone: 'good' | 'fair' | 'weak' }) {
  const pct = Math.max(0, Math.min(100, value * 10));
  const r = 32;
  const c = Math.PI * r; // semicircle length
  const offset = c - (pct / 100) * c;
  const stroke = tone === 'good' ? 'url(#g-good)' : tone === 'fair' ? 'url(#g-fair)' : '#ef4444';
  const label = tone === 'good' ? 'Strong' : tone === 'fair' ? 'Fair' : 'Weak';
  return (
    <div className="text-center">
      <svg viewBox="0 0 80 50" className="w-20 h-12">
        <defs>
          <linearGradient id="g-good" x1="0" x2="1">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="50%" stopColor="#facc15" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
          <linearGradient id="g-fair" x1="0" x2="1">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="60%" stopColor="#facc15" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        {/* Background arc */}
        <path
          d="M 8 42 A 32 32 0 0 1 72 42"
          stroke="#e2e8f0"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          d="M 8 42 A 32 32 0 0 1 72 42"
          stroke={stroke}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
        <text x="40" y="40" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0f172a">
          {value.toFixed(1)}
        </text>
      </svg>
      <div className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
