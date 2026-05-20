import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api } from '../services/api';

/**
 * Jobright's "Fix My Resume" wizard.
 *
 * Steps:
 *   1) Pick sections to rewrite + missing keywords to inject.
 *   2) AI generates a tailored resume version.
 *   3) Show before/after scores + change summary; allow download + proceed to apply.
 */
interface JobLite {
  id: string;
  title: string;
  company_name?: string | null;
  required_skills?: string[] | null;
  apply_url?: string | null;
  requirements?: {
    required_skills?: string[];
    must_haves?: string[];
  } | null;
}

interface TailorResponse {
  resume: { id: string; file_name: string; version: number };
  tailored_markdown: string;
  before_score: number;
  after_score: number;
  rank_before: string;
  rank_after: string;
  changes_summary: string[];
  keywords_added: string[];
  sections_modified: string[];
}

const ALL_SECTIONS = [
  'Summary',
  'Skills',
  'Work Experience',
  'Projects',
  'Certifications',
] as const;

export function CustomizeResumeWizard({
  job,
  consultantId,
  sourceResumeId,
  mySkills,
  onClose,
  onApplied,
}: {
  job: JobLite;
  consultantId: string;
  sourceResumeId: string;
  mySkills: string[];
  onClose: () => void;
  /** Fired after the user clicks "Open apply page" and confirms Yes. */
  onApplied: (result: {
    tailoredResumeId: string;
    matchScore: number;
    atsScore: number | null;
  }) => void;
}) {
  const required =
    (job.requirements?.required_skills?.length
      ? job.requirements.required_skills
      : job.required_skills) ?? [];
  const mineLower = new Set(mySkills.map((s) => s.toLowerCase()));
  const missingFromJob = required.filter((s) => !mineLower.has(s.toLowerCase()));

  // Default to ALL sections selected — gives the AI the most surface area to
  // hit the 85% ATS target. Recruiter can deselect any they want preserved.
  const [sections, setSections] = useState<string[]>([...ALL_SECTIONS]);
  const [keywords, setKeywords] = useState<string[]>(missingFromJob);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TailorResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** Set to true when the backend reports the source resume has no body
   *  text and we need the user to paste it inline. */
  const [needsResumeText, setNeedsResumeText] = useState(false);
  const [pastedResume, setPastedResume] = useState('');

  function toggleSection(s: string) {
    setSections((curr) => (curr.includes(s) ? curr.filter((x) => x !== s) : [...curr, s]));
  }
  function toggleKeyword(k: string) {
    setKeywords((curr) => (curr.includes(k) ? curr.filter((x) => x !== k) : [...curr, k]));
  }

  async function generate() {
    if (sections.length === 0 && keywords.length === 0) {
      toast.error('Pick at least one section or one keyword');
      return;
    }
    setBusy(true);
    try {
      const body: any = {
        source_resume_id: sourceResumeId,
        job_id: job.id,
        sections,
        keywords,
      };
      if (pastedResume.trim()) body.resume_text = pastedResume.trim();
      const r = await api.post('/resumes/tailor', body);
      setResult(r.data);
      setNeedsResumeText(false);
    } catch (e: any) {
      const msg: string = e?.response?.data?.error ?? 'AI tailoring failed';
      // Backend signals the no-body-text case with the NO_RESUME_TEXT prefix
      // so we can prompt for paste-inline instead of erroring out.
      if (msg.startsWith('NO_RESUME_TEXT')) {
        setNeedsResumeText(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([result.tailored_markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.resume.file_name || 'tailored-resume.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  function openApplyPage() {
    if (!result) return;
    if (job.apply_url) {
      window.open(job.apply_url, '_blank', 'noopener,noreferrer');
    }
    setConfirming(true);
  }

  async function confirmApplied(yes: boolean) {
    if (!result) {
      onClose();
      return;
    }
    if (!yes) {
      // Log the funnel-exit so reports can show "customized but never applied".
      try {
        await api.post('/applications/none/events', {
          kind: 'apply_declined',
          job_id: job.id,
          consultant_id: consultantId,
          payload: { stage: 'after_customize', tailored_resume_id: result.resume.id },
        });
      } catch {
        /* non-fatal */
      }
      onClose();
      return;
    }
    onApplied({
      tailoredResumeId: result.resume.id,
      matchScore: result.after_score,
      atsScore: null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-5 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase mb-1.5 text-brand-700 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded-full">
                <span>✦</span> Fix My Resume · Targeting 85%+ ATS
              </div>
              <h2 className="text-xl font-semibold text-slate-900 leading-tight truncate">
                {job.title}
              </h2>
              <div className="text-sm text-slate-600">{job.company_name ?? 'Unknown company'}</div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-md w-8 h-8 flex items-center justify-center text-xl leading-none shrink-0"
            >
              ×
            </button>
          </div>
          {/* Step indicator */}
          <ol className="flex items-center gap-2 mt-4 text-[11px] font-medium">
            <Step
              n={1}
              label="Configure"
              active={!result && !confirming}
              done={!!result || confirming}
            />
            <Sep />
            <Step n={2} label="Review" active={!!result && !confirming} done={confirming} />
            <Sep />
            <Step n={3} label="Confirm" active={confirming} done={false} />
          </ol>
        </header>

        {/* Step 1 — pick sections + keywords */}
        {!result && !confirming && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {needsResumeText && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="text-sm font-semibold text-amber-900 mb-1">Resume text missing</div>
                <p className="text-xs text-amber-800 mb-2">
                  We couldn't read the body of this resume (it was uploaded without an extractable
                  text layer). Paste the resume text below — we'll save it to the resume so this
                  step is automatic next time.
                </p>
                <textarea
                  rows={10}
                  value={pastedResume}
                  onChange={(e) => setPastedResume(e.target.value)}
                  placeholder="Paste your resume text here…"
                  className="w-full text-xs border border-amber-200 rounded p-2 focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono"
                />
                <p className="text-[10px] text-amber-700 mt-1 italic">
                  Tip: copy from your PDF/DOCX viewer (Ctrl+A → Ctrl+C). At least 50 characters
                  needed.
                </p>
              </div>
            )}

            <Section title="Sections to rewrite">
              <div className="flex flex-wrap gap-2">
                {ALL_SECTIONS.map((s) => (
                  <Chip key={s} on={sections.includes(s)} onClick={() => toggleSection(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Section>

            <Section
              title="Missing keywords to weave in"
              sub={
                missingFromJob.length === 0
                  ? 'Your skill list already covers the JD — you can still generate a polish pass.'
                  : undefined
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {missingFromJob.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">
                    No missing keywords detected.
                  </span>
                ) : (
                  missingFromJob.map((k) => (
                    <Chip
                      key={k}
                      on={keywords.includes(k)}
                      onClick={() => toggleKeyword(k)}
                      tone="rose"
                    >
                      {k}
                    </Chip>
                  ))
                )}
              </div>
            </Section>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
              The AI rewrites only the sections you select and only weaves in keywords you've
              checked. It never invents credentials or jobs that aren't already on your resume.
            </div>
          </div>
        )}

        {/* Step 2 — show before/after */}
        {result && !confirming && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <ScoreCard
                label="Before"
                value={Math.round(result.before_score)}
                sub={result.rank_before}
                tone="slate"
              />
              <ScoreCard
                label="After"
                value={Math.round(result.after_score)}
                sub={result.rank_after}
                tone="emerald"
              />
            </div>

            {result.changes_summary?.length > 0 && (
              <Section title="What changed">
                <ul className="space-y-1 text-sm text-slate-700">
                  {result.changes_summary.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-emerald-500">+</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {result.keywords_added?.length > 0 && (
              <Section title="Keywords added">
                <div className="flex flex-wrap gap-1.5">
                  {result.keywords_added.map((k) => (
                    <span
                      key={k}
                      className="text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-100 px-2 py-0.5 rounded-full"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Tailored resume (markdown preview)">
              <pre className="max-h-72 overflow-y-auto text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap text-slate-700">
                {result.tailored_markdown}
              </pre>
            </Section>
          </div>
        )}

        {/* Step 3 — "Did you apply?" confirmation */}
        {result && confirming && (
          <div className="flex-1 overflow-y-auto px-6 py-8">
            <div className="text-center">
              <div className="text-base font-semibold text-slate-900 mb-2">
                Did you submit the application?
              </div>
              <p className="text-sm text-slate-600 max-w-md mx-auto mb-5">
                We just opened the company's apply page in a new tab. Confirm "Yes" to record this
                submission against the consultant. We'll attach the tailored resume.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => confirmApplied(false)}
                  className="border border-slate-200 text-slate-700 text-sm px-5 py-2 rounded-lg hover:bg-slate-50"
                >
                  No, not yet
                </button>
                <button
                  onClick={() => confirmApplied(true)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-5 py-2 rounded-lg"
                >
                  Yes, applied
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <footer className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          {!result && !confirming && (
            <button
              onClick={generate}
              disabled={busy}
              className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-5 py-2 rounded-lg disabled:opacity-50"
            >
              {busy ? 'Tailoring…' : '✦ Generate tailored resume'}
            </button>
          )}
          {result && !confirming && (
            <>
              <button
                onClick={download}
                className="text-sm text-slate-600 hover:text-slate-900 px-3 py-2 underline underline-offset-2"
              >
                ⬇ Download .md
              </button>
              <button
                onClick={openApplyPage}
                className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-5 py-2 rounded-lg"
              >
                Open apply page ↗
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: any }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1.5">
        {title}
      </div>
      {sub && <p className="text-xs text-slate-500 mb-2">{sub}</p>}
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
  tone = 'slate',
}: {
  on: boolean;
  onClick: () => void;
  children: any;
  tone?: 'slate' | 'rose';
}) {
  const onStyles =
    tone === 'rose'
      ? 'bg-rose-500 text-white border-rose-500'
      : 'bg-slate-900 text-white border-slate-900';
  const offStyles =
    tone === 'rose'
      ? 'bg-rose-50 text-rose-800 border-rose-100 hover:bg-rose-100'
      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50';
  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-xs font-medium border rounded-full px-3 py-1 transition',
        on ? onStyles : offStyles,
      )}
    >
      {on ? '✓ ' : ''}
      {children}
    </button>
  );
}

function ScoreCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone: 'slate' | 'emerald';
}) {
  const cls =
    tone === 'emerald'
      ? 'from-emerald-50 to-white border-emerald-100'
      : 'from-slate-50 to-white border-slate-200';
  return (
    <div className={`rounded-xl border bg-gradient-to-br p-4 ${cls}`}>
      <div className="text-[10px] font-semibold tracking-widest uppercase text-slate-500">
        {label}
      </div>
      <div className="text-3xl font-semibold tabular-nums text-slate-900">{value}%</div>
      {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function Step({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <li
      className={clsx(
        'flex items-center gap-1.5',
        active && 'text-brand-700',
        done && 'text-emerald-700',
        !active && !done && 'text-slate-400',
      )}
    >
      <span
        className={clsx(
          'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold',
          active
            ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-300'
            : done
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-100 text-slate-500',
        )}
      >
        {done ? '✓' : n}
      </span>
      <span>{label}</span>
    </li>
  );
}
function Sep() {
  return <span className="text-slate-300">—</span>;
}

// Mark the second use of useEffect for future expansion (keeps the
// component idiomatic if we later add async source-resume loading).
void useEffect;
