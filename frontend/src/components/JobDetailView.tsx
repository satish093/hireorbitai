import { ReactNode, useEffect, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { Avatar } from './TaskBits';
import {
  Job,
  JobRequirements,
  jdToSafeHtml,
  jdToText,
  looksLikeHtml,
  prettyRate,
  prettyType,
  relative,
  resolveApplyUrl,
} from '../lib/jobFormat';

// ---------------------------------------------------------------------------
// Full-page job detail. Renders in normal document flow inside a centred
// max-width container — no overlay — so content can never reach the screen
// edge (the old slide-in panel's overflow problem). Company-first header,
// two-column on lg, single column on mobile. Auto-enriches on open for every
// role (free local parser) and, for consultants, scores their resume.
// ---------------------------------------------------------------------------

interface SkillMatchResp {
  per_skill: { skill: string; score: number; evidence: string | null }[];
  overall_score: number;
  rank_desc: string;
  feature_scores: { seniority_match: number; skill_match: number; industry_match: number };
  rationale: string[];
}
interface AtsResp {
  score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  summary: string;
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm min-w-0">
      {title && (
        <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-2.5">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function FactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-hover border border-border rounded-xl px-3 py-2.5">
      <div className="text-[10px] font-semibold tracking-widest text-muted uppercase">{label}</div>
      <div className="text-sm font-medium text-ink mt-0.5 break-words" title={value}>
        {value}
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  suffix = '',
  tone,
  sub,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  tone: 'primary' | 'info' | 'ok';
  sub?: string;
}) {
  const toneClass =
    tone === 'primary'
      ? 'from-brand-50 to-white border-brand-100'
      : tone === 'info'
        ? 'from-sky-50 to-white border-sky-100 dark:border-sky-500/20'
        : 'from-emerald-50 to-white border-emerald-100 dark:border-emerald-500/20';
  return (
    <div className={`min-w-0 rounded-xl border bg-gradient-to-br ${toneClass} p-4`}>
      <div className="text-[10px] font-semibold tracking-widest uppercase mb-1 text-muted">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums text-ink">
        {value == null ? '—' : `${value}${suffix}`}
      </div>
      {sub && <div className="text-[11px] text-muted mt-0.5 break-words">{sub}</div>}
    </div>
  );
}

function TagChip({ tag }: { tag: string }) {
  const t = tag.toLowerCase();
  const tone = /(no sponsor|no h1b)/.test(t)
    ? 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-100 dark:border-red-500/20'
    : /(sponsor|h1b)/.test(t)
      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20'
      : /(clearance|secret)/.test(t)
        ? 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-100 dark:border-amber-500/20'
        : /(remote)/.test(t)
          ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-500/20'
          : 'bg-hover text-ink border-border';
  return (
    <span
      className={clsx(
        'text-[11px] font-medium px-2 py-0.5 rounded-full border inline-flex items-center gap-1',
        tone,
      )}
    >
      ✦ {tag}
    </span>
  );
}

function Bullets({
  items,
  marker = '•',
  tone = 'text-muted',
}: {
  items: string[];
  marker?: string;
  tone?: string;
}) {
  return (
    <ul className="space-y-1 text-sm text-ink">
      {items.map((b, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className={tone}>{marker}</span>
          <span className="min-w-0 break-words">{b}</span>
        </li>
      ))}
    </ul>
  );
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

// AI job copilot — Jobright "Orion"-style chat about this specific job.
function JobCopilot({ jobId, isConsultant }: { jobId: string; isConsultant: boolean }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const suggestions = isConsultant
    ? [
        'Am I a good fit for this role?',
        "What's missing on my resume for this job?",
        'Draft a short intro message to the recruiter.',
      ]
    : [
        'Summarize this role in 3 bullets.',
        'What skills matter most here?',
        'What questions should a candidate ask?',
      ];

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const { data } = await api.post(`/jobs/${jobId}/copilot`, { question: q });
      setMessages((m) => [...m, { role: 'assistant', text: data?.answer ?? 'No answer.' }]);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Copilot is unavailable right now.';
      setMessages((m) => [...m, { role: 'assistant', text: `⚠ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="AI Copilot">
      {messages.length === 0 ? (
        <p className="text-sm text-muted mb-3">
          Ask anything about this job — fit, requirements, or outreach.
        </p>
      ) : (
        <div className="space-y-2.5 mb-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={clsx(
                'text-sm rounded-xl px-3 py-2 max-w-[90%] whitespace-pre-wrap break-words',
                m.role === 'user'
                  ? 'ml-auto bg-ink text-bg'
                  : 'mr-auto bg-hover border border-border text-ink',
              )}
            >
              {m.text}
            </div>
          ))}
          {busy && <div className="text-xs text-muted">Thinking…</div>}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              disabled={busy}
              className="text-[11px] px-2 py-1 rounded-full border border-border text-muted hover:bg-hover disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask(input);
          }}
          placeholder="Ask the copilot…"
          className="flex-1 min-w-0 text-sm h-9 rounded-lg border border-border px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <button
          onClick={() => ask(input)}
          disabled={busy || !input.trim()}
          className="h-9 px-4 rounded-lg bg-ink text-bg text-sm font-medium hover:opacity-90 disabled:opacity-50 press"
        >
          Ask
        </button>
      </div>
    </Section>
  );
}

type CoverTone = 'professional' | 'enthusiastic' | 'concise';
const COVER_TONES: { key: CoverTone; label: string }[] = [
  { key: 'professional', label: 'Professional' },
  { key: 'enthusiastic', label: 'Enthusiastic' },
  { key: 'concise', label: 'Concise' },
];

/**
 * AI cover-letter writer — first-person letter tailored to this job + the
 * caller's current resume. Inline (no overlay), mirroring the JobCopilot
 * Section. The result is editable so the consultant can tweak before sending.
 */
function CoverLetterPanel({ jobId }: { jobId: string }) {
  const [tone, setTone] = useState<CoverTone>('professional');
  const [letter, setLetter] = useState('');
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/jobs/${jobId}/cover-letter`, { tone });
      setLetter(data?.cover_letter ?? '');
      setGenerated(true);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Cover-letter generation is unavailable right now.';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(letter);
      toast.success('Cover letter copied');
    } catch {
      toast.error('Copy failed — select the text manually.');
    }
  }

  return (
    <Section title="AI Cover Letter">
      <p className="text-sm text-muted mb-3">
        Generate a first-person cover letter tailored to this role and your current resume.
      </p>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {COVER_TONES.map((t) => (
          <button
            key={t.key}
            onClick={() => setTone(t.key)}
            disabled={busy}
            className={clsx(
              'text-[11px] px-2.5 py-1 rounded-full border transition disabled:opacity-50',
              tone === t.key
                ? 'bg-ink text-bg border-ink'
                : 'border-border text-muted hover:bg-hover',
            )}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={generate}
          disabled={busy}
          className="h-8 px-3 ml-auto rounded-lg bg-ink text-bg text-sm font-medium hover:opacity-90 disabled:opacity-50 press"
        >
          {busy ? 'Writing…' : generated ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      {generated && (
        <>
          <textarea
            value={letter}
            onChange={(e) => setLetter(e.target.value)}
            rows={14}
            aria-label="Generated cover letter"
            className="w-full text-sm rounded-lg border border-border p-3 leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={copy}
              className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-hover press"
            >
              Copy
            </button>
            <span className="text-[11px] text-muted">Editable — tweak before you send.</span>
          </div>
        </>
      )}
    </Section>
  );
}

export function JobDetailView({ job, isConsultant }: { job: Job; isConsultant: boolean }) {
  const [reqs, setReqs] = useState<JobRequirements | null | undefined>(job.requirements);
  const [enriching, setEnriching] = useState(false);

  const [loading, setLoading] = useState(isConsultant);
  const [error, setError] = useState<string | null>(null);
  const [skillMatch, setSkillMatch] = useState<SkillMatchResp | null>(null);
  const [ats, setAts] = useState<AtsResp | null>(null);
  const [resumePaste, setResumePaste] = useState('');
  const [needsResume, setNeedsResume] = useState(false);

  // Enrich on open for ALL roles (free local parser). Best-effort.
  useEffect(() => {
    if (job.requirements) {
      setReqs(job.requirements);
      return;
    }
    let cancelled = false;
    setEnriching(true);
    api
      .post(`/jobs/${job.id}/enrich`)
      .then((r) => {
        if (!cancelled) setReqs(r.data?.requirements ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEnriching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, job.requirements]);

  async function run(extraResumeText?: string) {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (extraResumeText) body.resume_text = extraResumeText;
      const r = await api.post(`/jobs/${job.id}/skill-match-for-me`, body);
      setSkillMatch(r.data);
      setNeedsResume(false);
      if (extraResumeText) {
        try {
          const a = await api.post(`/jobs/${job.id}/ats-match`, { resume_text: extraResumeText });
          setAts(a.data);
        } catch {
          /* ATS best-effort */
        }
      }
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to score match';
      if (/no resume text/i.test(msg)) setNeedsResume(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isConsultant) void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [job.id, isConsultant]);

  const company = job.company_name ?? job.client?.company_name ?? 'Unknown company';
  const overall = skillMatch?.overall_score != null ? Math.round(skillMatch.overall_score) : null;
  const atsScore = ats?.score != null ? Math.round(ats.score) : null;
  const seniority = reqs?.job_seniority ?? job.level ?? null;
  const minYears = reqs?.min_years_of_experience ?? null;
  const hasRate = job.rate_min != null || job.rate_max != null;
  const workModel = reqs?.work_model ?? (job.remote ? 'Remote' : 'Onsite');
  const skills = (reqs?.required_skills?.length ? reqs.required_skills : job.required_skills) ?? [];

  // Many aggregated listings expire — the stored apply link can 404. Offer a
  // Google-for-jobs search as a always-valid fallback under the Apply button.
  const googleUrl =
    'https://www.google.com/search?ibp=htl;jobs&q=' + encodeURIComponent(`${job.title} ${company}`);
  const applyBtn = (extra?: string) => (
    <a
      href={resolveApplyUrl(job)}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 bg-ink text-bg text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 press',
        extra,
      )}
    >
      Apply on company site <span>↗</span>
    </a>
  );
  const googleFallback = (
    <a
      href={googleUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block text-xs text-muted hover:text-ink mt-1.5"
    >
      Link not working? Search on Google ↗
    </a>
  );

  return (
    <div className="max-w-5xl mx-auto w-full min-w-0">
      {/* Company-first header */}
      <div className="bg-surface border border-border rounded-2xl p-5 sm:p-6 shadow-sm min-w-0">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar name={company} size={56} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <span className="text-xs text-muted">
                {relative(job.posted_at ?? job.created_at)}
              </span>
              {job.source && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-hover text-muted px-1.5 py-0.5 rounded">
                  {job.publisher ?? job.source}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold text-ink leading-tight break-words">{company}</h1>
            <div className="text-base text-ink mt-0.5 break-words">{job.title}</div>
            <div className="text-sm text-muted mt-1 break-words">
              {job.location ?? 'Location N/A'} · {workModel}
            </div>
            <div className="mt-3 hidden sm:block">
              {applyBtn()}
              {googleFallback}
            </div>
          </div>
        </div>
        {/* Apply is full-width under the header on mobile. */}
        <div className="mt-3 sm:hidden">
          {applyBtn('w-full')}
          {googleFallback}
        </div>
      </div>

      {enriching && (
        <div className="mt-4 text-xs text-muted flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-border border-t-border rounded-full animate-spin" />
          Analyzing job…
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <JobCopilot jobId={job.id} isConsultant={isConsultant} />

          {isConsultant && <CoverLetterPanel jobId={job.id} />}

          {(reqs?.highlights ?? []).length > 0 && (
            <Section title="Highlights">
              <Bullets
                items={(reqs?.highlights ?? []).slice(0, 5)}
                marker="★"
                tone="text-sky-500"
              />
            </Section>
          )}

          {(reqs?.core_responsibilities ?? []).length > 0 && (
            <Section title="Core responsibilities">
              <Bullets items={(reqs?.core_responsibilities ?? []).slice(0, 8)} />
            </Section>
          )}

          {(reqs?.skill_summaries ?? []).length > 0 && (
            <Section title="Skill requirements">
              <Bullets items={(reqs?.skill_summaries ?? []).slice(0, 8)} />
            </Section>
          )}

          {skills.length > 0 && (
            <Section title="Required skills">
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-hover text-ink"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {(reqs?.benefits_summaries ?? []).length > 0 && (
            <Section title="Benefits">
              <Bullets
                items={(reqs?.benefits_summaries ?? []).slice(0, 6)}
                marker="+"
                tone="text-emerald-500"
              />
            </Section>
          )}

          {job.description &&
            jdToText(job.description).length > 0 &&
            (() => {
              const useHtml = looksLikeHtml(job.description!);
              const html = useHtml ? jdToSafeHtml(job.description!) : '';
              return (
                <Section title="Job description">
                  {useHtml && html ? (
                    <div
                      className="jd-prose text-sm text-ink"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ) : (
                    <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed break-words">
                      {jdToText(job.description!)}
                    </div>
                  )}
                </Section>
              );
            })()}

          {/* Consultant resume scoring */}
          {loading && <div className="text-sm text-muted">Scoring against your resume…</div>}
          {error && !loading && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-3">
              {error}
            </div>
          )}
          {needsResume && !loading && (
            <Section title="No resume on file yet">
              <p className="text-xs text-muted mb-2">
                Upload a resume on the Resumes page, or paste the text below to score this job now.
              </p>
              <textarea
                rows={6}
                value={resumePaste}
                onChange={(e) => setResumePaste(e.target.value)}
                placeholder="Paste your resume here…"
                className="w-full text-xs border border-border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
              <button
                onClick={() => run(resumePaste)}
                disabled={!resumePaste.trim()}
                className="mt-2 bg-ink text-bg text-sm px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                Score this resume
              </button>
            </Section>
          )}

          {skillMatch && !loading && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ScoreCard
                  label="Overall match"
                  value={overall}
                  suffix="%"
                  tone="primary"
                  sub={skillMatch.rank_desc}
                />
                <ScoreCard
                  label="Skill match"
                  value={Math.round((skillMatch.feature_scores?.skill_match ?? 0) * 100)}
                  suffix="%"
                  tone="info"
                  sub={`${skillMatch.per_skill?.length ?? 0} skills evaluated`}
                />
                <ScoreCard
                  label="Seniority fit"
                  value={Math.round((skillMatch.feature_scores?.seniority_match ?? 0) * 100)}
                  suffix="%"
                  tone="ok"
                  sub="years vs requirement"
                />
              </div>

              {atsScore != null && (
                <Section title="ATS score">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-ink tabular-nums">{atsScore}%</span>
                  </div>
                  <div className="h-1.5 bg-hover rounded overflow-hidden mb-2">
                    <div className="h-full bg-emerald-500" style={{ width: `${atsScore}%` }} />
                  </div>
                  {ats && <p className="text-xs text-ink break-words">{ats.summary}</p>}
                  {ats?.missing_keywords && ats.missing_keywords.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-1">
                        Missing keywords
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {ats.missing_keywords.slice(0, 16).map((k) => (
                          <span
                            key={k}
                            className="text-[11px] bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-500/20 px-2 py-0.5 rounded-full"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>
              )}

              {skillMatch.rationale?.length > 0 && (
                <Section title="Why this score">
                  <Bullets items={skillMatch.rationale} />
                </Section>
              )}

              {(skillMatch.per_skill?.length ?? 0) > 0 && (
                <Section title="Skill-by-skill">
                  <div className="divide-y divide-border">
                    {(skillMatch.per_skill ?? []).map((s) => {
                      const pct = Math.round((s.score ?? 0) * 100);
                      const tone =
                        pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div key={s.skill} className="py-2.5 min-w-0">
                          <div className="flex items-center justify-between gap-3 min-w-0">
                            <span className="text-sm font-medium text-ink truncate min-w-0">
                              {s.skill}
                            </span>
                            <span className="text-xs tabular-nums font-semibold text-ink shrink-0">
                              {pct}%
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 bg-hover rounded overflow-hidden">
                            <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                          </div>
                          {s.evidence && (
                            <div className="mt-1 text-[11px] text-muted italic break-words">
                              “{s.evidence}”
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
            </>
          )}

          {/* Empty-state when there's genuinely nothing to show. */}
          {!enriching &&
            !(job.description && jdToText(job.description).length > 0) &&
            skills.length === 0 &&
            (reqs?.recommendation_tags ?? []).length === 0 &&
            (reqs?.core_responsibilities ?? []).length === 0 &&
            (reqs?.skill_summaries ?? []).length === 0 && (
              <Section>
                <p className="text-sm text-muted text-center">
                  This listing hasn't been enriched yet — only the basic facts are available. Open
                  the original posting for the full description.
                </p>
              </Section>
            )}
        </div>

        {/* Right rail */}
        <div className="space-y-4 min-w-0 lg:sticky lg:top-4">
          <Section title="Key facts">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <FactTile label="Location" value={job.location ?? '—'} />
              <FactTile label="Work model" value={workModel} />
              <FactTile label="Type" value={prettyType(job.job_type)} />
              {hasRate && (
                <FactTile label="Salary" value={prettyRate(job.rate_min, job.rate_max)} />
              )}
              {seniority && <FactTile label="Level" value={seniority} />}
              {minYears != null && <FactTile label="Experience" value={`${minYears}+ years`} />}
            </div>
          </Section>

          {(reqs?.recommendation_tags ?? []).length > 0 && (
            <Section title="Flags">
              <div className="flex flex-wrap gap-1.5">
                {(reqs?.recommendation_tags ?? []).slice(0, 8).map((t) => (
                  <TagChip key={t} tag={t} />
                ))}
              </div>
            </Section>
          )}

          {(reqs?.work_authorization ?? []).length > 0 && (
            <Section title="Work authorization">
              <Bullets items={reqs?.work_authorization ?? []} tone="text-amber-500" />
            </Section>
          )}

          {applyBtn('w-full')}
        </div>
      </div>
    </div>
  );
}
