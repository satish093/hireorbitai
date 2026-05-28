import axios from 'axios';
import { db } from '../config/db';
import { logger } from '../config/logger';
import { matchJobsForConsultant } from './ai.service';
import { loadFlags } from '../controllers/featureFlags.controller';
import {
  mockEnabled,
  mockDice,
  mockLinkedIn,
  mockMonster,
  mockCareerBuilder,
} from './jobIngestionMocks';

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
 * Four-source job ingestion: Dice (direct REST API), CareerBuilder (HTTP +
 * Next.js SSR), Monster (Playwright headless), LinkedIn (RapidAPI).
 * All drivers return jobs in NormalizedJob shape; the orchestrator upserts
 * them using (source, external_id) as the dedup key.
 */

export type Source = 'dice' | 'careerbuilder' | 'linkedin' | 'monster' | 'manual';

export interface NormalizedJob {
  source: Source;
  external_id: string; // unique within the source
  title: string;
  company_name: string;
  description?: string | null;
  location?: string | null;
  remote?: boolean;
  job_type?: string | null; // FTE | Contract | W2 | 1099
  level?: string | null;
  required_skills?: string[];
  rate_min?: number | null;
  rate_max?: number | null;
  apply_url: string;
  posted_at?: string | null; // ISO
  publisher?: string | null;
}

