import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import {
  matchJobsForConsultant,
  atsScore,
  scoreResumeAgainstJob,
  jobCopilot,
} from '../services/ai.service';
import { parseJobRequirements } from '../services/jobParser.service';
import { tailorForJob as resumeTailorForJob } from './resumes.controller';
import { fromJob as applicationsFromJob } from './applications.controller';
import { httpError } from '../types';

// Light user join helper — explicit FK hint so the embed never collides.
const JOB_SELECT = '*, client:clients(id, company_name), vendor:vendors(id, company_name)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getConsultantForUser(userId: string) {
  const { data } = await db
    .from('consultants')
    .select(
      'id, primary_skill, skills, total_experience_years, preferred_locations, current_location, remote_only, visa_status',
    )
    .eq('user_id', userId)
    .maybeSingle();
  return data ?? null;
}

/** Curated job-function buckets → list of title regex patterns. Same set the
 *  frontend exposes as the Job Function pill. */
const JOB_FUNCTION_PATTERNS: Record<string, string[]> = {
  'Software Engineer': ['software engineer', 'software developer', 'software development'],
  'Java Engineer': ['java', 'spring'],
  'Frontend Engineer': ['frontend', 'front end', 'front-end', 'react', 'angular', 'vue'],
  'Backend Engineer': ['backend', 'back end', 'back-end', 'api engineer'],
  'Full Stack Engineer': ['full stack', 'full-stack', 'fullstack'],
  'Data Engineer': ['data engineer', 'etl', 'data pipeline'],
  'Data Scientist': ['data scientist', 'machine learning', 'ml engineer', 'ai engineer'],
  'DevOps / SRE': ['devops', 'site reliability', 'sre', 'platform engineer', 'infrastructure'],
  'Cloud Engineer': ['cloud engineer', 'aws engineer', 'azure engineer', 'gcp engineer'],
  'QA Engineer': ['qa', 'quality assurance', 'test engineer', 'sdet'],
  'Salesforce Developer': ['salesforce'],
  'Business Analyst': ['business analyst'],
  'Project Manager': ['project manager', 'program manager', 'scrum master'],
  'Product Manager': ['product manager', 'product owner'],
};

/** Build a job-function matcher applied AFTER the DB fetch.
 *  We deliberately don't push this into PostgREST as a second `.or()`:
 *  The PostgREST OR semantics require that `or()` not be combined with another
 *  `or()`, and we already use `.or()` for "USA + remote" in the location
 *  filter. Post-filtering keeps both filters correct. */
function buildJobFunctionMatcher(
  jobFunction: string | undefined,
): ((title: string) => boolean) | null {
  if (!jobFunction) return null;
  const patterns = JOB_FUNCTION_PATTERNS[jobFunction] ?? [jobFunction];
  const lowered = patterns.map((p) => p.toLowerCase());
  return (title: string) => {
    const t = (title ?? '').toLowerCase();
    return lowered.some((p) => t.includes(p));
  };
}

/** Apply a location filter that understands "United States" / "USA" / "US" as
 *  a country-level group (includes remote roles, since those are US-eligible).
 *  Any other string is treated as a plain substring.
 *
 *  Note on PostgREST: the `or` filter uses commas as separators, so we cannot
 *  put a literal comma inside any pattern (no `%, us%`). We rely on the fact
 *  that JSearch builds "City, State, US" and Greenhouse uses "City, State,
 *  United States" — so matching the trailing token via `% us` (ends-with) or
 *  the full phrase `%united states%` covers both shapes cleanly. */
function applyLocationFilter(qb: any, location: string) {
  const trimmed = location.trim();
  if (/^(united states|usa|us|u\.s\.|u\.s\.a\.)$/i.test(trimmed)) {
    return qb.or(
      'location.ilike.%united states%,' +
        'location.ilike.% us,' + // ends with " US" (no trailing space)
        'location.ilike.% us %,' + // " US " mid-string
        'location.ilike.%usa%,' +
        'remote.eq.true',
    );
  }
  return qb.ilike('location', `%${trimmed}%`);
}

/** Skill array used for matching — prefers the multi-skill array, falls back
 *  to splitting primary_skill on commas/semicolons, then to an empty list. */
