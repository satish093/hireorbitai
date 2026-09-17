import { Pill, type PillTone } from '../Pill';
import { Section, FactRow, Bullets } from './JobDetailPrimitives';
import {
  Job,
  JobRequirements,
  formatCompensation,
  prettyType,
  relative,
} from '../../lib/jobFormat';

// ---------------------------------------------------------------------------
// Recruiter-grade, candidate-friendly reformatting of a job's AI-extracted
// `requirements` (see ai.service.ts's JobRequirementsSchema) into a fixed
// reading order. Every section renders only when the underlying field has
// real data — nothing here invents, distorts, or drops anything from the
// source; it only reorganizes what extraction already produced. The full
// original posting still renders separately (in JobDetailView, after this
// component) as the source of truth.
// ---------------------------------------------------------------------------

const NEUTRAL_TONE: PillTone = { bg: 'bg-hover', text: 'text-ink' };
const SKILL_TONE: PillTone = {
  bg: 'bg-brand-50 dark:bg-brand-500/15',
  text: 'text-brand-700 dark:text-brand-300',
};

export function JobDescriptionSections({
  job,
  reqs,
  skills,
  applyUrl,
  googleUrl,
}: {
  job: Job;
  reqs: JobRequirements | null | undefined;
  /** Resolved skill list (reqs.required_skills, falling back to job.required_skills) — computed by the caller since it already needs the same value for its empty-state check. */
  skills: string[];
  applyUrl: string;
  googleUrl: string;
}) {
  const seniority = reqs?.job_seniority ?? job.level ?? null;
  const minYears = reqs?.min_years_of_experience ?? null;
  const workModel = reqs?.work_model ?? (job.remote ? 'Remote' : 'Onsite');
  const compensation = formatCompensation(job.rate_min, job.rate_max);
  const hasCompensation = compensation !== 'Compensation not provided';

  const overviewChips = [
    workModel,
    prettyType(job.job_type),
    seniority,
    minYears != null ? `${minYears}+ yrs exp` : null,
    hasCompensation ? compensation : null,
  ].filter((v): v is string => !!v);

  const mustHaves = reqs?.must_haves ?? [];
  const niceToHaves = reqs?.nice_to_haves ?? [];
  const highlights = reqs?.highlights ?? [];
  const responsibilities = reqs?.core_responsibilities ?? [];
  const skillSummaries = reqs?.skill_summaries ?? [];
  const benefits = reqs?.benefits_summaries ?? [];
  const education = reqs?.education_summaries ?? [];
  const workAuth = reqs?.work_authorization ?? [];
  const notes = reqs?.recommendation_tags ?? [];

  return (
    <>
      {overviewChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {overviewChips.map((c) => (
            <Pill key={c} tone={NEUTRAL_TONE} size="sm">
              {c}
            </Pill>
          ))}
        </div>
      )}

      {highlights.length > 0 && (
        <Section title="Key Highlights">
          <Bullets items={highlights.slice(0, 5)} marker="★" tone="text-sky-500" />
        </Section>
      )}

      {responsibilities.length > 0 && (
        <Section title="Responsibilities">
          <Bullets items={responsibilities.slice(0, 8)} />
        </Section>
      )}

      {mustHaves.length > 0 && (
        <Section title="Required Qualifications">
          <Bullets items={mustHaves} />
        </Section>
      )}

      {niceToHaves.length > 0 && (
        <Section title="Preferred Qualifications">
          <Bullets items={niceToHaves} marker="+" tone="text-emerald-500" />
        </Section>
      )}

      {skills.length > 0 && (
        <Section title="Technical Skills">
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <Pill key={s} tone={SKILL_TONE}>
                {s}
              </Pill>
            ))}
          </div>
        </Section>
      )}

      {skillSummaries.length > 0 && (
        <Section title="Skill Requirements">
          <Bullets items={skillSummaries.slice(0, 8)} />
        </Section>
      )}

      {(minYears != null || seniority || education.length > 0) && (
        <Section title="Experience & Education">
          <div className="space-y-2.5">
            {(minYears != null || seniority) && (
              <div>
                {seniority && <FactRow label="Level" value={seniority} />}
                {minYears != null && <FactRow label="Experience" value={`${minYears}+ years`} />}
              </div>
            )}
            {education.length > 0 && <Bullets items={education} />}
          </div>
        </Section>
      )}

      {benefits.length > 0 && (
        <Section title="Benefits & Perks">
          <Bullets items={benefits.slice(0, 6)} marker="+" tone="text-emerald-500" />
        </Section>
      )}

      <Section title="Compensation">
        <p
          className={hasCompensation ? 'text-sm font-medium text-ink' : 'text-sm text-muted italic'}
        >
          {compensation}
        </p>
      </Section>

      {workAuth.length > 0 && (
        <Section title="Work Authorization & Eligibility">
          <Bullets items={workAuth} tone="text-amber-500" />
        </Section>
      )}

      {notes.length > 0 && (
        <Section title="Important Notes">
          <Bullets items={notes} marker="⚠" tone="text-amber-500" />
        </Section>
      )}

      <Section title="Application Information">
        <div>
          <FactRow label="Source" value={job.publisher ?? job.source ?? 'Direct'} />
          <FactRow label="Posted" value={relative(job.posted_at ?? job.created_at)} />
        </div>
        <div className="mt-3">
          <a
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 bg-ink text-bg text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 press"
          >
            Apply on company site <span>↗</span>
          </a>
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-muted hover:text-ink mt-1.5"
          >
            Link not working? Search on Google ↗
          </a>
        </div>
      </Section>
    </>
  );
}