interface DriverCtx {
  slug: string | null;
  display_name?: string | null;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Dice — direct public job-search REST API (no key, no quota).
// GET https://job-search-api.svc.dice.com/v1/jobsearch
// Slug = the search query (e.g. "software engineer").
// Env: DICE_QUERIES (pipe-separated fallback list).
// ---------------------------------------------------------------------------
async function fetchDice(slug: string | null): Promise<NormalizedJob[]> {
  if (mockEnabled()) {
    logger.info({ source: 'dice', slug }, 'jobIngestion: mock mode — returning synthetic jobs');
    return mockDice(slug);
  }

  const queries = (
    slug ??
    process.env.DICE_QUERIES ??
    'software engineer|data engineer|java developer'
  )
    .split('|')
    .map((q) => q.trim())
    .filter(Boolean);

  const out: NormalizedJob[] = [];
  const errs: string[] = [];

  for (const q of queries) {
    try {
      const { data, status } = await axios.get('https://job-search-api.svc.dice.com/v1/jobsearch', {
        params: {
          q,
          countryCode: 'US',
          radius: 30,
          radiusUnit: 'mi',
          pageSize: 50,
          endSlice: 50,
          startSlice: 0,
          facets: 'employmentType|postedDate|workFromHomeAvailability|employerType|skillTag|salary',
        },
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          Origin: 'https://www.dice.com',
          Referer: 'https://www.dice.com/',
        },
        timeout: 20000,
        validateStatus: () => true,
      });

      if (status >= 400) {
        errs.push(`"${q}": HTTP ${status}`);
        continue;
      }

      const jobs: any[] = Array.isArray(data?.data) ? data.data : [];
      for (const r of jobs) {
        const url = r.applyUrl ?? r.jobDetailUrl ?? r.detailUrl ?? null;
        const loc = r.location ?? null;
        const salMin = nonZero(r.salary?.salaryMin ?? r.salary?.value?.minValue ?? null);
        const salMax = nonZero(r.salary?.salaryMax ?? r.salary?.value?.maxValue ?? null);
        out.push({
          source: 'dice',
          external_id: String(r.id ?? r.guid ?? r.jobId ?? url),
          title: String(r.jobTitle ?? r.title ?? 'Unknown title'),
          company_name: String(r.companyName ?? r.company ?? 'Unknown'),
          description: stripHtml(
            r.jobDescription ?? r.description ?? r.searchResultDescription ?? null,
          ),
          location: loc,
          remote: r.workFromHomeAvailability === true || /remote/i.test(String(loc ?? '')),
          job_type: mapDiceEmployment(r.employmentType ?? r.employment_type),
          level: null,
          required_skills: Array.isArray(r.skills) ? cleanSkills(r.skills) : [],
          rate_min: salMin !== null ? Math.round(salMin / 2000) : null,
          rate_max: salMax !== null ? Math.round(salMax / 2000) : null,
          apply_url: safeApplyUrl(url, {
            title: String(r.jobTitle ?? r.title ?? ''),
            company: String(r.companyName ?? r.company ?? ''),
          }),
          posted_at: r.date ?? r.postedDate ?? r.publishedDate ?? null,
          publisher: 'Dice',
        });
      }
    } catch (e) {
      errs.push(`"${q}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (out.length === 0 && errs.length > 0) throw new Error(`Dice: ${errs.join(' | ')}`);
  return dedupe(out);
}

function mapDiceEmployment(t: unknown): string {
  if (!t) return 'FTE';
  const u = String(t).toLowerCase();
  if (u.includes('full') || u === 'fte') return 'FTE';
  if (u.includes('contract') || u.includes('c2c') || u.includes('third')) return 'Contract';
  if (u.includes('part')) return 'Part-time';
  if (u.includes('intern')) return 'Internship';
  return 'FTE';
}

// ---------------------------------------------------------------------------
// LinkedIn — RapidAPI "Fantastic Jobs" (linkedin-job-search-api.p.rapidapi.com).
// Slug = pipe-separated title filters (e.g. "Software Engineer|Data Engineer").
// Env: RAPIDAPI_KEY, LINKEDIN_TITLES, LINKEDIN_LOCATIONS, LINKEDIN_WINDOW.
// ---------------------------------------------------------------------------
async function fetchLinkedIn(slug: string | null): Promise<NormalizedJob[]> {
  if (mockEnabled()) {
    logger.info({ source: 'linkedin', slug }, 'jobIngestion: mock mode — returning synthetic jobs');
    return mockLinkedIn(slug);
  }
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY not set in backend/.env');

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
// Monster — Playwright headless browser with anti-detection.
// Navigates to Monster.com job search, intercepts the internal XHR responses
// from Monster's backend API to capture structured job JSON. Falls back to
// __NEXT_DATA__ extraction if the XHR interception yields nothing.
// Slug format: "keyword" or "keyword|location".
// Env: MONSTER_KEYWORDS (pipe-separated), MONSTER_LOCATION.
// ---------------------------------------------------------------------------
async function fetchMonster(slug: string | null): Promise<NormalizedJob[]> {
  if (mockEnabled()) {
    logger.info({ source: 'monster', slug }, 'jobIngestion: mock mode — returning synthetic jobs');
    return mockMonster(slug);
  }

  let keyword = (process.env.MONSTER_KEYWORDS ?? 'software engineer').split('|')[0]!.trim();
  let location = process.env.MONSTER_LOCATION ?? 'United States';
  if (slug) {
    const parts = slug
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts[0]) keyword = parts[0];
    if (parts[1]) location = parts[1];
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const capturedJobs: any[] = [];

  try {
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Remove the webdriver flag that sites use to detect headless Chrome.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Intercept Monster's internal JSON API responses.
    page.on('response', async (response) => {
      const url = response.url();
      if (
        (url.includes('appsapi.monster.io') ||
          url.includes('/jobs-svx-service/') ||
          url.includes('monster.com/api')) &&
        response.status() === 200
      ) {
        try {
          const json = await response.json();
          const jobs =
            json?.jobResults?.jobs ??
            json?.jobs ??
            (Array.isArray(json?.data) ? json.data : null) ??
            [];
          if (Array.isArray(jobs) && jobs.length > 0) capturedJobs.push(...jobs);
        } catch {
          // non-JSON response — skip
        }
      }
    });

    const searchUrl = `https://www.monster.com/jobs/search/?q=${encodeURIComponent(keyword)}&where=${encodeURIComponent(location)}&stpage=1&page=1`;
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 35000 });

    // Fallback: parse __NEXT_DATA__ if network interception yielded nothing.
    // Cast through globalThis so TypeScript doesn't require "dom" in tsconfig lib.
    if (capturedJobs.length === 0) {
      const nextData = await page.evaluate(() => {
        const g = globalThis as Record<string, any>;
        const el = g['document']?.getElementById('__NEXT_DATA__');
        if (!el) return null;
        try {
          return JSON.parse(el.textContent ?? '{}');
        } catch {
          return null;
        }
      });
      if (nextData) {
        const jobs =
          nextData?.props?.pageProps?.initialJobResults?.jobs ??
          nextData?.props?.pageProps?.jobs ??
          [];
        capturedJobs.push(...(Array.isArray(jobs) ? jobs : []));
      }
    }
  } finally {
    await browser.close();
  }

