import axios from 'axios';
import { db } from '../config/db';
import { logger } from '../config/logger';
import { matchJobsForConsultant } from './ai.service';
import { loadFlags } from '../controllers/featureFlags.controller';
import { mockEnabled, mockJooble } from './jobIngestionMocks';

// ---------------------------------------------------------------------------
// Driver self-healing — auto-deactivate misbehaving source_companies rows.
// ---------------------------------------------------------------------------

const CONSECUTIVE_FAILURES_BEFORE_DEACTIVATE = Math.max(
  1,
  Number(process.env.SOURCE_AUTODEACTIVATE_AFTER ?? 3),
);

function permanentFailureReason(errorMessage: string): string | null {
  const m = errorMessage.toLowerCase();
  if (m.includes('exceeded the monthly quota') || m.includes('exceeded the daily quota'))
    return 'Monthly/daily API quota exhausted';
  if (m.includes('not subscribed') || m.includes('your plan')) return 'Plan limit / not subscribed';
  if (m.includes('401') || m.includes('unauthorized') || m.includes('invalid api key'))
    return 'API key rejected (401)';
  if (m.includes('403') || m.includes('forbidden')) return 'Access forbidden (403)';
  if (m.includes('not set in backend/.env') || m.includes('must be set in backend/.env'))
    return 'Required environment variable not set';
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
 * Job ingestion via Jooble (free aggregator API).
 * Results are filtered to Dice, Monster, and CareerBuilder only.
 * Env: JOOBLE_API_KEY (free key from jooble.org/api/index).
 */

export type Source = 'jooble' | 'manual';

export interface NormalizedJob {
  source: Source;
  external_id: string;
  title: string;
  company_name: string;
  description?: string | null;
  location?: string | null;
  remote?: boolean;
  job_type?: string | null;
  level?: string | null;
  required_skills?: string[];
  rate_min?: number | null;
  rate_max?: number | null;
  apply_url: string;
  posted_at?: string | null;
  publisher?: string | null;
}

interface DriverCtx {
  slug: string | null;
  display_name?: string | null;
}

// ---------------------------------------------------------------------------
// Jooble — free aggregator, filtered to Dice + Monster + CareerBuilder only.
// POST https://jooble.org/api/{JOOBLE_API_KEY}
// Slug = the search query (e.g. "software engineer").
// Env: JOOBLE_API_KEY, JOOBLE_QUERIES (pipe-separated), JOOBLE_LOCATION.
// ---------------------------------------------------------------------------

function isDiceMonsterCB(source: unknown): boolean {
  if (!source) return false;
  const s = String(source).toLowerCase();
  return (
    s.includes('dice') ||
    s.includes('monster') ||
    s.includes('careerbuilder') ||
    s.includes('career builder')
  );
}

function normalizeBoard(source: unknown): string {
  const s = String(source ?? '').toLowerCase();
  if (s.includes('dice')) return 'Dice';
  if (s.includes('monster')) return 'Monster';
  if (s.includes('careerbuilder') || s.includes('career builder')) return 'CareerBuilder';
  return String(source ?? 'Jooble');
}

async function fetchJooble(slug: string | null): Promise<NormalizedJob[]> {
  if (mockEnabled()) {
    logger.info({ source: 'jooble', slug }, 'jobIngestion: mock mode — returning synthetic jobs');
    return mockJooble(slug);
  }

  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey)
    throw new Error('JOOBLE_API_KEY not set in backend/.env — free key at jooble.org/api/index');

  const queries = (
    slug ??
    process.env.JOOBLE_QUERIES ??
    'software engineer|data engineer|java developer'
  )
    .split('|')
    .map((q) => q.trim())
    .filter(Boolean);
  const location = process.env.JOOBLE_LOCATION ?? 'United States';

  const out: NormalizedJob[] = [];
  const errs: string[] = [];

  for (const q of queries) {
    try {
      const { data, status } = await axios.post(
        `https://jooble.org/api/${apiKey}`,
        { keywords: q, location, page: '1', ResultOnPage: '100' },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000,
          validateStatus: () => true,
        },
      );

      if (status >= 400) {
        errs.push(`"${q}": HTTP ${status}`);
        continue;
      }

      const jobs: any[] = Array.isArray(data?.jobs) ? data.jobs : [];

      // Drop every board except Dice, Monster, CareerBuilder.
      for (const r of jobs.filter((j) => isDiceMonsterCB(j.source))) {
        out.push({
          source: 'jooble',
          external_id: String(r.id ?? r.link),
          title: String(r.title ?? 'Unknown title'),
          company_name: String(r.company ?? 'Unknown'),
          description: stripHtml(r.snippet ?? r.description ?? null),
          location: r.location ?? null,
          remote: /remote/i.test(String(r.location ?? r.title ?? '')),
          job_type: mapJoobleType(r.type),
          level: null,
          required_skills: [],
          rate_min: null,
          rate_max: null,
          apply_url: safeApplyUrl(r.link, {
            title: String(r.title ?? ''),
            company: String(r.company ?? ''),
          }),
          posted_at: r.updated ?? null,
          publisher: normalizeBoard(r.source),
        });
      }
    } catch (e) {
      errs.push(`"${q}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (out.length === 0 && errs.length > 0) throw new Error(`Jooble: ${errs.join(' | ')}`);
  return dedupe(out);
}

function mapJoobleType(t: unknown): string {
  if (!t) return 'FTE';
  const u = String(t).toLowerCase();
  if (u.includes('full')) return 'FTE';
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
  jooble: ({ slug }) => fetchJooble(slug),
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
// Auto-match-and-notify
// ---------------------------------------------------------------------------

const MATCH_NOTIFY_THRESHOLD = Math.max(
  0,
  Math.min(100, Number(process.env.MATCH_NOTIFY_THRESHOLD ?? 85)),
);
const MATCH_NOTIFY_MAX_JOBS_PER_CONSULTANT = 30;
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
    if (flags.ai_match === false) return { ...baseline, error: 'ai_match flag disabled' };
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
    if (!senderId)
      return {
        ...baseline,
        error: 'No SUPER_ADMIN/CEO user available to act as auto-match sender',
      };

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
        // one consultant failing doesn't abort the pass
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

// nonZero exported for potential future use by other modules
export { nonZero as _nonZero, cleanSkills as _cleanSkills };

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
