import { ReactNode, useEffect, useState } from 'react';
import clsx from 'clsx';
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
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm min-w-0">
      {title && (
        <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-2.5">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function FactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
      <div className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
        {label}
      </div>
      <div className="text-sm font-medium text-slate-800 mt-0.5 break-words" title={value}>
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
        ? 'from-sky-50 to-white border-sky-100'
        : 'from-emerald-50 to-white border-emerald-100';
  return (
    <div className={`min-w-0 rounded-xl border bg-gradient-to-br ${toneClass} p-4`}>
      <div className="text-[10px] font-semibold tracking-widest uppercase mb-1 text-slate-500">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums text-slate-900">
        {value == null ? '—' : `${value}${suffix}`}
      </div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5 break-words">{sub}</div>}
    </div>
  );
}

function TagChip({ tag }: { tag: string }) {
  const t = tag.toLowerCase();
  const tone = /(no sponsor|no h1b)/.test(t)
    ? 'bg-red-50 text-red-700 border-red-100'
    : /(sponsor|h1b)/.test(t)
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : /(clearance|secret)/.test(t)
        ? 'bg-amber-50 text-amber-800 border-amber-100'
        : /(remote)/.test(t)
          ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
          : 'bg-slate-50 text-slate-700 border-slate-200';
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
  tone = 'text-slate-400',
}: {
  items: string[];
  marker?: string;
  tone?: string;
}) {
  return (
    <ul className="space-y-1 text-sm text-slate-700">
      {items.map((b, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className={tone}>{marker}</span>
          <span className="min-w-0 break-words">{b}</span>
        </li>
      ))}
    </ul>
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

  const applyBtn = (extra?: string) => (
    <a
      href={resolveApplyUrl(job)}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-800 press',
        extra,
      )}
    >
      Apply on company site <span>↗</span>
    </a>
  );

  return (
    <div className="max-w-5xl mx-auto w-full min-w-0">
      {/* Company-first header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm min-w-0">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar name={company} size={56} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <span className="text-xs text-slate-500">
                {relative(job.posted_at ?? job.created_at)}
              </span>
              {job.source && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                  {job.publisher ?? job.source}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold text-slate-900 leading-tight break-words">
              {company}
            </h1>
            <div className="text-base text-slate-700 mt-0.5 break-words">{job.title}</div>
            <div className="text-sm text-slate-500 mt-1 break-words">
              {job.location ?? 'Location N/A'} · {workModel}
            </div>
            <div className="mt-3 hidden sm:block">{applyBtn()}</div>
          </div>
        </div>
        {/* Apply is full-width under the header on mobile. */}
        <div className="mt-3 sm:hidden">{applyBtn('w-full')}</div>
      </div>

      {enriching && (
        <div className="mt-4 text-xs text-slate-500 flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
          Analyzing job…
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-4 min-w-0">
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
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
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
                      className="jd-prose text-sm text-slate-700"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ) : (
                    <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed break-words">
                      {jdToText(job.description!)}
                    </div>
                  )}
                </Section>
              );
            })()}

          {/* Consultant resume scoring */}
          {loading && <div className="text-sm text-slate-500">Scoring against your resume…</div>}
          {error && !loading && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </div>
          )}
          {needsResume && !loading && (
            <Section title="No resume on file yet">
              <p className="text-xs text-slate-600 mb-2">
                Upload a resume on the Resumes page, or paste the text below to score this job now.
              </p>
              <textarea
                rows={6}
                value={resumePaste}
                onChange={(e) => setResumePaste(e.target.value)}
                placeholder="Paste your resume here…"
                className="w-full text-xs border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
              <button
                onClick={() => run(resumePaste)}
                disabled={!resumePaste.trim()}
                className="mt-2 bg-slate-900 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-50"
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
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {atsScore}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded overflow-hidden mb-2">
                    <div className="h-full bg-emerald-500" style={{ width: `${atsScore}%` }} />
                  </div>
                  {ats && <p className="text-xs text-slate-700 break-words">{ats.summary}</p>}
                  {ats?.missing_keywords && ats.missing_keywords.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-1">
                        Missing keywords
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {ats.missing_keywords.slice(0, 16).map((k) => (
                          <span
                            key={k}
                            className="text-[11px] bg-red-50 text-red-700 border border-red-100 px-2 py-0.5 rounded-full"
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
                  <div className="divide-y divide-slate-100">
                    {(skillMatch.per_skill ?? []).map((s) => {
                      const pct = Math.round((s.score ?? 0) * 100);
                      const tone =
                        pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div key={s.skill} className="py-2.5 min-w-0">
                          <div className="flex items-center justify-between gap-3 min-w-0">
                            <span className="text-sm font-medium text-slate-900 truncate min-w-0">
                              {s.skill}
                            </span>
                            <span className="text-xs tabular-nums font-semibold text-slate-700 shrink-0">
                              {pct}%
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 bg-slate-100 rounded overflow-hidden">
                            <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                          </div>
                          {s.evidence && (
                            <div className="mt-1 text-[11px] text-slate-500 italic break-words">
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
                <p className="text-sm text-slate-500 text-center">
                  This listing hasn't been enriched yet — only the basic facts are available. Open
                  the original posting for the full description.
                </p>
              </Section>
            )}
        </div>

        {/* Right rail */}
        <div className="space-y-4 min-w-0 lg:sticky lg:top-4">
          <Section title="Key facts">
            <div className="grid grid-cols-2 gap-2.5">
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