  return capturedJobs.slice(0, 50).map((r: any): NormalizedJob => {
    const loc = r.location?.city
      ? [r.location.city, r.location.state ?? r.location.region, r.location.country]
          .filter(Boolean)
          .join(', ')
      : (r.location ?? r.jobLocation ?? null);
    const url = r.applyUrl ?? r.jobAdUrl ?? r.url ?? r.detailsLink ?? null;
    return {
      source: 'monster',
      external_id: String(r.jobId ?? r.id ?? r.uniqueIdentifier ?? url),
      title: String(r.title ?? r.jobTitle ?? 'Unknown title'),
      company_name: String(r.company?.name ?? r.company ?? r.organization ?? 'Unknown'),
      description: stripHtml(r.description ?? r.summary ?? null),
      location: typeof loc === 'string' ? loc : null,
      remote: r.remote === true || /remote/i.test(String(loc ?? '')),
      job_type: mapMonsterEmployment(r.employmentType ?? r.jobType),
      level: null,
      required_skills: Array.isArray(r.skills) ? cleanSkills(r.skills) : [],
      rate_min: null,
      rate_max: null,
      apply_url: safeApplyUrl(url, {
        title: String(r.title ?? r.jobTitle ?? ''),
        company: String(r.company?.name ?? r.company ?? ''),
      }),
      posted_at: r.postedDate ?? r.datePosted ?? null,
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

// ---------------------------------------------------------------------------
// CareerBuilder — HTTP request + Next.js __NEXT_DATA__ extraction.
// CareerBuilder uses server-side rendering so job data is embedded in the
// initial HTML page — no headless browser needed.
// Slug = the search query (e.g. "software engineer").
// Env: CB_QUERIES (pipe-separated fallback list).
// ---------------------------------------------------------------------------
async function fetchCareerBuilder(slug: string | null): Promise<NormalizedJob[]> {
  if (mockEnabled()) {
    logger.info(
      { source: 'careerbuilder', slug },
      'jobIngestion: mock mode — returning synthetic jobs',
    );
    return mockCareerBuilder(slug);
  }

  const queries = (
    slug ??
    process.env.CB_QUERIES ??
    'software engineer|data engineer|java developer'
  )
    .split('|')
    .map((q) => q.trim())
    .filter(Boolean);

  const out: NormalizedJob[] = [];
  const errs: string[] = [];

  for (const q of queries) {
    try {
      const { data: html, status } = await axios.get(
        `https://www.careerbuilder.com/jobs?keywords=${encodeURIComponent(q)}&location=United+States`,
        {
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
          },
          timeout: 20000,
          validateStatus: () => true,
        },
      );

      if (status >= 400) {
        errs.push(`"${q}": HTTP ${status}`);
        continue;
      }

      const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(
        html,
      );
      if (!match) {
        errs.push(`"${q}": __NEXT_DATA__ not found — CareerBuilder may be blocking scrapers`);
        continue;
      }

      const nextData = JSON.parse(match[1]!);
      const jobs: any[] =
        nextData?.props?.pageProps?.jobsResult?.jobs ??
        nextData?.props?.pageProps?.jobs ??
        nextData?.props?.pageProps?.initialJobs ??
        [];

      for (const r of jobs) {
        const applyUrl = r.applyUrl ?? r.apply_url ?? r.externalApplyUrl ?? r.url ?? null;
        const loc = r.location ?? (r.city ? [r.city, r.state].filter(Boolean).join(', ') : null);
        out.push({
          source: 'careerbuilder',
          external_id: String(r.jobDID ?? r.jobId ?? r.id ?? applyUrl),
          title: String(r.jobTitle ?? r.title ?? 'Unknown title'),
          company_name: String(r.companyName ?? r.company ?? 'Unknown'),
          description: stripHtml(r.description ?? r.jobDescription ?? null),
          location: loc,
          remote: /remote/i.test(String(loc ?? '')),
          job_type: mapCBEmployment(r.employmentType ?? r.jobType),
          level: null,
          required_skills: [],
          rate_min: null,
          rate_max: null,
          apply_url: safeApplyUrl(applyUrl, {
            title: String(r.jobTitle ?? r.title ?? ''),
            company: String(r.companyName ?? r.company ?? ''),
          }),
          posted_at: r.postedDate ?? r.datePosted ?? r.date ?? null,
          publisher: 'CareerBuilder',
        });
      }
    } catch (e) {
      errs.push(`"${q}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (out.length === 0 && errs.length > 0) throw new Error(`CareerBuilder: ${errs.join(' | ')}`);
  return dedupe(out);
}

function mapCBEmployment(t: unknown): string {
  if (!t) return 'FTE';
  const u = String(t).toLowerCase();
  if (u.includes('full') || u === 'fte') return 'FTE';
  if (u.includes('contract') || u.includes('temp') || u.includes('c2c')) return 'Contract';
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
// Orchestrator
// ---------------------------------------------------------------------------

const DRIVERS: Record<Source, (ctx: DriverCtx) => Promise<NormalizedJob[]>> = {
  dice: ({ slug }) => fetchDice(slug),
  careerbuilder: ({ slug }) => fetchCareerBuilder(slug),
  linkedin: ({ slug }) => fetchLinkedIn(slug),
  monster: ({ slug }) => fetchMonster(slug),
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
    const flags = await loadFlags();
    if (flags.ai_match === false) {
      return { ...baseline, error: 'ai_match flag disabled' };
    }
    if (newJobIds.length === 0) return baseline;

    const candidateIds = newJobIds.slice(0, 200);
    const { data: jobs } = await db
      .from('jobs')
      .select('id, title, company_name, required_skills, location, description')
      .in('id', candidateIds);
    if (!jobs || jobs.length === 0) return baseline;

    const { data: consultants } = await db
      .from('consultants')
      .select(
        'id, user_id, primary_skill, skills, total_experience_years, preferred_locations, recruiter_id',
      )
      .eq('marketing_status', 'ACTIVE');
    if (!consultants || consultants.length === 0) return baseline;

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
      if (!recipientId) continue;
      if (recipientId === senderId) continue;

      try {
        const consultantSkills =
          Array.isArray((c as any).skills) && (c as any).skills.length > 0
            ? ((c as any).skills as string[])
            : splitSkills(c.primary_skill);
        if (consultantSkills.length === 0) continue;

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
        // One consultant failing shouldn't abort the whole pass.
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
  newJobIds: string[];
}

async function upsertJobs(jobs: NormalizedJob[]): Promise<UpsertResult> {
  if (jobs.length === 0) return { upserted: 0, newJobIds: [] };

  const externalIdsBySource = new Map<string, string[]>();
  for (const j of jobs) {
    const arr = externalIdsBySource.get(j.source) ?? [];
    arr.push(j.external_id);
    externalIdsBySource.set(j.source, arr);
  }
  const existingKeys = new Set<string>();
  for (const [source, ids] of externalIdsBySource) {
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
  if (error && /publisher/.test(error.message) && /schema cache|column/i.test(error.message)) {
    const stripped = rows.map(({ publisher: _publisher, ...rest }) => rest);
    ({ error, count } = await db
      .from('jobs')
      .upsert(stripped, { onConflict: 'source,external_id', count: 'exact' }));
  }
  if (error) throw new Error(`Job upsert failed: ${error.message}`);

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
// Hygiene helpers
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
  'backend',
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

function nonZero(n: unknown): number | null {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
  return n;
}

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
