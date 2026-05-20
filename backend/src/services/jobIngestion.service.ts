import axios from 'axios';
import { db } from '../config/db';
import { logger } from '../config/logger';
import { matchJobsForConsultant } from './ai.service';
import { loadFlags } from '../controllers/featureFlags.controller';
import { mockEnabled, mockAdzuna, mockJSearch, mockLinkedIn } from './jobIngestionMocks';
import { parseJobsFromHtml, parseLinkedInGuestCards } from './jobScrape';

// ---------------------------------------------------------------------------
// Driver self-healing — auto-deactivate misbehaving source_companies rows.
//
// Three rules:
//   1. Permanent failures (404, board moved off ATS): deactivate after
//      CONSECUTIVE_FAILURES_BEFORE_DEACTIVATE consecutive failures (default 3).
//      Three strikes lets a flaky upstream recover before we give up.
//   2. Quota / billing failures: deactivate IMMEDIATELY. The quota will not
//      reset by re-trying every 6h — only ops adding a key or upgrading the
//      plan unblocks them, and we save the wasted attempts in the meantime.
//   3. Successful syncs reset consecutive_failures to 0.
//
// Why a counter instead of just "deactivate on any 404": APIs occasionally
// return 404 mid-traffic, especially RapidAPI. Don't kill the row on the
// first flake — give it three chances over 18h (at 6h intervals) before
// flipping the flag.
// ---------------------------------------------------------------------------

const CONSECUTIVE_FAILURES_BEFORE_DEACTIVATE = Math.max(
  1,
  Number(process.env.SOURCE_AUTODEACTIVATE_AFTER ?? 3),
);

/** Returns a human-readable reason if the error message indicates a permanent
 *  problem (quota, billing, auth, 404 on first try, etc) that warrants
 *  immediate deactivation. Returns null if the error is transient. */
function permanentFailureReason(errorMessage: string): string | null {
  const m = errorMessage.toLowerCase();
  // RapidAPI quota / billing
  if (m.includes('exceeded the monthly quota') || m.includes('exceeded the daily quota')) {
    return 'Monthly/daily API quota exhausted';
  }
  if (m.includes('not subscribed') || m.includes('your plan')) {
    return 'Plan limit / not subscribed';
  }
  // Auth failures — usually a key was rotated and not updated
  if (m.includes('401') || m.includes('unauthorized') || m.includes('invalid api key')) {
    return 'API key rejected (401)';
  }
  if (m.includes('403') || m.includes('forbidden')) {
    return 'Access forbidden (403)';
  }
  // Missing env-key error from a driver
  if (m.includes('not set in backend/.env') || m.includes('must be set in backend/.env')) {
    return 'Required environment variable not set';
  }
  return null;
}

async function recordSyncSuccess(sourceCompanyId: string, upserted: number): Promise<void> {
  await db
    .from('source_companies')
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_jobs_count: upserted,
      last_sync_error: null,
      consecutive_failures: 0,
    })
    .eq('id', sourceCompanyId);
}

async function recordSyncFailure(sourceCompanyId: string, errorMessage: string): Promise<void> {
  // Read the row so we can decide whether this strike crosses the threshold.
  // One extra query per failure is fine — failures are the rare path.
  const { data: current } = await db
    .from('source_companies')
    .select('consecutive_failures, source, slug')
    .eq('id', sourceCompanyId)
    .maybeSingle();
  const nextCount = (current?.consecutive_failures ?? 0) + 1;
  const permanent = permanentFailureReason(errorMessage);
  const shouldDeactivate = !!permanent || nextCount >= CONSECUTIVE_FAILURES_BEFORE_DEACTIVATE;

  const patch: Record<string, unknown> = {
    last_synced_at: new Date().toISOString(),
    last_sync_error: errorMessage.slice(0, 1000),
    consecutive_failures: nextCount,
  };
  if (shouldDeactivate) {
    patch.is_active = false;
    patch.auto_deactivated_at = new Date().toISOString();
    patch.auto_deactivated_reason =
      permanent ?? `Auto-deactivated after ${nextCount} consecutive failures`;
    logger.warn(
      {
        source: current?.source,
        slug: current?.slug ?? null,
        consecutive_failures: nextCount,
        reason: patch.auto_deactivated_reason,
      },
      'source-companies: row auto-deactivated',
    );
  }
  await db.from('source_companies').update(patch).eq('id', sourceCompanyId);
}

/**
 * Pluggable real-time job ingestion. Each driver hits a legitimate public API
 * (no scraping), returns jobs in a normalized shape, and the orchestrator
 * upserts them into public.jobs using (source, external_id) as the dedup key.
 */

export type Source =
  | 'remoteok'
  | 'greenhouse'
  | 'lever'
  | 'adzuna'
  | 'remotive'
  | 'arbeitnow'
  | 'jsearch'
  | 'ashby'
  | 'jooble'
  | 'usajobs'
  | 'serpapi'
  | 'searchapi'
  | 'linkedin'
  | 'monster'
  | 'scraper'
  | 'manual';

export interface NormalizedJob {
  source: Source;
  external_id: string; // unique within the source
  title: string;
  company_name: string;
  description?: string | null; // HTML or plain text
  location?: string | null;
  remote?: boolean;
  job_type?: string | null; // FTE | C2C | W2 | 1099
  level?: string | null;
  required_skills?: string[];
  rate_min?: number | null;
  rate_max?: number | null;
  apply_url: string;
  posted_at?: string | null; // ISO
  // The user-facing board the listing was published on. Aggregators like
  // JSearch carry this so we can show "LinkedIn" / "Dice" / "Monster" /
  // "CareerBuilder" instead of just "JSearch".
  publisher?: string | null;
}

interface DriverCtx {
  /** For per-company drivers (Greenhouse/Lever) — null otherwise. */
  slug: string | null;
  display_name?: string | null;
}

const UA = 'HireOrbitAI/1.0 (+ingestion bot)';

