import { RequestHandler } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { httpError } from '../types';
import { audit } from '../services/audit.service';

/**
 * Inbound sync endpoint for the Oracle "Hermes" HACP box — receives jobs
 * scraped/enriched off-box (LinkedIn via py-linkedin-jobs-scraper) and
 * upserts them into `public.jobs`. No `req.user`: this is machine-to-machine,
 * authenticated by an HMAC-SHA256 signature over the raw body (shared secret
 * = HACP_SYNC_SECRET here, HOSTINGER_SYNC_SECRET on the Oracle side), mirroring
 * the signed-URL pattern in config/storage.local.ts. Same mass-assignment
 * discipline as any other insert path: payload is `.strict()`-validated
 * before it touches the row shape sent to `jobs`.
 */

const jobSchema = z
  .object({
    fingerprint: z.string().min(1).max(128),
    title: z.string().min(1).max(500),
    company: z.string().min(1).max(300),
    location: z.string().max(300).nullish(),
    work_model: z.string().max(50).nullish(),
    seniority_level: z.string().max(50).nullish(),
    experience_years_str: z.string().max(50).nullish(),
    min_experience_years: z.coerce.number().min(0).max(60).nullish(),
    h1b_sponsorship: z.boolean().nullish(),
    posted_date: z.string().max(40).nullish(),
    // The Oracle side stores these as JSON-encoded TEXT columns in SQLite and
    // ships them verbatim — parse defensively rather than trusting the shape.
    skills_required: z.string().max(5000).nullish(),
    skills_tags: z.string().max(2000).nullish(),
    salary_min: z.coerce.number().nullish(),
    salary_max: z.coerce.number().nullish(),
    salary_currency: z.string().max(10).nullish(),
    ats_provider: z.string().max(50).nullish(),
    apply_url: z.string().max(2000).nullish(),
    full_description: z.string().max(20000).nullish(),
  })
  .strict();

const payloadSchema = z
  .object({
    jobs: z.array(jobSchema).max(500),
  })
  .strict();

function parseSkills(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// Mirrors safeApplyUrl() in jobIngestion.service.ts — only accept http(s)
// URLs from an untrusted source; fall back to a search link otherwise.
function safeApplyUrl(raw: string | null | undefined, title: string, company: string): string {
  const s = (raw ?? '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://www.google.com/search?ibp=htl;jobs&q=${encodeURIComponent(`${title} ${company}`)}`;
}

export const receiveSync: RequestHandler = async (req, res) => {
  const secret = env.hacp.syncSecret;
  if (!secret) throw httpError(503, 'HACP sync is not configured on this server');

  const raw = req.rawBody;
  const signature = String(req.headers['x-hacp-signature'] ?? '');
  if (!raw || !signature) throw httpError(400, 'Missing signature');

  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    audit({ action: 'hacp_sync_rejected', req, metadata: { reason: 'bad_signature' } });
    throw httpError(403, 'Invalid signature');
  }

  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid payload', parsed.error.flatten());

  const jobs = parsed.data.jobs;
  if (jobs.length === 0) {
    res.status(200).json({ ingested: 0 });
    return;
  }

  const rows = jobs.map((j) => {
    const workModel = (j.work_model ?? '').toLowerCase();
    const remote =
      workModel.includes('remote') || (j.location ?? '').toLowerCase().includes('remote');
    return {
      source: 'linkedin_hacp',
      external_id: j.fingerprint,
      title: j.title,
      company_name: j.company,
      description: j.full_description ?? null,
      location: j.location ?? null,
      remote,
      job_type: 'FTE',
      level: j.seniority_level ?? null,
      required_skills: parseSkills(j.skills_required),
      rate_min: j.salary_min ?? null,
      rate_max: j.salary_max ?? null,
      apply_url: safeApplyUrl(j.apply_url, j.title, j.company),
      posted_at: j.posted_date ?? null,
      publisher: 'LinkedIn',
      is_active: true,
      last_synced_at: new Date().toISOString(),
      // Metadata that has no dedicated column yet — kept alongside rather
      // than dropped. Stripped automatically below if the column is missing
      // on a not-yet-migrated environment (same retry-and-strip pattern as
      // jobIngestion.service.ts's upsertJobs()).
      requirements: {
        ats_provider: j.ats_provider ?? null,
        experience_years_str: j.experience_years_str ?? null,
        salary_currency: j.salary_currency ?? null,
        h1b_sponsorship: Boolean(j.h1b_sponsorship),
        skills_tags: parseSkills(j.skills_tags),
      },
    };
  });

  let { error, count } = await db
    .from('jobs')
    .upsert(rows, { onConflict: 'source,external_id', count: 'exact' });

  if (error && /schema cache|column/i.test(error.message)) {
    const stripped = rows.map(
      ({ publisher: _publisher, requirements: _requirements, ...rest }) => rest,
    );
    ({ error, count } = await db
      .from('jobs')
      .upsert(stripped, { onConflict: 'source,external_id', count: 'exact' }));
  }

  if (error) {
    logger.error({ err: error }, 'hacpWebhook: upsert failed');
    throw httpError(500, 'Database error');
  }

  const ingested = count ?? rows.length;
  audit({ action: 'hacp_sync_received', req, metadata: { ingested, submitted: rows.length } });
  res.status(200).json({ ingested });
};
