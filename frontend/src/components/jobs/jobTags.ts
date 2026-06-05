import { prettyRate } from './helpers';

export type TagTone = 'salary' | 'remote' | 'seniority' | 'visaGood' | 'visaBad' | 'neutral';
export interface JobTag {
  label: string;
  tone: TagTone;
}

/** Minimal shape jobTags needs — satisfied by both JobRow and the detail Job. */
interface TaggableJob {
  rate_min?: number | null;
  rate_max?: number | null;
  remote?: boolean | null;
  level?: string | null;
  requirements?: {
    work_model?: string | null;
    job_seniority?: string | null;
    min_years_of_experience?: number | null;
    work_authorization?: string[];
  } | null;
}

/** Jobright-style summary chips derived from a job's fields + extracted
 *  requirements: salary, work model, seniority, experience, visa posture. */
export function jobTags(job: TaggableJob): JobTag[] {
  const reqs = job.requirements ?? {};
  const tags: JobTag[] = [];

  if (job.rate_min != null || job.rate_max != null) {
    tags.push({ label: prettyRate(job.rate_min, job.rate_max), tone: 'salary' });
  }

  const wm = reqs.work_model ?? (job.remote ? 'Remote' : null);
  if (wm) tags.push({ label: String(wm), tone: 'remote' });

  const seniority = reqs.job_seniority ?? job.level ?? null;
  if (seniority) tags.push({ label: String(seniority), tone: 'seniority' });

  if (typeof reqs.min_years_of_experience === 'number' && reqs.min_years_of_experience > 0) {
    tags.push({ label: `${reqs.min_years_of_experience}+ yrs`, tone: 'neutral' });
  }

  for (const a of reqs.work_authorization ?? []) {
    if (/h1b sponsor|sponsor likely|visa friendly/i.test(a)) {
      tags.push({ label: a, tone: 'visaGood' });
      break;
    }
    if (/no sponsor/i.test(a)) {
      tags.push({ label: a, tone: 'visaBad' });
      break;
    }
  }

  return tags;
}

export const TAG_TONE: Record<TagTone, string> = {
  salary:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25 font-semibold',
  remote:
    'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/25',
  seniority: 'bg-hover text-ink-2 border-border',
  visaGood:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25',
  visaBad:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/25',
  neutral: 'bg-hover text-muted border-border',
};