function skillsForMatching(c: any): string[] {
  if (Array.isArray(c?.skills) && c.skills.length > 0) {
    return (c.skills as string[]).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof c?.primary_skill === 'string' && c.primary_skill.trim()) {
    return c.primary_skill
      .split(/[,;|/]/)
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
  return [];
}

async function annotateLiked<T extends { id: string }>(
  rows: T[],
  userId: string,
): Promise<(T & { liked: boolean })[]> {
  if (rows.length === 0) return [];
  const { data } = await db
    .from('liked_jobs')
    .select('job_id')
    .eq('user_id', userId)
    .in(
      'job_id',
      rows.map((r) => r.id),
    );
  const likedIds = new Set((data ?? []).map((d: any) => d.job_id));
  return rows.map((r) => ({ ...r, liked: likedIds.has(r.id) }));
}

// ---------------------------------------------------------------------------
// CRUD + filters
// ---------------------------------------------------------------------------

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { q, location, remote, level, job_type, posted_after, years_min, publisher, job_function } =
    req.query as Record<string, string | undefined>;

  let qb = db.from('jobs').select(JOB_SELECT).eq('is_active', true);
  if (q) qb = qb.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  if (location) qb = applyLocationFilter(qb, location);
  if (remote === 'true') qb = qb.eq('remote', true);
  if (remote === 'false') qb = qb.eq('remote', false);
  if (level) qb = qb.eq('level', level);
  if (job_type) qb = qb.eq('job_type', job_type);
  if (posted_after) qb = qb.gte('posted_at', posted_after);
  if (publisher) qb = qb.eq('publisher', publisher);

  const { data, error } = await qb.order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);

  let rows = (data ?? []) as any[];
  // Post-filters (don't push to PostgREST — see buildJobFunctionMatcher).
  const fnMatcher = buildJobFunctionMatcher(job_function);
  if (fnMatcher) rows = rows.filter((j) => fnMatcher(j.title ?? ''));
  if (years_min) {
    const min = Number(years_min);
    rows = rows.filter((j) => {
      const r = j.requirements?.years_required;
      return r == null || r >= min;
    });
  }
  const annotated = await annotateLiked(rows, req.user.id);
  res.json(annotated);
};

