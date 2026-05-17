/**
 * Daily match digest — for each ACTIVE consultant, score the last 24 hours of
 * job postings against their profile and email them their top N matches.
 *
 * Wired into the scheduler at backend/src/jobs/daily-digest.job.ts. Gated by
 * the `daily_digest` feature flag, so the scheduler tick is a cheap no-op
 * when an operator pauses the digest.
 *
 * Cost control:
 *   - One Anthropic call per consultant (matchJobsForConsultant batches all
 *     candidate jobs in a single prompt — same cost shape as the existing
 *     auto-match-on-sync pipeline).
 *   - Candidate jobs are capped at MAX_JOBS_PER_DIGEST before the AI call so
 *     a giant 24h window doesn't blow the per-prompt token budget.
 *   - Pre-filter by keyword overlap on consultant.skills × job.required_skills
 *     to drop obviously-unrelated rows before the AI sees them. Cheap, no
 *     external call.
 */

import { db } from '../config/db';
import { logger } from '../config/logger';
import { matchJobsForConsultant } from './ai.service';
import { sendDailyMatchDigest, type DigestMatch } from './brevo.service';
import { audit } from './audit.service';

// Tunables. Sensible defaults — override via env if needed.
const WINDOW_HOURS = Number(process.env.DAILY_DIGEST_WINDOW_HOURS ?? 24);
const MAX_JOBS_PER_DIGEST = Number(process.env.DAILY_DIGEST_MAX_CANDIDATES ?? 60);
const TOP_N = Number(process.env.DAILY_DIGEST_TOP_N ?? 5);
const MIN_SCORE = Number(process.env.DAILY_DIGEST_MIN_SCORE ?? 60);

interface ConsultantRow {
  id: string;
  user_id: string | null;
  primary_skill: string | null;
  skills: string[] | null;
  total_experience_years: number | null;
  preferred_locations: string[] | null;
}

interface JobCandidate {
  id: string;
  title: string;
  company_name: string | null;
  location: string | null;
  description: string | null;
  required_skills: string[] | null;
  source: string | null;
}

export interface DigestReport {
  consultants_scanned: number;
  digests_sent: number;
  digests_skipped_no_match: number;
  digests_skipped_no_email: number;
  errors: number;
  window_hours: number;
}