// ---------------------------------------------------------------------------
// RemoteOK
// ---------------------------------------------------------------------------
async function fetchRemoteOK(): Promise<NormalizedJob[]> {
  const { data } = await axios.get('https://remoteok.com/api', {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });
  // First element is a legal disclaimer object — filter to entries with an id.
  const rows = Array.isArray(data) ? data.filter((r: any) => r?.id) : [];
  return rows.slice(0, 100).map((r: any): NormalizedJob => {
    const minK = nonZero(r.salary_min);
    const maxK = nonZero(r.salary_max);
    return {
      source: 'remoteok',
      external_id: String(r.id),
      title: String(r.position ?? r.title ?? 'Unknown title'),
      company_name: String(r.company ?? 'Unknown'),
      description: stripHtml(r.description),
      location: r.location ?? 'Remote',
      remote: true,
      job_type: 'FTE',
      level: null,
      required_skills: cleanSkills(r.tags),
      rate_min: minK !== null ? Math.round(minK / 2000) : null,
      rate_max: maxK !== null ? Math.round(maxK / 2000) : null,
      apply_url: safeApplyUrl(r.url ?? r.apply_url, {
        title: String(r.position ?? r.title ?? ''),
        company: String(r.company ?? ''),
        sourceUrl: `https://remoteok.com/remote-jobs/${r.id}`,
      }),
      posted_at: r.date ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Greenhouse (per-company)
// ---------------------------------------------------------------------------
async function fetchGreenhouse(slug: string): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
  const jobs = (data?.jobs ?? []) as any[];
  return jobs.map(
    (j): NormalizedJob => ({
      source: 'greenhouse',
      external_id: String(j.id),
      title: String(j.title),
      company_name: prettyCompanyName(data?.meta?.company_name, slug),
      description: stripHtml(j.content),
      location: j.location?.name ?? null,
      remote: /remote/i.test(j.location?.name ?? ''),
      job_type: 'FTE',
      level: null,
      required_skills: [],
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(j.absolute_url, {
        title: String(j.title ?? ''),
        company: prettyCompanyName(data?.meta?.company_name, slug),
        sourceUrl: `https://boards.greenhouse.io/${slug}/jobs/${j.id}`,
      }),
      posted_at: j.updated_at ?? j.created_at ?? null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Lever (per-company)
// ---------------------------------------------------------------------------
async function fetchLever(slug: string): Promise<NormalizedJob[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
  const jobs = (Array.isArray(data) ? data : []) as any[];
  return jobs.map(
    (j): NormalizedJob => ({
      source: 'lever',
      external_id: String(j.id),
      title: String(j.text),
      company_name: prettyCompanyName(null, slug),
      description: stripHtml(j.description),
      location: j.categories?.location ?? null,
      remote: /remote/i.test(j.categories?.location ?? ''),
      job_type: mapLeverCommitment(j.categories?.commitment),
      level: null,
      required_skills: Array.isArray(j.categories?.team) ? [j.categories.team] : [],
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(j.hostedUrl ?? j.applyUrl, {
        title: String(j.text ?? ''),
        company: prettyCompanyName(null, slug),
        sourceUrl: `https://jobs.lever.co/${slug}/${j.id}`,
      }),
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Ashby (per-company public board)
// ---------------------------------------------------------------------------
async function fetchAshby(slug: string): Promise<NormalizedJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
  const jobs = (data?.jobs ?? []) as any[];
  return jobs.map(
    (j): NormalizedJob => ({
      source: 'ashby',
      external_id: String(j.id),
      title: String(j.title),
      company_name: prettyCompanyName(data?.organizationName, slug),
      description: stripHtml(j.descriptionHtml ?? j.descriptionPlain ?? null),
      location: j.location ?? j.locationName ?? null,
      remote: !!j.isRemote || /remote/i.test(String(j.location ?? '')),
      job_type: mapAshbyEmployment(j.employmentType),
      level: null,
      required_skills: [],
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(j.applyUrl ?? j.jobUrl, {
        title: String(j.title ?? ''),
        company: prettyCompanyName(data?.organizationName, slug),
        sourceUrl: `https://jobs.ashbyhq.com/${slug}/${j.id}`,
      }),
      posted_at: j.publishedAt ?? j.updatedAt ?? null,
    }),
  );
}

function mapAshbyEmployment(t?: string | null): string {
  if (!t) return 'FTE';
  const u = t.toLowerCase();
  if (u.includes('full')) return 'FTE';
  if (u.includes('contract')) return 'Contract';
  if (u.includes('part')) return 'Part-time';
  if (u.includes('intern')) return 'Internship';
  return 'FTE';
}

function mapLeverCommitment(c?: string | null): string {
  if (!c) return 'FTE';
  if (/full/i.test(c)) return 'FTE';
  if (/contract/i.test(c)) return 'C2C';
  return c;
}

// ---------------------------------------------------------------------------
// Remotive — public remote-tech feed
// ---------------------------------------------------------------------------
async function fetchRemotive(): Promise<NormalizedJob[]> {
  const { data } = await axios.get('https://remotive.com/api/remote-jobs', {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });
  const jobs = (data?.jobs ?? []) as any[];
  return jobs.slice(0, 200).map(
    (r): NormalizedJob => ({
      source: 'remotive',
      external_id: String(r.id),
      title: String(r.title ?? 'Unknown title'),
      company_name: String(r.company_name ?? 'Unknown'),
      description: stripHtml(r.description),
      location: r.candidate_required_location ?? 'Remote',
      remote: true,
      job_type: mapRemotiveType(r.job_type),
      level: null,
      required_skills: cleanSkills(r.tags),
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(r.url, {
        title: String(r.title ?? ''),
        company: String(r.company_name ?? ''),
      }),
      posted_at: r.publication_date ?? null,
    }),
  );
}

function mapRemotiveType(t?: string | null): string {
  if (!t) return 'FTE';
  if (/full[\s_-]?time/i.test(t)) return 'FTE';
  if (/contract/i.test(t)) return 'Contract';
  if (/part[\s_-]?time/i.test(t)) return 'Part-time';
  return 'FTE';
}

// ---------------------------------------------------------------------------
// Arbeitnow — public job-board API, mostly European tech roles
// ---------------------------------------------------------------------------
async function fetchArbeitnow(): Promise<NormalizedJob[]> {
  const { data } = await axios.get('https://www.arbeitnow.com/api/job-board-api', {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });
  const jobs = (data?.data ?? []) as any[];
  return jobs.map(
    (r): NormalizedJob => ({
      source: 'arbeitnow',
      external_id: String(r.slug ?? r.url),
      title: String(r.title ?? 'Unknown title'),
      company_name: String(r.company_name ?? 'Unknown'),
      description: stripHtml(r.description),
      location: r.location ?? null,
      remote: !!r.remote,
      job_type:
        Array.isArray(r.job_types) && r.job_types.length > 0
          ? prettyJobType(r.job_types[0])
          : 'FTE',
      level: null,
      required_skills: cleanSkills(r.tags),
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(r.url, {
        title: String(r.title ?? ''),
        company: String(r.company_name ?? ''),
      }),
      posted_at: r.created_at ? new Date(r.created_at * 1000).toISOString() : null,
    }),
  );
}

function prettyJobType(t: string): string {
  const x = t.toLowerCase();
  if (x.includes('full')) return 'FTE';
  if (x.includes('contract')) return 'Contract';
  if (x.includes('part')) return 'Part-time';
  if (x.includes('intern')) return 'Internship';
  return t;
}

// ---------------------------------------------------------------------------
// Adzuna (requires API key — covers ~15M aggregated listings across boards)
// ---------------------------------------------------------------------------
async function fetchAdzuna(slug: string | null): Promise<NormalizedJob[]> {
  // Test mode — synthetic data, no HTTP call, no API quota burn.
  // Flip JOB_SOURCES_MOCK=true in backend/.env to enable.
  if (mockEnabled()) {
    logger.info({ source: 'adzuna', slug }, 'jobIngestion: mock mode — returning synthetic jobs');
    return mockAdzuna(slug);
  }
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const country = process.env.ADZUNA_COUNTRY ?? 'us';
  if (!appId || !appKey) return []; // opt-in only

  // Defaults: tech jobs, recent, full-time. Tweak via env if needed.
  const params = {
    app_id: appId,
    app_key: appKey,
    results_per_page: 50,
    what: process.env.ADZUNA_WHAT ?? 'software engineer',
    'content-type': 'application/json',
  };
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1`;
  const { data } = await axios.get(url, { params, headers: { 'User-Agent': UA }, timeout: 20000 });
  const results = (data?.results ?? []) as any[];
  return results.map((r): NormalizedJob => {
    const minSal = nonZero(r.salary_min);
    const maxSal = nonZero(r.salary_max);
    return {
      source: 'adzuna',
      external_id: String(r.id),
      title: String(r.title),
      company_name: r.company?.display_name ?? 'Unknown',
      description: stripHtml(r.description),
      location: r.location?.display_name ?? null,
      remote: /remote/i.test(r.location?.display_name ?? ''),
      job_type: r.contract_time === 'part_time' ? 'Part-time' : 'FTE',
      level: null,
      required_skills: [],
      rate_min: minSal !== null ? Math.round(minSal / 2000) : null,
      rate_max: maxSal !== null ? Math.round(maxSal / 2000) : null,
      apply_url: safeApplyUrl(r.redirect_url, {
        title: String(r.title ?? ''),
        company: r.company?.display_name ?? 'Unknown',
      }),
      posted_at: r.created ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// JSearch via RapidAPI — legal aggregator over Indeed / LinkedIn / Glassdoor /
// ZipRecruiter / Monster / Google for Jobs etc. Requires JSEARCH_API_KEY.
//
// Optional env vars:
//   JSEARCH_COUNTRY=us         (default us)
//   JSEARCH_QUERIES=q1|q2|q3   (default: a generic tech-jobs query)
//
// Each query gets one paginated fetch (50 jobs/page max on Basic plan).
// ---------------------------------------------------------------------------
async function fetchJSearch(slug: string | null): Promise<NormalizedJob[]> {
  // Test mode — see jobIngestionMocks.ts for the short-circuit rationale.
  if (mockEnabled()) {
    logger.info({ source: 'jsearch', slug }, 'jobIngestion: mock mode — returning synthetic jobs');
    return mockJSearch(slug);
  }
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) {
    throw new Error('JSEARCH_API_KEY not set in backend/.env');
  }

  const queriesRaw = slug ?? process.env.JSEARCH_QUERIES ?? 'software engineer';
  const queries = queriesRaw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const country = process.env.JSEARCH_COUNTRY ?? 'us';

  const out: NormalizedJob[] = [];
  const queryErrors: string[] = [];

  for (const query of queries) {
    try {
      const { data } = await axios.get('https://jsearch.p.rapidapi.com/search-v2', {
        params: { query, num_pages: 1, country, date_posted: 'week' },
        headers: {
          'x-rapidapi-host': 'jsearch.p.rapidapi.com',
          'x-rapidapi-key': apiKey,
          'User-Agent': UA,
        },
        timeout: 20000,
        // Don't auto-throw on 4xx so we can surface the actual API error message.
        validateStatus: () => true,
      });
      if (typeof data === 'object' && data && 'message' in data && !data.data) {
        // RapidAPI returns { message: 'You are not subscribed to this API.' } for 403, etc.
        queryErrors.push(`"${query}": ${(data as any).message}`);
        continue;
      }
      const rows = (data?.data ?? []) as any[];
      for (const r of rows) {
        const minSal = nonZero(r.job_min_salary);
        const maxSal = nonZero(r.job_max_salary);
        out.push({
          source: 'jsearch',
          external_id: String(r.job_id),
          title: String(r.job_title ?? 'Unknown title'),
          company_name: String(r.employer_name ?? 'Unknown'),
          description: stripHtml(r.job_description),
          location: [r.job_city, r.job_state, r.job_country].filter(Boolean).join(', ') || null,
          remote: !!r.job_is_remote,
          job_type: mapJSearchEmployment(r.job_employment_type),
          level: null,
          required_skills: extractJSearchSkills(r.job_highlights),
          rate_min: minSal !== null ? Math.round(minSal / 2000) : null,
          rate_max: maxSal !== null ? Math.round(maxSal / 2000) : null,
          apply_url: safeApplyUrl(r.job_apply_link ?? r.job_google_link, {
            title: String(r.job_title ?? ''),
            company: String(r.employer_name ?? ''),
            sourceUrl: r.job_offer_expiration_url ?? r.employer_website ?? null,
          }),
          posted_at: r.job_posted_at_datetime_utc ?? null,
          publisher: normalizePublisher(r.job_publisher ?? r.job_apply_link),
        });
      }
    } catch (e) {
      queryErrors.push(`"${query}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // If every query failed (likely 403 / no subscription / bad key), surface
  // a single unified error so the sync report shows what happened.
  if (out.length === 0 && queryErrors.length > 0) {
    throw new Error(`JSearch: ${queryErrors.join(' | ')}`);
  }

  // De-dupe by external_id (queries can overlap).
  const seen = new Set<string>();
  return out.filter((j) => {
    if (seen.has(j.external_id)) return false;
    seen.add(j.external_id);
    return true;
  });
}

function mapJSearchEmployment(t?: string | null): string {
  if (!t) return 'FTE';
  const u = t.toUpperCase();
  if (u.includes('FULLTIME') || u === 'FULL_TIME' || u === 'FULL-TIME') return 'FTE';
  if (u.includes('CONTRACT')) return 'Contract';
  if (u.includes('PART')) return 'Part-time';
  if (u.includes('INTERN')) return 'Internship';
  return t;
}

// Map raw JSearch `job_publisher` values (and apply-URL hosts when publisher
// is missing) to clean brand names. Centralized so the UI can match exact
// strings like "LinkedIn" / "Dice" / "Monster" / "CareerBuilder".
function normalizePublisher(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  if (s.includes('linkedin')) return 'LinkedIn';
  if (s.includes('dice')) return 'Dice';
  if (s.includes('monster')) return 'Monster';
  if (s.includes('careerbuilder')) return 'CareerBuilder';
  if (s.includes('indeed')) return 'Indeed';
  if (s.includes('glassdoor')) return 'Glassdoor';
  if (s.includes('ziprecruiter') || s.includes('zip recruiter')) return 'ZipRecruiter';
  if (s.includes('snagajob')) return 'Snagajob';
  if (s.includes('simplyhired')) return 'SimplyHired';
  if (s.includes('jobot')) return 'Jobot';
  if (s.includes('lensa')) return 'Lensa';
  if (s.includes('builtin')) return 'BuiltIn';
  if (s.includes('google')) return 'Google for Jobs';
  // Fall back to the raw publisher name when it isn't one of the known boards.
  return /^https?:\/\//i.test(raw) ? null : raw.slice(0, 40);
}

function extractJSearchSkills(highlights: unknown): string[] {
  if (!highlights || typeof highlights !== 'object') return [];
  const h = highlights as Record<string, string[]>;
  const qualifications = h.Qualifications ?? [];
  // Pull capitalized tokens that look like tech / skills.
  const found = new Set<string>();
  for (const line of qualifications) {
    const matches = line.match(/[A-Z][a-zA-Z0-9+#.]{1,24}(?:\.[a-z]+)?/g);
    if (matches)
      for (const m of matches) {
        if (m.length >= 2 && m.length <= 24) found.add(m);
      }
  }
  return Array.from(found).slice(0, 12);
}

// ---------------------------------------------------------------------------
// Jooble — free aggregator (https://jooble.org/api). Uses an API key in the
// URL path. Reasonable substitute for JSearch when you've hit the RapidAPI quota.
// Env: JOOBLE_API_KEY (and optional JOOBLE_QUERIES, JOOBLE_LOCATION).
// ---------------------------------------------------------------------------
async function fetchJooble(slug: string | null): Promise<NormalizedJob[]> {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) throw new Error('JOOBLE_API_KEY not set in backend/.env');

  const queriesRaw = slug ?? process.env.JOOBLE_QUERIES ?? 'software engineer';
  const queries = queriesRaw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const location = process.env.JOOBLE_LOCATION ?? 'United States';
  const out: NormalizedJob[] = [];
  const errs: string[] = [];

  for (const keywords of queries) {
    try {
      const { data } = await axios.post(
        `https://jooble.org/api/${apiKey}`,
        { keywords, location, page: '1', ResultOnPage: '50' },
        { headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, timeout: 20000 },
      );
      for (const r of (data?.jobs ?? []) as any[]) {
        out.push({
          source: 'jooble',
          external_id: String(r.id ?? r.link),
          title: String(r.title ?? 'Unknown title'),
          company_name: String(r.company ?? 'Unknown'),
          description: stripHtml(r.snippet ?? null),
          location: r.location ?? null,
          remote: /remote/i.test(String(r.location ?? '')),
          job_type: r.type ?? 'FTE',
          level: null,
          required_skills: [],
          rate_min: null,
          rate_max: null,
          apply_url: safeApplyUrl(r.link, {
            title: String(r.title ?? ''),
            company: String(r.company ?? ''),
          }),
          posted_at: r.updated ? new Date(r.updated).toISOString() : null,
          publisher: 'Jooble',
        });
      }
    } catch (e) {
      errs.push(`"${keywords}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (out.length === 0 && errs.length > 0) throw new Error(`Jooble: ${errs.join(' | ')}`);
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// USAJobs (public) — data.usajobs.gov.
// Env: USAJOBS_API_KEY + USAJOBS_USER_AGENT (your email per their ToS).
// ---------------------------------------------------------------------------
async function fetchUSAJobs(slug: string | null): Promise<NormalizedJob[]> {
  const apiKey = process.env.USAJOBS_API_KEY;
  const agent = process.env.USAJOBS_USER_AGENT;
  if (!apiKey || !agent)
    throw new Error('USAJOBS_API_KEY and USAJOBS_USER_AGENT must be set in backend/.env');

  const keyword = slug ?? process.env.USAJOBS_KEYWORD ?? 'software engineer';
  const { data } = await axios.get('https://data.usajobs.gov/api/search', {
    params: { Keyword: keyword, ResultsPerPage: 100 },
    headers: {
      Host: 'data.usajobs.gov',
      'User-Agent': agent,
      'Authorization-Key': apiKey,
      Accept: 'application/json',
    },
    timeout: 20000,
  });
  const items = data?.SearchResult?.SearchResultItems ?? [];
  return items.map((it: any): NormalizedJob => {
    const j = it.MatchedObjectDescriptor ?? {};
    const remoteHint = /telework|remote/i.test(JSON.stringify(j.UserArea ?? {}));
    return {
      source: 'usajobs',
      external_id: String(j.PositionID ?? it.MatchedObjectId),
      title: String(j.PositionTitle ?? 'Federal role'),
      company_name: String(j.OrganizationName ?? 'US Government'),
      description: stripHtml(j.QualificationSummary ?? j.UserArea?.Details?.JobSummary ?? null),
      location: j.PositionLocationDisplay ?? null,
      remote: remoteHint,
      job_type: 'FTE',
      level: null,
      required_skills: [],
      rate_min:
        typeof j.PositionRemuneration?.[0]?.MinimumRange === 'string'
          ? Math.round(Number(j.PositionRemuneration[0].MinimumRange) / 2000) || null
          : null,
      rate_max:
        typeof j.PositionRemuneration?.[0]?.MaximumRange === 'string'
          ? Math.round(Number(j.PositionRemuneration[0].MaximumRange) / 2000) || null
          : null,
      apply_url: safeApplyUrl(j.PositionURI ?? j.ApplyURI?.[0], {
        title: String(j.PositionTitle ?? ''),
        company: String(j.OrganizationName ?? ''),
      }),
      posted_at: j.PublicationStartDate ?? null,
      publisher: 'USAJobs',
    };
  });
}

// ---------------------------------------------------------------------------
// SerpAPI Google for Jobs (paid). Same shape as JSearch — pulls the Google
// Jobs SERP, which aggregates ~every board. Env: SERPAPI_API_KEY.
// ---------------------------------------------------------------------------
async function fetchSerpApi(slug: string | null): Promise<NormalizedJob[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error('SERPAPI_API_KEY not set in backend/.env');

  const q = slug ?? process.env.SERPAPI_QUERY ?? 'software engineer in united states';
  const { data } = await axios.get('https://serpapi.com/search.json', {
    params: { engine: 'google_jobs', q, api_key: apiKey },
    timeout: 20000,
  });
  const rows = data?.jobs_results ?? [];
  return rows.map(
    (r: any): NormalizedJob => ({
      source: 'serpapi',
      external_id: String(
        r.job_id ?? r.job_highlights?.[0]?.title ?? r.title + '|' + (r.company_name ?? ''),
      ),
      title: String(r.title ?? 'Unknown title'),
      company_name: String(r.company_name ?? 'Unknown'),
      description: stripHtml(r.description ?? null),
      location: r.location ?? null,
      remote: !!r.detected_extensions?.work_from_home,
      job_type: r.detected_extensions?.schedule_type ?? 'FTE',
      level: null,
      required_skills: [],
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(r.apply_options?.[0]?.link ?? r.related_links?.[0]?.link, {
        title: String(r.title ?? ''),
        company: String(r.company_name ?? ''),
      }),
      posted_at: r.detected_extensions?.posted_at ?? null,
      publisher: normalizePublisher(r.apply_options?.[0]?.title ?? r.via ?? null),
    }),
  );
}

// ---------------------------------------------------------------------------
// SearchApi.io Google Jobs — competitor to SerpAPI, also indexes the Google
// for Jobs SERP (which aggregates LinkedIn / Indeed / Dice / Monster / etc.).
// Free tier ships 100 credits/month. Env: SEARCHAPI_API_KEY, SEARCHAPI_QUERY.
//
// Docs: https://www.searchapi.io/docs/google-jobs
// ---------------------------------------------------------------------------
async function fetchSearchApi(slug: string | null): Promise<NormalizedJob[]> {
  const apiKey = process.env.SEARCHAPI_API_KEY;
  if (!apiKey) throw new Error('SEARCHAPI_API_KEY not set in backend/.env');

  const q = slug ?? process.env.SEARCHAPI_QUERY ?? 'software engineer in united states';
  const { data } = await axios.get('https://www.searchapi.io/api/v1/search', {
    params: { engine: 'google_jobs', q, api_key: apiKey },
    headers: { 'User-Agent': UA },
    timeout: 20000,
    // Surface SearchApi.io error bodies (e.g. quota exceeded) instead of throwing.
    validateStatus: () => true,
  });
  if (data && typeof data === 'object' && (data as any).error) {
    throw new Error(`SearchApi: ${(data as any).error}`);
  }
  const rows = (data?.jobs ?? []) as any[];
  return rows.map((r): NormalizedJob => {
    const apply = r.apply_link ?? r.apply_links?.[0]?.link ?? r.share_link ?? null;
    return {
      source: 'searchapi',
      external_id: String(r.job_id ?? `${r.title}|${r.company_name ?? ''}|${r.location ?? ''}`),
      title: String(r.title ?? 'Unknown title'),
      company_name: String(r.company_name ?? 'Unknown'),
      description: stripHtml(r.description ?? null),
      location: r.location ?? null,
      remote: !!r.detected_extensions?.work_from_home || /remote/i.test(String(r.location ?? '')),
      job_type: r.detected_extensions?.schedule ?? r.detected_extensions?.schedule_type ?? 'FTE',
      level: null,
      required_skills: [],
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(apply, {
        title: String(r.title ?? ''),
        company: String(r.company_name ?? ''),
      }),
      posted_at: r.detected_extensions?.posted_at ?? null,
      publisher: normalizePublisher(r.apply_links?.[0]?.title ?? r.via ?? null),
    };
  });
}

// ---------------------------------------------------------------------------
// LinkedIn (via Fantastic Jobs "LinkedIn Job Search API" on RapidAPI).
//
// Pulls active LinkedIn postings. The endpoint family (`active-jb-1h`,
// `active-jb-24h`, `active-jb-7d`) controls how fresh the postings are. We
// default to 24h for a good fresh/coverage tradeoff; the slug field on the
// source_companies row controls the title filter (e.g. "Data Engineer").
//
// Reuses RAPIDAPI_KEY → falls back to JSEARCH_API_KEY (same RapidAPI account).
// Env: LINKEDIN_TITLES (pipe-separated), LINKEDIN_LOCATIONS, LINKEDIN_WINDOW.
// ---------------------------------------------------------------------------
async function fetchLinkedIn(slug: string | null): Promise<NormalizedJob[]> {
  // Test mode — see jobIngestionMocks.ts for the short-circuit rationale.
  if (mockEnabled()) {
    logger.info({ source: 'linkedin', slug }, 'jobIngestion: mock mode — returning synthetic jobs');
    return mockLinkedIn(slug);
  }
  // Free, no-API path: scrape LinkedIn's unauthenticated guest job-search
  // endpoint instead of the paid RapidAPI driver. Opt-in via LINKEDIN_FREE=true.
  if (String(process.env.LINKEDIN_FREE ?? '').toLowerCase() === 'true') {
    return fetchLinkedInGuest(slug);
  }
  const apiKey = process.env.RAPIDAPI_KEY ?? process.env.JSEARCH_API_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY (or JSEARCH_API_KEY) not set in backend/.env');

  const titlesRaw =
    slug ?? process.env.LINKEDIN_TITLES ?? 'Software Engineer|Data Engineer|Full Stack Developer';
  const titles = titlesRaw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const location = process.env.LINKEDIN_LOCATIONS ?? 'United States';
  const window = (process.env.LINKEDIN_WINDOW ?? '24h').toLowerCase();
  const endpoint =
    window === '1h' ? 'active-jb-1h' : window === '7d' ? 'active-jb-7d' : 'active-jb-24h';

  const out: NormalizedJob[] = [];
  const errs: string[] = [];

  for (const title of titles) {
    try {
      const { data } = await axios.get(
        `https://linkedin-job-search-api.p.rapidapi.com/${endpoint}`,
        {
          params: {
            offset: 0,
            title_filter: title,
            location_filter: location,
            description_type: 'text',
          },
          headers: {
            'x-rapidapi-host': 'linkedin-job-search-api.p.rapidapi.com',
            'x-rapidapi-key': apiKey,
            'User-Agent': UA,
          },
          timeout: 25000,
          validateStatus: () => true,
        },
      );
      if (typeof data === 'object' && data && 'message' in data && Array.isArray(data) === false) {
        errs.push(`"${title}": ${(data as any).message}`);
        continue;
      }
      const rows = Array.isArray(data) ? data : ((data as any)?.data ?? []);
      for (const r of rows as any[]) {
        const loc =
          r.locations_raw?.[0]?.address?.addressLocality ??
          r.locations_derived?.[0] ??
          r.locations_alt_raw?.[0] ??
          null;
        const region = r.locations_raw?.[0]?.address?.addressRegion;
        const country = r.locations_raw?.[0]?.address?.addressCountry;
        const fullLocation = [loc, region, country].filter(Boolean).join(', ') || null;
        const minSal = nonZero(r.salary_raw?.value?.minValue ?? r.base_salary?.value?.minValue);
        const maxSal = nonZero(r.salary_raw?.value?.maxValue ?? r.base_salary?.value?.maxValue);
        out.push({
          source: 'linkedin',
          external_id: String(r.id ?? r.url),
          title: String(r.title ?? 'Unknown title'),
          company_name: String(r.organization ?? r.organization_name ?? 'Unknown'),
          description: stripHtml(r.description_text ?? r.description ?? null),
          location: fullLocation,
          remote: r.remote_derived === true || /remote/i.test(String(r.location_type ?? '')),
          job_type: mapLinkedInEmployment(r.employment_type),
          level: r.seniority ?? null,
          required_skills: [],
          rate_min: minSal !== null ? Math.round(minSal / 2000) : null,
          rate_max: maxSal !== null ? Math.round(maxSal / 2000) : null,
          apply_url: safeApplyUrl(r.url, {
            title: String(r.title ?? ''),
            company: String(r.organization ?? ''),
          }),
          posted_at: r.date_posted ?? r.date_created ?? null,
          publisher: 'LinkedIn',
        });
      }
    } catch (e) {
      errs.push(`"${title}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (out.length === 0 && errs.length > 0) {
    throw new Error(`LinkedIn: ${errs.join(' | ')}`);
  }
  return dedupe(out);
}

function mapLinkedInEmployment(t: unknown): string {
  if (!t) return 'FTE';
  const raw = Array.isArray(t) ? String(t[0] ?? '') : String(t);
  const u = raw.toLowerCase();
  if (u.includes('full')) return 'FTE';
  if (u.includes('contract')) return 'Contract';
  if (u.includes('part')) return 'Part-time';
  if (u.includes('intern')) return 'Internship';
  return 'FTE';
}

// ---------------------------------------------------------------------------
// Free, no-API scraping config (shared by the LinkedIn guest driver and the
// generic JSON-LD scraper). HTTP-only, sequential, byte-capped, polite delays.
// A browser-like User-Agent is required for the guest endpoints to respond.
// ---------------------------------------------------------------------------
const SCRAPER_UA =
  process.env.SCRAPER_USER_AGENT?.trim() ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SCRAPER_TIMEOUT_MS = Math.max(1000, Number(process.env.SCRAPER_TIMEOUT_MS ?? 15000));
const SCRAPER_DELAY_MS = Math.max(0, Number(process.env.SCRAPER_DELAY_MS ?? 2500));
const SCRAPER_MAX_JOBS = Math.max(1, Number(process.env.SCRAPER_MAX_JOBS ?? 60));
const SCRAPER_MAX_BYTES = Math.max(100_000, Number(process.env.SCRAPER_MAX_BYTES ?? 3_000_000));
const LINKEDIN_MAX_JOBS = Math.max(1, Number(process.env.LINKEDIN_MAX_JOBS ?? 75));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// LinkedIn — FREE guest job-search endpoint (no login, no API key).
//   GET /jobs-guest/jobs/api/seeMoreJobPostings/search
// Returns an HTML fragment of ~25 <li> job cards per `start` page. We page
// through (start += 25) up to LINKEDIN_MAX_JOBS with a polite delay, stop on
// 429 / empty, and parse listing-level fields with regex (low RAM). Full
// descriptions are intentionally NOT fetched (would multiply requests and
// blocking) — the free local parser fills structure later.
// Slug / LINKEDIN_TITLES are pipe-delimited search keywords.
// ---------------------------------------------------------------------------
async function fetchLinkedInGuest(slug: string | null): Promise<NormalizedJob[]> {
  const titlesRaw =
    slug ?? process.env.LINKEDIN_TITLES ?? 'Software Engineer|Data Engineer|Full Stack Developer';
  const titles = titlesRaw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const location = process.env.LINKEDIN_LOCATIONS ?? 'United States';
  const window = (process.env.LINKEDIN_WINDOW ?? '24h').toLowerCase();
  const fTPR = window === '1h' ? 'r3600' : window === '7d' ? 'r604800' : 'r86400';

  const out: NormalizedJob[] = [];
  const base = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

  for (const title of titles) {
    let start = 0;
    // Each page returns up to ~25 cards. Cap total per title slice of the budget.
    while (out.length < LINKEDIN_MAX_JOBS && start < 200) {
      let html = '';
      try {
        const res = await axios.get(base, {
          params: { keywords: title, location, f_TPR: fTPR, start },
          headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html' },
          timeout: SCRAPER_TIMEOUT_MS,
          responseType: 'text',
          maxContentLength: SCRAPER_MAX_BYTES,
          transformResponse: (d) => d,
          validateStatus: (s) => s === 200 || s === 429 || s === 404,
        });
        if (res.status === 429) {
          logger.warn(
            { source: 'linkedin', title, start },
            'linkedin guest: 429 rate-limited — stopping this title',
          );
          break;
        }
        html = typeof res.data === 'string' ? res.data : '';
      } catch (e) {
        logger.warn(
          { source: 'linkedin', title, start, err: e instanceof Error ? e.message : String(e) },
          'linkedin guest: fetch failed',
        );
        break;
      }

      const cards = parseLinkedInGuestCards(html);
      if (cards.length === 0) break; // no parseable cards → done
      out.push(...cards.slice(0, LINKEDIN_MAX_JOBS - out.length));
      start += 25;
      if (SCRAPER_DELAY_MS > 0) await sleep(SCRAPER_DELAY_MS);
    }
  }
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Monster Jobs (via "Monster Jobs API" on RapidAPI).
// POST endpoint that accepts a scraper.filters body and returns up to N rows.
// Same RapidAPI key as JSearch / LinkedIn (one subscription typically covers all).
//
// Slug format: "<keyword>|<location>|<countryCode>"  (location + country
// optional). Examples:
//   "python"
//   "python|Paris|fr_fr"
//   "java|New York|en_us"
// Env: MONSTER_KEYWORDS (pipe-separated fallbacks), MONSTER_LOCATION,
//       MONSTER_COUNTRY_CODE, MONSTER_MAX_ROWS.
// ---------------------------------------------------------------------------
async function fetchMonster(slug: string | null): Promise<NormalizedJob[]> {
  const apiKey = process.env.RAPIDAPI_KEY ?? process.env.JSEARCH_API_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY (or JSEARCH_API_KEY) not set in backend/.env');

  // Parse the slug into (keyword, location, countryCode). If absent, fall back to env.
  let keyword = (process.env.MONSTER_KEYWORDS ?? 'software engineer').split('|')[0]!;
  let location = process.env.MONSTER_LOCATION ?? 'New York';
  let countryCode = process.env.MONSTER_COUNTRY_CODE ?? 'en_us';
  if (slug) {
    const parts = slug
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts[0]) keyword = parts[0];
    if (parts[1]) location = parts[1];
    if (parts[2]) countryCode = parts[2];
  }
  const maxRows = Number(process.env.MONSTER_MAX_ROWS ?? '50') || 50;

  const { data, status } = await axios.post(
    'https://monster-jobs-api.p.rapidapi.com/api/job/wait',
    { scraper: { filters: { keyword, location, countryCode }, maxRows } },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'monster-jobs-api.p.rapidapi.com',
        'x-rapidapi-key': apiKey,
        'User-Agent': UA,
      },
      timeout: 45000,
      validateStatus: () => true,
    },
  );

  if (
    status >= 400 ||
    (data && typeof data === 'object' && 'message' in data && !Array.isArray((data as any).data))
  ) {
    throw new Error(`Monster: ${(data as any)?.message ?? `HTTP ${status}`}`);
  }
  // Be defensive: the API can return either an array, { data: [...] },
  // { jobs: [...] }, or { data: { jobs: [...] } }.
  const rows: any[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.data)
      ? (data as any).data
      : Array.isArray((data as any)?.jobs)
        ? (data as any).jobs
        : Array.isArray((data as any)?.data?.jobs)
          ? (data as any).data.jobs
          : [];

  return rows.map((r): NormalizedJob => {
    const companyName = r.company?.name ?? r.company ?? r.organization ?? 'Unknown';
    const loc = r.location?.city
      ? [r.location.city, r.location.state ?? r.location.region, r.location.country]
          .filter(Boolean)
          .join(', ')
      : (r.location ?? r.jobLocation ?? null);
    const url = r.applyUrl ?? r.url ?? r.jobUrl ?? r.detailsLink ?? null;
    return {
      source: 'monster',
      external_id: String(r.jobId ?? r.id ?? r.uniqueIdentifier ?? url),
      title: String(r.title ?? r.jobTitle ?? 'Unknown title'),
      company_name: String(companyName),
      description: stripHtml(r.description ?? r.summary ?? null),
      location: loc,
      remote: r.remote === true || /remote/i.test(String(loc ?? '')),
      job_type: mapMonsterEmployment(r.employmentType ?? r.jobType),
      level: null,
      required_skills: Array.isArray(r.skills) ? cleanSkills(r.skills) : [],
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(url, {
        title: String(r.title ?? ''),
        company: String(companyName),
      }),
      posted_at: r.postedDate ?? r.datePosted ?? r.posted_at ?? null,
      publisher: 'Monster',
    };
  });
}

function mapMonsterEmployment(t: unknown): string {
  if (!t) return 'FTE';
  const u = String(t).toLowerCase();
  if (u.includes('full')) return 'FTE';
  if (u.includes('contract')) return 'Contract';
  if (u.includes('part')) return 'Part-time';
  if (u.includes('intern')) return 'Internship';
  return 'FTE';
}

function dedupe(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>();
  return jobs.filter((j) => {
    const k = `${j.source}|${j.external_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Generic JSON-LD scraper (Dice / Monster / CareerBuilder / any JobPosting page)
//
// Fetches public search/job pages and extracts schema.org JobPosting JSON-LD
// (then OpenGraph/meta as fallback). HTTP-only, sequential, byte-capped, no
// browser, no API key. A 'scraper' source-row's `slug` is one or more page
// URLs (pipe-delimited). Best-effort: blocked/empty pages are logged, not
// thrown. No login/CAPTCHA bypass.
// ---------------------------------------------------------------------------

async function scrapeOnePage(url: string): Promise<NormalizedJob[]> {
  if (!/^https?:\/\//i.test(url)) return [];
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html' },
      timeout: SCRAPER_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: SCRAPER_MAX_BYTES,
      maxBodyLength: SCRAPER_MAX_BYTES,
      transformResponse: (d) => d,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const jobs = parseJobsFromHtml(typeof res.data === 'string' ? res.data : '', url);
    if (jobs.length === 0) logger.warn({ url }, 'scraper: no JobPosting JSON-LD found');
    return jobs;
  } catch (e) {
    logger.warn(
      { url, err: e instanceof Error ? e.message : String(e) },
      'scraper: fetch/parse failed (likely blocked)',
    );
    return [];
  }
}

async function scrapeJsonLd(slug: string | null): Promise<NormalizedJob[]> {
  if (!slug) return [];
  const urls = slug
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: NormalizedJob[] = [];
  for (const url of urls) {
    if (out.length >= SCRAPER_MAX_JOBS) break;
    const jobs = await scrapeOnePage(url);
    out.push(...jobs.slice(0, SCRAPER_MAX_JOBS - out.length));
    if (SCRAPER_DELAY_MS > 0) await sleep(SCRAPER_DELAY_MS);
  }
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const DRIVERS: Record<Source, (ctx: DriverCtx) => Promise<NormalizedJob[]>> = {
  remoteok: () => fetchRemoteOK(),
  greenhouse: ({ slug }) => (slug ? fetchGreenhouse(slug) : Promise.resolve([])),
  lever: ({ slug }) => (slug ? fetchLever(slug) : Promise.resolve([])),
  adzuna: ({ slug }) => fetchAdzuna(slug),
  remotive: () => fetchRemotive(),
  arbeitnow: () => fetchArbeitnow(),
  jsearch: ({ slug }) => fetchJSearch(slug),
  ashby: ({ slug }) => (slug ? fetchAshby(slug) : Promise.resolve([])),
  jooble: ({ slug }) => fetchJooble(slug),
  usajobs: ({ slug }) => fetchUSAJobs(slug),
  serpapi: ({ slug }) => fetchSerpApi(slug),
  searchapi: ({ slug }) => fetchSearchApi(slug),
  linkedin: ({ slug }) => fetchLinkedIn(slug),
  monster: ({ slug }) => fetchMonster(slug),
  scraper: ({ slug }) => scrapeJsonLd(slug),
  // 'manual' isn't crawled — rows arrive via POST /api/jobs/import-url.
  manual: () => Promise.resolve([]),
};

export interface SyncReport {
  source: Source;
  slug: string | null;
  jobs_pulled: number;
  jobs_upserted: number;
  new_job_ids?: string[];
  error?: string;
}

export interface AutoMatchReport {
  consultants_scanned: number;
  matches_evaluated: number;
  notifications_sent: number;
  threshold: number;
  error?: string;
}

export interface FullSyncResult {
  reports: SyncReport[];
  auto_match: AutoMatchReport | null;
}

/**
 * Run the full ingestion: every active row in source_companies fires its driver
 * in parallel, results are upserted, source_companies is updated with stats.
 * After all sources finish, run the auto-match-and-notify pipeline against
 * every newly-inserted job.
 */
export async function runSync(): Promise<FullSyncResult> {
  const { data: sources, error } = await db
    .from('source_companies')
    .select('*')
    .eq('is_active', true);
  if (error) throw new Error(`Could not load sources: ${error.message}`);
  if (!sources || sources.length === 0) return { reports: [], auto_match: null };

  const reports = await Promise.all(
    sources.map(async (s: any): Promise<SyncReport> => {
      const ctx: DriverCtx = { slug: s.slug ?? null, display_name: s.display_name };
      try {
        const driver = DRIVERS[s.source as Source];
        if (!driver) throw new Error(`Unknown source: ${s.source}`);
        const jobs = await driver(ctx);
        const { upserted, newJobIds } = await upsertJobs(jobs);
        await recordSyncSuccess(s.id, upserted);
        return {
          source: s.source,
          slug: s.slug ?? null,
          jobs_pulled: jobs.length,
          jobs_upserted: upserted,
          new_job_ids: newJobIds,
        };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        await recordSyncFailure(s.id, msg);
        return {
          source: s.source,
          slug: s.slug ?? null,
          jobs_pulled: 0,
          jobs_upserted: 0,
          error: msg,
        };
      }
    }),
  );

  const allNewIds = reports.flatMap((r) => r.new_job_ids ?? []);
  const autoMatch = allNewIds.length > 0 ? await autoMatchAndNotify(allNewIds) : null;
  return { reports, auto_match: autoMatch };
}

/** Sync a single source row by id — used by an admin "refresh" button. */
export async function runSyncForId(
  sourceCompanyId: string,
): Promise<SyncReport & { auto_match?: AutoMatchReport | null }> {
  const { data: s, error } = await db
    .from('source_companies')
    .select('*')
    .eq('id', sourceCompanyId)
    .single();
  if (error || !s) throw new Error('Source company not found');
  const ctx: DriverCtx = { slug: s.slug ?? null, display_name: s.display_name };
  try {
    const driver = DRIVERS[s.source as Source];
    if (!driver) throw new Error(`Unknown source: ${s.source}`);
    const jobs = await driver(ctx);
    const { upserted, newJobIds } = await upsertJobs(jobs);
    await recordSyncSuccess(s.id, upserted);
    const autoMatch = newJobIds.length > 0 ? await autoMatchAndNotify(newJobIds) : null;
    return {
      source: s.source,
      slug: s.slug ?? null,
      jobs_pulled: jobs.length,
      jobs_upserted: upserted,
      new_job_ids: newJobIds,
      auto_match: autoMatch,
    };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await recordSyncFailure(s.id, msg);
    return { source: s.source, slug: s.slug ?? null, jobs_pulled: 0, jobs_upserted: 0, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Auto-match-and-notify — the "AI engine" half.
// After each sync, score every newly-ingested job against every active
// consultant. Any match >= MATCH_NOTIFY_THRESHOLD fires an in-app DM from a
// system identity (first SUPER_ADMIN/CEO) to that consultant's recruiter.
// ---------------------------------------------------------------------------

const MATCH_NOTIFY_THRESHOLD = Math.max(
  0,
  Math.min(100, Number(process.env.MATCH_NOTIFY_THRESHOLD ?? 85)),
);
const MATCH_NOTIFY_MAX_JOBS_PER_CONSULTANT = 30; // cap prompt size
const MATCH_NOTIFY_MAX_NOTIFICATIONS_PER_CONSULTANT = 5;

function splitSkills(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[,;|/]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function findSystemSenderId(): Promise<string | null> {
  // Prefer a user with role SUPER_ADMIN; fall back to CEO, then the first
  // active manager-tier user. We use this as the sender for auto-match DMs
  // because messages.sender_id is NOT NULL and must differ from recipient_id.
  for (const role of ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR']) {
    const { data } = await db
      .from('users')
      .select('id')
      .eq('role', role)
      .eq('is_active', true)
      .limit(1);
    if (data && data[0]?.id) return data[0].id;
  }
  return null;
}

async function autoMatchAndNotify(newJobIds: string[]): Promise<AutoMatchReport> {
  const baseline: AutoMatchReport = {
    consultants_scanned: 0,
    matches_evaluated: 0,
    notifications_sent: 0,
    threshold: MATCH_NOTIFY_THRESHOLD,
  };
  try {
    // Feature flag gate. When `ai_match` is OFF, skip the entire AI pass —
    // no scoring, no notifications, no Anthropic API spend. Default-allow
    // when the flag is undefined so existing installs without the flag row
    // continue to behave as before.
    const flags = await loadFlags();
    if (flags.ai_match === false) {
      return { ...baseline, error: 'ai_match flag disabled' };
    }
    if (newJobIds.length === 0) return baseline;

    // Cap the candidate pool so a huge sync doesn't blow up the AI bill.
    const candidateIds = newJobIds.slice(0, 200);
    const { data: jobs } = await db
      .from('jobs')
      .select('id, title, company_name, required_skills, location, description')
      .in('id', candidateIds);
    if (!jobs || jobs.length === 0) return baseline;

    // Active consultants only.
    const { data: consultants } = await db
      .from('consultants')
      .select(
        'id, user_id, primary_skill, skills, total_experience_years, preferred_locations, recruiter_id',
      )
      .eq('marketing_status', 'ACTIVE');
    if (!consultants || consultants.length === 0) return baseline;

    // We need the consultant's name (for the message body) and the recruiter's
    // user_id (for the DM recipient). Fetch in two cheap batches.
    const consultantUserIds = (consultants as Array<{ user_id: string | null }>)
      .map((c) => c.user_id)
      .filter(Boolean) as string[];
    const recruiterIds = (consultants as Array<{ recruiter_id: string | null }>)
      .map((c) => c.recruiter_id)
      .filter(Boolean) as string[];
    const [{ data: users }, { data: recruiters }] = await Promise.all([
      consultantUserIds.length
        ? db.from('users').select('id, full_name').in('id', consultantUserIds)
        : Promise.resolve({ data: [] as any[] }),
      recruiterIds.length
        ? db.from('recruiters').select('id, user_id').in('id', recruiterIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const nameByUserId = new Map<string, string>(
      (users ?? []).map((u: any) => [u.id, u.full_name ?? 'Consultant']),
    );
    const recruiterUserById = new Map<string, string>(
      (recruiters ?? []).map((r: any) => [r.id, r.user_id]),
    );

    const senderId = await findSystemSenderId();
    if (!senderId) {
      // No admin to send from; skip silently rather than failing the whole sync.
      return {
        ...baseline,
        error: 'No SUPER_ADMIN/CEO user available to act as auto-match sender',
      };
    }

    const jobsForPrompt = jobs.slice(0, MATCH_NOTIFY_MAX_JOBS_PER_CONSULTANT).map((j: any) => ({
      id: j.id,
      title: j.title,
      required_skills: j.required_skills ?? [],
      location: j.location ?? '',
      description: (j.description ?? '').slice(0, 1500),
    }));
    const jobsById = new Map<string, any>(jobs.map((j: any) => [j.id, j]));

    let matchesEvaluated = 0;
    let notificationsSent = 0;

    for (const c of consultants) {
      if (!c.recruiter_id) continue;
      const recipientId = recruiterUserById.get(c.recruiter_id);
      if (!recipientId) continue; // recruiter row exists but has no user
      if (recipientId === senderId) continue; // can't DM yourself; skip if admin is also the recruiter

      try {
        const consultantSkills =
          Array.isArray((c as any).skills) && (c as any).skills.length > 0
            ? ((c as any).skills as string[])
            : splitSkills(c.primary_skill);
        if (consultantSkills.length === 0) continue; // nothing to match on

        const matches = await matchJobsForConsultant(
          {
            skills: consultantSkills,
            experienceYears: Number(c.total_experience_years ?? 0),
            preferredLocations: c.preferred_locations ?? [],
          },
          jobsForPrompt,
        );
        matchesEvaluated += matches.length;
        const strong = matches
          .filter((m) => m.match_score >= MATCH_NOTIFY_THRESHOLD)
          .slice(0, MATCH_NOTIFY_MAX_NOTIFICATIONS_PER_CONSULTANT);
        if (strong.length === 0) continue;

        const consultantName = nameByUserId.get(c.user_id) ?? 'Consultant';
        const rows = strong.map((m) => {
          const job = jobsById.get(m.job_id);
          const title = job?.title ?? 'a job';
          const company = job?.company_name ?? 'Unknown';
          const score = Math.round(m.match_score);
          const reason = (m.reasons ?? []).slice(0, 2).join(' · ');
          const link = `/jobs?focus=${m.job_id}`;
          const body = `Strong match for ${consultantName}: ${title} at ${company} (${score}%)${reason ? ` — ${reason}` : ''}.\nOpen: ${link}`;
          return { sender_id: senderId, recipient_id: recipientId, body };
        });
        const { error: insErr } = await db.from('messages').insert(rows);
        if (!insErr) notificationsSent += rows.length;
      } catch {
        // One consultant failing shouldn't abort the whole pass; just continue.
      }
    }

    return {
      consultants_scanned: consultants.length,
      matches_evaluated: matchesEvaluated,
      notifications_sent: notificationsSent,
      threshold: MATCH_NOTIFY_THRESHOLD,
    };
  } catch (e: any) {
    return { ...baseline, error: e?.message ?? String(e) };
  }
}

interface UpsertResult {
  upserted: number;
  newJobIds: string[]; // only rows the DB hadn't seen before — used to feed the matcher
}

async function upsertJobs(jobs: NormalizedJob[]): Promise<UpsertResult> {
  if (jobs.length === 0) return { upserted: 0, newJobIds: [] };

  // Pre-check which (source, external_id) pairs already exist so we can tell
  // "new" jobs apart from "refreshed" ones. We group by source even though a
  // driver call only ever returns one source — keeps the helper safe to reuse.
  const externalIdsBySource = new Map<string, string[]>();
  for (const j of jobs) {
    const arr = externalIdsBySource.get(j.source) ?? [];
    arr.push(j.external_id);
    externalIdsBySource.set(j.source, arr);
  }
  const existingKeys = new Set<string>();
  for (const [source, ids] of externalIdsBySource) {
    // Postgres .in() handles up to a few thousand values fine.
    const { data } = await db
      .from('jobs')
      .select('external_id')
      .eq('source', source)
      .in('external_id', ids);
    for (const r of data ?? []) existingKeys.add(`${source}|${r.external_id}`);
  }
  const trulyNew = jobs.filter((j) => !existingKeys.has(`${j.source}|${j.external_id}`));

  const rows = jobs.map((j) => ({
    source: j.source,
    external_id: j.external_id,
    title: j.title,
    company_name: j.company_name,
    description: j.description ?? null,
    location: j.location ?? null,
    remote: j.remote ?? false,
    job_type: j.job_type ?? null,
    level: j.level ?? null,
    required_skills: j.required_skills ?? null,
    rate_min: j.rate_min ?? null,
    rate_max: j.rate_max ?? null,
    apply_url: j.apply_url,
    posted_at: j.posted_at ?? null,
    publisher: j.publisher ?? null,
    is_active: true,
    last_synced_at: new Date().toISOString(),
  }));
  let { error, count } = await db
    .from('jobs')
    .upsert(rows, { onConflict: 'source,external_id', count: 'exact' });
  // If the `publisher` migration hasn't been applied yet, retry without it
  // rather than fail the whole sync. Same pattern used elsewhere.
  if (error && /publisher/.test(error.message) && /schema cache|column/i.test(error.message)) {
    // Destructure `publisher` out of every row so the retry doesn't send a
    // column the DB doesn't have yet. Renamed to `_publisher` to signal
    // "intentionally discarded" to the linter.
    const stripped = rows.map(({ publisher: _publisher, ...rest }) => rest);
    ({ error, count } = await db
      .from('jobs')
      .upsert(stripped, { onConflict: 'source,external_id', count: 'exact' }));
  }
  if (error) throw new Error(`Job upsert failed: ${error.message}`);

  // Resolve the freshly-inserted rows back to their UUIDs so the notifier can
  // build clickable links and pass them to the matcher.
  const newJobIds: string[] = [];
  if (trulyNew.length > 0) {
    const byKey = new Map<string, string[]>();
    for (const j of trulyNew) {
      const arr = byKey.get(j.source) ?? [];
      arr.push(j.external_id);
      byKey.set(j.source, arr);
    }
    for (const [source, ids] of byKey) {
      const { data } = await db
        .from('jobs')
        .select('id')
        .eq('source', source)
        .in('external_id', ids);
      for (const r of data ?? []) if (r.id) newJobIds.push(r.id);
    }
  }
  return { upserted: count ?? rows.length, newJobIds };
}

function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ---------------------------------------------------------------------------
// Hygiene helpers — descriptions arrive as HTML, salaries as zeros, tag lists
// as a mix of real skills and SEO noise. Normalize at ingest time so the rest
// of the app (and the AI matcher) sees clean text.
// ---------------------------------------------------------------------------
function stripHtml(input: string | null | undefined): string | null {
  if (input == null) return null;
  const decoded = decodeHtmlEntities(String(input));
  const text = decoded
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

// Tags RemoteOK ships that are categories, not skills.
const JUNK_TAGS = new Set<string>([
  'go',
  'lead',
  'leader',
  'growth',
  'engineering',
  'engineer',
  'developer',
  'senior',
  'junior',
  'mid',
  'principal',
  'staff',
  'manager',
  'director',
  'vp',
  'digital nomad',
  'non tech',
  'system',
  'systems',
  'code',
  'tech',
  'full time',
  'part time',
  'contract',
  'remote',
  'hybrid',
  'onsite',
  'usa',
  'us',
  'canada',
  'europe',
  'asia',
  'worldwide',
  'global',
  'apac',
  'startup',
  'crypto',
  'finance',
  'health',
  'edtech',
  'medical',
  'sales',
  'marketing',
  'design',
  'product',
  'support',
  'operations',
  'people',
  'admin',
  'business',
  'consulting',
  'analyst',
  'qa',
  'fullstack',
  'full stack',
  'frontend',
  'backend', // too generic on their own
]);

function cleanSkills(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const cleaned = t.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (JUNK_TAGS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 12) break;
  }
  return out;
}

// 0 / negative / NaN → null. Some feeds use 0 as a "not disclosed" sentinel.
function nonZero(n: unknown): number | null {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
  return n;
}

// Make sure we never store an empty/relative URL. Some feeds (most notably
// JSearch and Adzuna) occasionally omit the apply link. Falling back to a
// Google-for-jobs search keeps the "Apply on company site" button usable
// instead of opening an empty tab.
function safeApplyUrl(
  primary: string | null | undefined,
  ctx: { title: string; company: string; sourceUrl?: string | null },
): string {
  const tryUrl = (u: string | null | undefined): string | null => {
    if (!u) return null;
    const s = String(u).trim();
    if (!s) return null;
    return /^https?:\/\//i.test(s) ? s : null;
  };
  return (
    tryUrl(primary) ??
    tryUrl(ctx.sourceUrl) ??
    `https://www.google.com/search?ibp=htl;jobs&q=${encodeURIComponent(`${ctx.title} ${ctx.company}`)}`
  );
}

// Greenhouse returns "Discord Inc." in meta; Lever only gives us the URL slug.
// Make sure we never store "discord" lowercase.
function prettyCompanyName(metaName: string | null | undefined, slug: string): string {
  if (metaName && metaName.trim()) return metaName.trim();
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