export const get: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db.from('jobs').select(JOB_SELECT).eq('id', req.params.id).single();
  if (error || !data) throw httpError(404, 'Job not found');
  const [annotated] = await annotateLiked([data as any], req.user.id);
  res.json(annotated);
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('jobs')
    .insert({ ...req.body, created_by: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  const { data, error } = await db
    .from('jobs')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const remove: RequestHandler = async (req, res) => {
  const { error } = await db.from('jobs').delete().eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// Recommended / Liked / Applied tabs
// ---------------------------------------------------------------------------

/** Jobright-style recommended feed.
 *  Scoring target: either the calling consultant, OR a consultant identified
 *  via `?consultant_id=…` (used when a recruiter searches on behalf of
 *  someone). The AI ranker also considers the consultant's current resume
 *  text when present — much richer than a bare skill list. */
export const recommended: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { location, remote, posted_after, publisher, job_function, consultant_id, page, per_page } =
    req.query as Record<string, string | undefined>;

  // Pagination params — bounded so a hostile query can't ask for page=99999
  // with a 1000-per-page slice. Defaults: page 1, 40 rows per page.
  const pageNum = Math.max(1, Math.min(1000, Number(page) || 1));
  const perPage = Math.max(1, Math.min(200, Number(per_page) || 40));

  // Resolve the target consultant. If the request says so explicitly, use
  // that; otherwise fall back to the caller's own consultant row (if any).
  let consultant: any = null;
  let resumeText = '';
  if (consultant_id) {
    const { data } = await db
      .from('consultants')
      .select('id, primary_skill, skills, total_experience_years, preferred_locations')
      .eq('id', consultant_id)
      .maybeSingle();
    consultant = data ?? null;
  } else {
    consultant = await getConsultantForUser(req.user.id);
  }
  if (consultant?.id) {
    // Try the consultant's current resume first; fall back to the latest
    // version if `is_current` was never set (common after early uploads).
    let { data: resume } = await db
      .from('resumes')
      .select('ai_feedback, body_text')
      .eq('consultant_id', consultant.id)
      .eq('is_current', true)
      .maybeSingle();
    if (!resume) {
      const r = await db
        .from('resumes')
        .select('ai_feedback, body_text')
        .eq('consultant_id', consultant.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      resume = r.data ?? null;
    }
    resumeText =
      (resume as any)?.body_text ||
      (typeof (resume as any)?.ai_feedback?.resume_text === 'string'
        ? (resume as any).ai_feedback.resume_text
        : '') ||
      '';
  }

  let qb = db.from('jobs').select(JOB_SELECT).eq('is_active', true);
  // Only apply a location filter when the caller explicitly asked for one.
  // The previous default of "United States" silently hid every non-US row
  // (and most Greenhouse / Ashby orgs are global), so the recommended page
  // looked like it only had ~40 jobs. Now the default returns the full
  // active feed and the user opts into a location with the filter pill.
  if (location && location.trim().length > 0) {
    qb = applyLocationFilter(qb, location);
  }
  if (remote === 'true') qb = qb.eq('remote', true);
  if (remote === 'false') qb = qb.eq('remote', false);
  if (posted_after) qb = qb.gte('posted_at', posted_after);
  if (publisher) qb = qb.eq('publisher', publisher);
  // No hard 40-row cap anymore — the page is the user's full feed. A high
  // ceiling (2k) still protects the response size, prevents pathological
  // payloads, and matches what the frontend can render without lag. Override
  // via JOBS_RECOMMENDED_MAX env var if you ever need more.
  const fnMatcher = buildJobFunctionMatcher(job_function);
  const fetchLimit = Math.max(
    100,
    Math.min(5000, Number(process.env.JOBS_RECOMMENDED_MAX ?? 2000)),
  );
  const { data: jobs, error } = await qb.limit(fetchLimit);
  if (error) throw httpError(500, error.message);

  let ranked = jobs ?? [];
  if (fnMatcher) ranked = ranked.filter((j: any) => fnMatcher(j.title ?? ''));

  // Compute a deterministic baseline score for every job from skill overlap
  // (consultant skills ∩ job.required_skills). This guarantees a score on
  // every card even when the AI ranker is unreachable / rate-limited. The
  // AI score, when it returns, overrides this baseline.
  const consultantSkills = skillsForMatching(consultant ?? {});
  const baselineById = new Map<string, { score: number; reasons: string[] }>();
  if (consultant && consultantSkills.length > 0) {
    const mine = new Set(consultantSkills.map((s) => s.toLowerCase()));
    for (const j of ranked) {
      const need: string[] = j.requirements?.required_skills?.length
        ? j.requirements.required_skills
        : (j.required_skills ?? []);
      if (need.length === 0) {
        // No skill data at all — give a neutral 50 so the card shows something.
        baselineById.set(j.id, {
          score: 50,
          reasons: ['No required-skills metadata yet — score is a placeholder.'],
        });
        continue;
      }
      const overlap = need.filter((s) => mine.has(String(s).toLowerCase()));
      const score = Math.round((overlap.length / need.length) * 100);
      const reasons: string[] = [];
      if (overlap.length > 0) {
        reasons.push(
          `Matched skills: ${overlap.slice(0, 5).join(', ')}${overlap.length > 5 ? '…' : ''}`,
        );
      }
      const missing = need.filter((s) => !mine.has(String(s).toLowerCase()));
      if (missing.length > 0) {
        reasons.push(`Missing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}`);
      }
      baselineById.set(j.id, { score, reasons });
    }
  } else if (consultant) {
    // No skills on the consultant — every job gets a 0 with a hint.
    for (const j of ranked) {
      baselineById.set(j.id, { score: 0, reasons: ['Add skills to your profile to get matched.'] });
    }
  }

  // Diagnostic header — surfaces in dev tools and lets the frontend explain
  // missing scores ("no resume on file", "AI matcher failed", etc.).
  res.setHeader(
    'x-match-mode',
    consultant?.id
      ? resumeText
        ? 'resume+skills'
        : consultantSkills.length > 0
          ? 'skills-only'
          : 'no-signal'
      : 'no-consultant',
  );
  res.setHeader('x-match-skills-count', String(consultantSkills.length));
  res.setHeader('x-match-resume-bytes', String(resumeText.length));
  res.setHeader('x-match-baseline-applied', String(baselineById.size));
  // Apply the deterministic baseline first so every card has a score even if
  // the AI call below fails or is rate-limited.
  ranked = ranked.map((j: any) => {
    const base = baselineById.get(j.id);
    return base
      ? { ...j, match_score: base.score, match_reasons: base.reasons }
      : { ...j, match_score: j.match_score ?? null, match_reasons: j.match_reasons ?? [] };
  });

  if (consultant && ranked.length > 0) {
    try {
      const profile: any = {
        skills: consultantSkills,
        experienceYears: consultant.total_experience_years ?? 0,
        preferredLocations: consultant.preferred_locations ?? [],
      };
      if (resumeText) profile.resume_excerpt = resumeText.slice(0, 4000);
      // Only AI-rank the top N by deterministic baseline score. The rest of
      // the feed (which can now be thousands of rows) keeps its baseline
      // score from the loop above — perfectly serviceable, just less
      // nuanced. Caps Anthropic spend to a single batched prompt regardless
      // of feed size.
      const AI_RANK_TOP_N = Math.max(
        10,
        Math.min(100, Number(process.env.JOBS_AI_RANK_TOP_N ?? 40)),
      );
      const topForAi = [...ranked]
        .sort((a: any, b: any) => (b.match_score ?? -1) - (a.match_score ?? -1))
        .slice(0, AI_RANK_TOP_N);
      const matches = await matchJobsForConsultant(
        profile,
        topForAi.map((j: any) => ({
          id: j.id,
          title: j.title,
          required_skills: j.required_skills,
          location: j.location,
          description: (j.description ?? '').slice(0, 1500),
        })),
      );
      const byId = new Map(matches.map((m) => [m.job_id, m]));
      // Layer the AI score over the baseline.
      ranked = ranked.map((j: any) => {
        const ai = byId.get(j.id);
        if (!ai || typeof ai.match_score !== 'number') return j;
        return { ...j, match_score: ai.match_score, match_reasons: ai.reasons ?? j.match_reasons };
      });
      res.setHeader('x-match-ai', 'ok');
    } catch (e: any) {
      console.warn(
        '[jobs.recommended] AI ranker failed; baseline scores retained:',
        e?.message ?? e,
      );
      res.setHeader('x-match-ai', `error: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  ranked = ranked.sort((a: any, b: any) => (b.match_score ?? -1) - (a.match_score ?? -1));

  // Page-slice. Always sort BEFORE slicing — top-of-feed is the most useful
  // page regardless of pagination params. annotateLiked is cheap enough to
  // run on the page subset only (an extra row lookup per page is fine).
  const total = ranked.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = (pageNum - 1) * perPage;
  const pageRows = ranked.slice(start, start + perPage);
  const annotated = await annotateLiked(pageRows as any[], req.user.id);
  res.json({
    rows: annotated,
    page: pageNum,
    per_page: perPage,
    total,
    total_pages: totalPages,
  });
};

export const liked: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('liked_jobs')
    .select(`job:jobs(${JOB_SELECT})`)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  const jobs = (data ?? []).map((r: any) => r.job).filter(Boolean);
  // All entries are liked by definition.
  res.json(jobs.map((j: any) => ({ ...j, liked: true })));
};

export const applied: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { consultant_id } = req.query as Record<string, string | undefined>;

  // Resolve the consultant: explicit param (recruiter on-behalf-of view) or
  // the caller's own consultant row.
  let consultantId: string | null = null;
  if (consultant_id) {
    consultantId = consultant_id;
  } else {
    const me = await getConsultantForUser(req.user.id);
    consultantId = me?.id ?? null;
  }
  if (!consultantId) {
    res.json([]);
    return;
  }

  // Try the rich select first; if the AI-job-search migration hasn't been
  // applied yet, fall back to the legacy column set so the Applied tab still
  // renders instead of 500'ing on every load.
  const RICH_COLS = `id, status, submitted_at, applied_method, match_score, ats_score, job:jobs(${JOB_SELECT})`;
  const LEAN_COLS = `id, status, submitted_at, job:jobs(${JOB_SELECT})`;
  let data: any[] | null = null;
  let error: any = null;
  ({ data, error } = await db
    .from('applications')
    .select(RICH_COLS)
    .eq('consultant_id', consultantId)
    .order('submitted_at', { ascending: false }));
  if (
    error &&
    /(applied_method|match_score|ats_score)/.test(error.message) &&
    /schema cache|column/i.test(error.message)
  ) {
    ({ data, error } = await db
      .from('applications')
      .select(LEAN_COLS)
      .eq('consultant_id', consultantId)
      .order('submitted_at', { ascending: false }));
  }
  if (error) throw httpError(500, error.message);
  const jobs = (data ?? [])
    .filter((r: any) => r.job)
    .map((r: any) => ({
      ...r.job,
      application_id: r.id,
      application_status: r.status,
      applied_at: r.submitted_at,
      applied_method: (r as any).applied_method ?? null,
      // Apply-tab cards should display the at-apply match score, not the
      // freshly-recomputed one, so users see the score that was recorded then.
      match_score: (r as any).match_score ?? r.job.match_score ?? null,
      ats_score: (r as any).ats_score ?? null,
    }));
  const annotated = await annotateLiked(jobs as any[], req.user.id);
  res.json(annotated);
};

// ---------------------------------------------------------------------------
// Like / unlike
// ---------------------------------------------------------------------------

export const like: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { error } = await db
    .from('liked_jobs')
    .upsert({ user_id: req.user.id, job_id: req.params.id });
  if (error) throw httpError(500, error.message);
  res.json({ ok: true, liked: true });
};

export const unlike: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { error } = await db
    .from('liked_jobs')
    .delete()
    .eq('user_id', req.user.id)
    .eq('job_id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true, liked: false });
};

// ---------------------------------------------------------------------------
// Match analysis for a single job vs the calling consultant
// ---------------------------------------------------------------------------

export const matchForMe: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const jobId = req.params.id;

  const { data: job, error: e1 } = await db.from('jobs').select('*').eq('id', jobId).single();
  if (e1 || !job) throw httpError(404, 'Job not found');

  const consultant = await getConsultantForUser(req.user.id);
  if (!consultant) throw httpError(400, 'Complete your consultant profile first');

  const matches = await matchJobsForConsultant(
    {
      skills: consultant.primary_skill ? [consultant.primary_skill] : [],
      experienceYears: consultant.total_experience_years ?? 0,
      preferredLocations: consultant.preferred_locations ?? [],
    },
    [
      {
        id: job.id,
        title: job.title,
        required_skills: job.required_skills,
        location: job.location,
        description: job.description,
      },
    ],
  );
  res.json(matches[0] ?? null);
};

// ---------------------------------------------------------------------------
// Extracted requirements (free local heuristic parser; caches on the job row)
// ---------------------------------------------------------------------------

export const requirementsFor: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: job, error } = await db.from('jobs').select('*').eq('id', req.params.id).single();
  if (error || !job) throw httpError(404, 'Job not found');
  if (job.requirements) {
    res.json(job.requirements);
    return;
  }

  const extracted = parseJobRequirements({
    title: job.title,
    description: job.description,
    required_skills: job.required_skills,
    location: job.location,
    remote: job.remote,
  });
  await db.from('jobs').update({ requirements: extracted }).eq('id', job.id);
  res.json(extracted);
};

// ---------------------------------------------------------------------------
// Batch enrichment: AI-extract Jobright-style requirements for every job that
// doesn't have them yet. Run after a `/sync` to backfill structured fields.
// Concurrency-limited so we don't melt the AI provider.
// ---------------------------------------------------------------------------

export const enrichPending: RequestHandler = async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
  const concurrency = Math.min(Math.max(Number(req.query.concurrency ?? 5), 1), 10);

  const { data: pending, error } = await db
    .from('jobs')
    .select('id, title, description, required_skills, location')
    .is('requirements', null)
    .eq('is_active', true)
    .limit(limit);
  if (error) throw httpError(500, error.message);
  if (!pending || pending.length === 0) {
    res.json({ enriched: 0, total_pending: 0 });
    return;
  }

  let enriched = 0;
  let failed = 0;
  // Simple concurrent worker pool.
  const queue = [...pending];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        try {
          const reqs = parseJobRequirements({
            title: job.title,
            description: job.description,
            required_skills: job.required_skills,
            location: job.location,
            remote: job.remote,
          });
          const patch: any = { requirements: reqs };
          // Mirror Jobright: surface seniority/work model at the column level too.
          if (reqs.job_seniority) patch.level = reqs.job_seniority;
          // Also enrich the canonical required_skills column.
          if (reqs.required_skills?.length) patch.required_skills = reqs.required_skills;
          await db.from('jobs').update(patch).eq('id', job.id);
          enriched++;
        } catch {
          failed++;
        }
      }
    }),
  );
  res.json({ enriched, failed, total_processed: pending.length });
};

/** Enrich a single job on demand (used by detail page lazy-load). */
export const enrichOne: RequestHandler = async (req, res) => {
  const { data: job, error } = await db.from('jobs').select('*').eq('id', req.params.id).single();
  if (error || !job) throw httpError(404, 'Job not found');
  const reqs = parseJobRequirements({
    title: job.title,
    description: job.description,
    required_skills: job.required_skills,
    location: job.location,
    remote: job.remote,
  });
  const patch: any = { requirements: reqs };
  if (reqs.job_seniority) patch.level = reqs.job_seniority;
  if (reqs.required_skills?.length) patch.required_skills = reqs.required_skills;
  await db.from('jobs').update(patch).eq('id', job.id);
  res.json({ ...job, ...patch });
};

// ---------------------------------------------------------------------------
// Per-skill match scoring against current consultant's resume.
// Same shape as Jobright's skillMatchingScores / recommendationScores.
// ---------------------------------------------------------------------------

export const skillMatchForMe: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const consultant = await getConsultantForUser(req.user.id);
  if (!consultant) throw httpError(400, 'Complete your consultant profile first');

  // Use the latest current resume text from the resumes table.
  const { data: resume } = await db
    .from('resumes')
    .select('ai_feedback, file_name')
    .eq('consultant_id', consultant.id)
    .eq('is_current', true)
    .maybeSingle();
  // Caller can also pass resume_text directly (e.g. from a fresh paste).
  const resumeText: string =
    String(req.body?.resume_text ?? '') || extractResumeText(resume?.ai_feedback);
  if (!resumeText) throw httpError(400, 'No resume text available. POST resume_text in the body.');

  const { data: job, error } = await db.from('jobs').select('*').eq('id', req.params.id).single();
  if (error || !job) throw httpError(404, 'Job not found');

  // Make sure we have extracted requirements so we know which skills to match.
  let reqs = job.requirements;
  if (!reqs) {
    reqs = parseJobRequirements({
      title: job.title,
      description: job.description,
      required_skills: job.required_skills,
      location: job.location,
      remote: job.remote,
    });
    await db.from('jobs').update({ requirements: reqs }).eq('id', job.id);
  }

  const result = await scoreResumeAgainstJob({
    resumeText,
    job: {
      title: job.title,
      description: job.description,
      required_skills: reqs?.required_skills ?? job.required_skills,
      min_years_of_experience: reqs?.min_years_of_experience ?? null,
      job_seniority: reqs?.job_seniority ?? job.level ?? null,
    },
  });
  res.json(result);
};

// ---------------------------------------------------------------------------
// AI job copilot — answer a candidate's question about a specific job.
// Available to any signed-in user; if the caller is a consultant we attach
// their current resume for personalized answers. Requires ANTHROPIC_API_KEY.
// ---------------------------------------------------------------------------
const copilotSchema = z.object({ question: z.string().trim().min(1).max(500) }).strict();

export const copilot: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!process.env.ANTHROPIC_API_KEY) {
    throw httpError(503, 'AI copilot is not configured (set ANTHROPIC_API_KEY).');
  }
  const parsed = copilotSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'A question is required', parsed.error.flatten());

  const { data: job, error } = await db.from('jobs').select('*').eq('id', req.params.id).single();
  if (error || !job) throw httpError(404, 'Job not found');

  // Attach the caller's current resume when they're a consultant.
  let resumeText: string | null = null;
  const consultant = await getConsultantForUser(req.user.id);
  if (consultant) {
    const { data: resume } = await db
      .from('resumes')
      .select('ai_feedback')
      .eq('consultant_id', consultant.id)
      .eq('is_current', true)
      .maybeSingle();
    resumeText = extractResumeText(resume?.ai_feedback) || null;
  }

  const reqs = job.requirements ?? {};
  try {
    const answer = await jobCopilot({
      question: parsed.data.question,
      job: {
        title: job.title,
        company: job.company_name,
        location: job.location,
        description: job.description,
        required_skills: reqs.required_skills ?? job.required_skills,
        seniority: reqs.job_seniority ?? job.level ?? null,
      },
      resumeText,
    });
    res.json({ answer });
  } catch (e) {
    throw httpError(502, e instanceof Error ? e.message : 'Copilot request failed');
  }
};

function extractResumeText(feedback: unknown): string {
  // ai_feedback is jsonb. We don't have a clean "resume_text" column, so try a
  // few common fields if present. Fallback: empty string (caller must pass text).
  if (!feedback || typeof feedback !== 'object') return '';
  const f = feedback as Record<string, unknown>;
  if (typeof f.resume_text === 'string') return f.resume_text;
  if (typeof f.text === 'string') return f.text;
  return '';
}

// ---------------------------------------------------------------------------
// ATS-style resume match against this job (uses the current resume text)
// ---------------------------------------------------------------------------

export const atsMatch: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const resumeText = String(req.body?.resume_text ?? '');
  if (!resumeText) throw httpError(400, 'resume_text is required');

  const { data: job, error } = await db
    .from('jobs')
    .select('description')
    .eq('id', req.params.id)
    .single();
  if (error || !job) throw httpError(404, 'Job not found');

  const result = await atsScore(resumeText, job.description ?? '');
  res.json(result);
};

// ---------------------------------------------------------------------------
// POST /jobs/import-url — manual paste-a-job-URL ingestion.
//
// Body: { url, title, company_name, location?, description?, required_skills? }
// Idempotent on (source='manual', external_id=url).
// ---------------------------------------------------------------------------
export const importByUrl: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const body = req.body ?? {};
  const url = String(body.url ?? '').trim();
  const title = String(body.title ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) throw httpError(400, 'url (http or https) is required');
  if (!title) throw httpError(400, 'title is required');
  const row: any = {
    source: 'manual',
    external_id: url,
    title,
    company_name: String(body.company_name ?? body.company ?? 'Unknown'),
    description: body.description ?? null,
    location: body.location ?? null,
    remote: !!body.remote || /remote/i.test(String(body.location ?? '')),
    job_type: body.job_type ?? 'FTE',
    level: body.level ?? null,
    required_skills: Array.isArray(body.required_skills) ? body.required_skills : [],
    rate_min: body.rate_min ?? null,
    rate_max: body.rate_max ?? null,
    apply_url: url,
    posted_at: body.posted_at ?? new Date().toISOString(),
    is_active: true,
    last_synced_at: new Date().toISOString(),
    publisher: 'Manual',
    created_by: req.user.id,
  };
  let { data, error } = await db
    .from('jobs')
    .upsert(row, { onConflict: 'source,external_id' })
    .select()
    .single();
  if (error && /publisher/.test(error.message) && /schema cache|column/i.test(error.message)) {
    delete row.publisher;
    ({ data, error } = await db
      .from('jobs')
      .upsert(row, { onConflict: 'source,external_id' })
      .select()
      .single());
  }
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

// ---------------------------------------------------------------------------
// POST /jobs/:id/apply-options  body: { consultant_id?: uuid }
//
// Single endpoint the ApplyOptions modal hits to get everything it needs:
//   - duplicate_submission?   { duplicate, status, submitted_at }
//   - match_score, ats_score, rank_desc  (cached from resume_job_matches if present)
//   - missing_keywords (job's required_skills minus consultant.skills)
//   - apply_url
//   - source / publisher
// ---------------------------------------------------------------------------
export const applyOptions: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const jobId = req.params.id;
  const consultantId = String(req.body?.consultant_id ?? '');

  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select(
      'id, title, company_name, location, apply_url, source, publisher, required_skills, requirements',
    )
    .eq('id', jobId)
    .single();
  if (jobErr || !job) throw httpError(404, 'Job not found');

  const result: any = {
    job,
    duplicate_submission: null,
    match: null,
    missing_keywords: [],
  };

  if (consultantId) {
    // Duplicate check.
    const { data: dup } = await db
      .from('applications')
      .select('id, status, submitted_at')
      .eq('consultant_id', consultantId)
      .eq('job_id', jobId)
      .order('submitted_at', { ascending: false })
      .limit(1);
    if (dup && dup.length > 0) {
      result.duplicate_submission = {
        duplicate: true,
        application_id: dup[0].id,
        status: dup[0].status,
        submitted_at: dup[0].submitted_at,
      };
    }
    // Cached match (resume_job_matches).
    try {
      const { data: cached } = await db
        .from('resume_job_matches')
        .select('match_score, ats_score, rank_desc, missing_keywords, computed_at')
        .eq('consultant_id', consultantId)
        .eq('job_id', jobId)
        .order('computed_at', { ascending: false })
        .limit(1);
      if (cached && cached[0]) result.match = cached[0];
    } catch {
      /* table missing — non-fatal */
    }
    // Compute missing_keywords from consultant.skills × job.required_skills.
    const { data: c } = await db
      .from('consultants')
      .select('skills, primary_skill')
      .eq('id', consultantId)
      .maybeSingle();
    if (c) {
      const mine = new Set(
        (Array.isArray((c as any).skills) && (c as any).skills.length > 0
          ? ((c as any).skills as string[])
          : c.primary_skill
            ? c.primary_skill.split(/[,;|/]/).map((s: string) => s.trim())
            : []
        )
          .map((s: string) => s.toLowerCase())
          .filter(Boolean),
      );
      const need =
        (job.requirements?.required_skills?.length
          ? job.requirements.required_skills
          : job.required_skills) ?? [];
      result.missing_keywords = need.filter((s: string) => !mine.has(s.toLowerCase())).slice(0, 20);
    }
    // Log the funnel-entry event.
    try {
      await db.from('application_events').insert({
        job_id: jobId,
        consultant_id: consultantId,
        kind: 'apply_clicked',
        created_by: req.user.id,
      });
    } catch {
      /* non-fatal */
    }
  }
  res.json(result);
};

// ---------------------------------------------------------------------------
// Duplicate-submission check — true when this consultant already has an
// application for this job. Surfaced as a warning on the recruiter card so
// they don't re-submit by accident.
// ---------------------------------------------------------------------------
export const duplicateCheck: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const consultantId = String(req.query.consultant_id ?? '');
  if (!consultantId) {
    res.json({ duplicate: false });
    return;
  }
  const { data } = await db
    .from('applications')
    .select('id, status, submitted_at')
    .eq('consultant_id', consultantId)
    .eq('job_id', req.params.id)
    .order('submitted_at', { ascending: false })
    .limit(1);
  const hit = data?.[0];
  res.json({
    duplicate: !!hit,
    application_id: hit?.id ?? null,
    status: hit?.status ?? null,
    submitted_at: hit?.submitted_at ?? null,
  });
};

// ---------------------------------------------------------------------------
// POST /jobs/:id/customize-resume — Jobright "Fix My Resume" alias.
//
// Body: { consultant_id, source_resume_id, sections, keywords, resume_text? }
// Same shape as POST /resumes/tailor but with job_id taken from the URL.
// Also writes a row to resume_customizations so we have a queryable history
// of customizations per job.
// ---------------------------------------------------------------------------
export const customizeResume: RequestHandler = async (req, res, next) => {
  // Re-shape the request so the existing resumes.tailor handler can run
  // unchanged: it expects job_id in the body, we have it in the URL.
  req.body = { ...(req.body ?? {}), job_id: req.params.id };
  return resumeTailorForJob(req, res, next);
};

// ---------------------------------------------------------------------------
// POST /jobs/:id/apply-confirm — recruiter or consultant confirms a submission.
// Thin alias over POST /applications/from-job that just sets job_id from URL.
// ---------------------------------------------------------------------------
export const applyConfirm: RequestHandler = async (req, res, next) => {
  req.body = { ...(req.body ?? {}), job_id: req.params.id };
  return applicationsFromJob(req, res, next);
};

// ---------------------------------------------------------------------------
// Legacy endpoint kept for back-compat with the old /api/jobs/match/consultant/:id route
// ---------------------------------------------------------------------------
export const matchForConsultant: RequestHandler = async (req, res) => {
  const consultantId = req.params.consultantId;
  const { data: c, error: e1 } = await db
    .from('consultants')
    .select('primary_skill, skills, total_experience_years, preferred_locations')
    .eq('id', consultantId)
    .single();
  if (e1 || !c) throw httpError(404, 'Consultant not found');

  const { data: jobs, error: e2 } = await db
    .from('jobs')
    .select('id, title, required_skills, location, description')
    .eq('is_active', true)
    .limit(40);
  if (e2) throw httpError(500, e2.message);

  const matches = await matchJobsForConsultant(
    {
      skills: skillsForMatching(c),
      experienceYears: c.total_experience_years ?? 0,
      preferredLocations: c.preferred_locations ?? [],
    },
    jobs ?? [],
  );
  res.json(matches);
};

// ---------------------------------------------------------------------------
// Skill gap — deterministic, no AI call.
//
// Returns the intersection + difference of a job's required_skills against a
// consultant's skill list. Fast enough to call on every job-card expansion
// (no Anthropic tokens, no LLM latency). Used by the "you have X / missing
// Y" UI on the job detail card.
//
// Resolution order for the consultant:
//   1. ?consultant_id=… in the query (manager-tier only — admin scoping the
//      gap on someone else's behalf, e.g. a recruiter triaging)
//   2. The calling user's own consultant row (the common case — consultants
//      browsing jobs)
//
// Returns 200 with { have:[], missing:[], coverage:0 } if no consultant row
// is resolvable, so the frontend can render a "complete your profile" hint
// instead of a 404.
// ---------------------------------------------------------------------------
function normalizeSkill(s: string): string {
  return s
    .toLowerCase()
    .replace(/[+]+$/g, '') // "java 8+" → "java 8"
    .replace(/\bversion\s*\d+(\.\d+)*\b/g, '') // "react version 18.2" → "react"
    .replace(/\b\d+(\.\d+)*\b/g, '') // strip bare version numbers
    .replace(/[^a-z0-9\s#./-]/g, '') // keep tech chars: c#, .net, react-router, etc.
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match if either side is a substring (or token-set superset) of the other
 *  after normalization. "react" matches "React 18+"; "aws" matches "AWS S3".
 *  Conservative — false positives just inflate "have"; we'd rather over-credit
 *  the candidate than under-credit them. */
function skillsMatch(consultantSkill: string, jobSkill: string): boolean {
  const a = normalizeSkill(consultantSkill);
  const b = normalizeSkill(jobSkill);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Token-set match: split on space, see if all tokens of the shorter side
  // appear somewhere in the longer side. Handles "spring boot" / "Java
  // Spring Boot framework".
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.length > 0 && short.every((t) => long.includes(t));
}

export const skillGap: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');

  // Resolve the consultant row to compare against.
  let consultant: { id: string; primary_skill: string | null; skills: string[] | null } | null =
    null;
  const explicitId = (req.query.consultant_id as string | undefined)?.trim();
  if (explicitId) {
    const role = req.user.role;
    const isManagerTier = [
      'SUPER_ADMIN',
      'CEO',
      'CTO',
      'DIRECTOR',
      'MANAGER',
      'RECRUITER',
    ].includes(role);
    if (!isManagerTier) throw httpError(403, 'Only managers can request another consultant gap');
    const { data } = await db
      .from('consultants')
      .select('id, primary_skill, skills')
      .eq('id', explicitId)
      .maybeSingle();
    consultant = data;
  } else {
    const me = await getConsultantForUser(req.user.id);
    if (me) {
      const { data } = await db
        .from('consultants')
        .select('id, primary_skill, skills')
        .eq('id', me.id)
        .maybeSingle();
      consultant = data;
    }
  }

  const { data: job, error } = await db
    .from('jobs')
    .select('id, title, required_skills, requirements, match_score')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error || !job) throw httpError(404, 'Job not found');

  const jobReqSkills: string[] = (() => {
    const fromReq = (job.requirements as { required_skills?: string[] } | null)?.required_skills;
    if (Array.isArray(fromReq) && fromReq.length > 0) return fromReq;
    if (Array.isArray(job.required_skills) && job.required_skills.length > 0)
      return job.required_skills;
    return [];
  })();

  // If we couldn't resolve a consultant, return the empty-but-valid shape so
  // the frontend can render "complete your profile" rather than a 404.
  if (!consultant) {
    res.json({
      consultant_resolved: false,
      have: [],
      missing: jobReqSkills,
      coverage: 0,
      match_score: typeof job.match_score === 'number' ? job.match_score : null,
    });
    return;
  }

  const consultantSkills = skillsForMatching(consultant);
  const have: string[] = [];
  const missing: string[] = [];
  for (const js of jobReqSkills) {
    if (consultantSkills.some((cs) => skillsMatch(cs, js))) {
      have.push(js);
    } else {
      missing.push(js);
    }
  }
  const coverage =
    jobReqSkills.length > 0 ? Math.round((have.length / jobReqSkills.length) * 100) : 0;

  res.json({
    consultant_resolved: true,
    consultant_id: consultant.id,
    have,
    missing,
    coverage,
    match_score: typeof job.match_score === 'number' ? job.match_score : null,
  });
};