function splitSkillsString(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cheap pre-filter so we don't blow Anthropic spend on obviously-unrelated jobs. */
function plausibleJobs(consultantSkills: string[], jobs: JobCandidate[]): JobCandidate[] {
  if (consultantSkills.length === 0) return jobs.slice(0, MAX_JOBS_PER_DIGEST);
  const lcSkills = consultantSkills.map((s) => s.toLowerCase());
  const scored = jobs.map((j) => {
    const haystack = (
      (j.title ?? '') +
      ' ' +
      (j.required_skills ?? []).join(' ') +
      ' ' +
      (j.description ?? '').slice(0, 500)
    ).toLowerCase();
    const overlap = lcSkills.filter((s) => haystack.includes(s)).length;
    return { j, overlap };
  });
  scored.sort((a, b) => b.overlap - a.overlap);
  return scored
    .filter((s) => s.overlap > 0) // require at least one skill keyword hit
    .slice(0, MAX_JOBS_PER_DIGEST)
    .map((s) => s.j);
}

export async function runDailyDigest(): Promise<DigestReport> {
  const report: DigestReport = {
    consultants_scanned: 0,
    digests_sent: 0,
    digests_skipped_no_match: 0,
    digests_skipped_no_email: 0,
    errors: 0,
    window_hours: WINDOW_HOURS,
  };

  // 1. Window of jobs to consider. created_at is when the row landed in our
  //    DB — exactly the "fresh today" semantics we want for the digest.
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data: jobsData, error: jobsErr } = await db
    .from('jobs')
    .select('id, title, company_name, location, description, required_skills, source')
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (jobsErr) {
    logger.error({ err: jobsErr }, 'daily-digest: failed to load fresh jobs');
    throw new Error(`daily-digest: ${jobsErr.message}`);
  }
  const jobs = (jobsData ?? []) as JobCandidate[];
  if (jobs.length === 0) {
    logger.info({ window_hours: WINDOW_HOURS }, 'daily-digest: no fresh jobs — skipping run');
    return report;
  }

  // 2. Every ACTIVE consultant with at least one skill or a primary_skill.
  const { data: consultants, error: cErr } = await db
    .from('consultants')
    .select('id, user_id, primary_skill, skills, total_experience_years, preferred_locations')
    .eq('marketing_status', 'ACTIVE');
  if (cErr) {
    logger.error({ err: cErr }, 'daily-digest: failed to load consultants');
    throw new Error(`daily-digest: ${cErr.message}`);
  }
  const consultantRows = (consultants ?? []) as ConsultantRow[];
  if (consultantRows.length === 0) {
    logger.info('daily-digest: no ACTIVE consultants — skipping run');
    return report;
  }

  // 3. Fetch emails + names in one round-trip.
  const userIds = consultantRows.map((c) => c.user_id).filter(Boolean) as string[];
  const usersById = new Map<string, { email: string; full_name: string | null }>();
  if (userIds.length > 0) {
    const { data: users } = await db.from('users').select('id, email, full_name').in('id', userIds);
    for (const u of (users ?? []) as Array<{
      id: string;
      email: string;
      full_name: string | null;
    }>) {
      usersById.set(u.id, { email: u.email, full_name: u.full_name });
    }
  }

  // 4. Per-consultant: pre-filter → AI score → send Brevo email if any
  //    match clears the floor.
  for (const c of consultantRows) {
    report.consultants_scanned++;
    if (!c.user_id) continue;
    const u = usersById.get(c.user_id);
    if (!u?.email) {
      report.digests_skipped_no_email++;
      continue;
    }

    try {
      const skills =
        Array.isArray(c.skills) && c.skills.length > 0
          ? c.skills
          : splitSkillsString(c.primary_skill);
      const candidates = plausibleJobs(skills, jobs);
      if (candidates.length === 0) {
        report.digests_skipped_no_match++;
        continue;
      }

      // Same Anthropic shape used by the on-sync auto-match — one batched
      // call per consultant. Cost: ~1-3 cents on Haiku.
      const matches = await matchJobsForConsultant(
        {
          skills,
          experienceYears: Number(c.total_experience_years ?? 0),
          preferredLocations: c.preferred_locations ?? [],
        },
        candidates.map((j) => ({
          id: j.id,
          title: j.title,
          required_skills: j.required_skills ?? [],
          location: j.location ?? '',
          description: (j.description ?? '').slice(0, 1500),
        })),
      );

      const top = matches
        .filter((m) => m.match_score >= MIN_SCORE)
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, TOP_N);
      if (top.length === 0) {
        report.digests_skipped_no_match++;
        continue;
      }

      const candidatesById = new Map(candidates.map((j) => [j.id, j]));
      const payload: DigestMatch[] = top.map((m) => {
        const j = candidatesById.get(m.job_id);
        return {
          jobId: m.job_id,
          title: j?.title ?? 'Untitled role',
          company: j?.company_name ?? 'Unknown',
          location: j?.location ?? undefined,
          source: j?.source ?? undefined,
          matchScore: m.match_score,
          reason: (m.reasons ?? []).slice(0, 2).join(' · ') || undefined,
        };
      });

      await sendDailyMatchDigest({
        to: { email: u.email, name: u.full_name ?? undefined },
        matches: payload,
        windowHours: WINDOW_HOURS,
      });
      report.digests_sent++;
      audit({
        action: 'daily_digest_sent',
        user_id: c.user_id,
        email: u.email,
        metadata: { count: payload.length, consultant_id: c.id, window_hours: WINDOW_HOURS },
      });
    } catch (err) {
      // One consultant failing must not abort the whole run.
      report.errors++;
      logger.error({ err, consultant_id: c.id }, 'daily-digest: per-consultant pipeline failed');
    }
  }

  return report;
}
