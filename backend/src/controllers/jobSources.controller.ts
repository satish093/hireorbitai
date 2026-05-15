import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { runSync, runSyncForId, Source } from '../services/jobIngestion.service';
import { httpError } from '../types';

const VALID_SOURCES: Source[] = [
  'remoteok',
  'greenhouse',
  'lever',
  'adzuna',
  'remotive',
  'arbeitnow',
  'jsearch',
  'ashby',
  'jooble',
  'usajobs',
  'serpapi',
  'searchapi',
  'linkedin',
  'monster',
  'manual',
];

function sourceNeedsSlug(s: Source): boolean {
  return s === 'greenhouse' || s === 'lever' || s === 'ashby';
}
function sourceRequiresKey(s: Source): boolean {
  return (
    s === 'adzuna' ||
    s === 'jsearch' ||
    s === 'jooble' ||
    s === 'usajobs' ||
    s === 'serpapi' ||
    s === 'searchapi' ||
    s === 'linkedin' ||
    s === 'monster'
  );
}

export const listSources: RequestHandler = async (_req, res) => {
  const { data, error } = await db
    .from('source_companies')
    .select('*')
    .order('source')
    .order('display_name');
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const createSource: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    source: z.enum([
      'remoteok',
      'greenhouse',
      'lever',
      'adzuna',
      'remotive',
      'arbeitnow',
      'jsearch',
      'ashby',
      'jooble',
      'usajobs',
      'serpapi',
      'searchapi',
      'linkedin',
      'monster',
      'manual',
    ]),
    slug: z.string().optional().nullable(),
    display_name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  if (sourceNeedsSlug(parsed.data.source) && !parsed.data.slug) {
    throw httpError(400, `${parsed.data.source} requires a company slug`);
  }
  const { data, error } = await db
    .from('source_companies')
    .insert({
      source: parsed.data.source,
      slug: parsed.data.slug ?? null,
      display_name: parsed.data.display_name ?? parsed.data.slug ?? parsed.data.source,
      added_by: req.user.id,
    })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const updateSource: RequestHandler = async (req, res) => {
  const schema = z.object({
    is_active: z.boolean().optional(),
    display_name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await db
    .from('source_companies')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const deleteSource: RequestHandler = async (req, res) => {
  const { error } = await db.from('source_companies').delete().eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

/** Trigger a full sync across every active source. Manager-only. */
export const sync: RequestHandler = async (_req, res) => {
  const { reports, auto_match } = await runSync();
  const summary = {
    sources_run: reports.length,
    jobs_pulled: reports.reduce((s, r) => s + r.jobs_pulled, 0),
    jobs_upserted: reports.reduce((s, r) => s + r.jobs_upserted, 0),
    new_jobs: reports.reduce((s, r) => s + (r.new_job_ids?.length ?? 0), 0),
    errors: reports.filter((r) => r.error).length,
    auto_match,
    reports,
  };
  res.json(summary);
};

/** Sync a single source by source_companies.id */
export const syncOne: RequestHandler = async (req, res) => {
  const report = await runSyncForId(req.params.id);
  res.json(report);
};

/** Health dashboard — per-source rollup of:
 *   - is the API key configured?
 *   - how many rows in source_companies (active vs paused)
 *   - last sync count + last sync error (worst across rows)
 *  Used by the SourcesDrawer to explain why a source is dark / silent. */
export const sourcesHealth: RequestHandler = async (_req, res) => {
  const { data: rows } = await db
    .from('source_companies')
    .select('source, is_active, last_synced_at, last_sync_jobs_count, last_sync_error');

  // Per-source aggregates.
  const byId = new Map<
    Source,
    {
      rows_total: number;
      rows_active: number;
      last_synced_at: string | null;
      last_sync_jobs_count: number;
      last_error: string | null;
    }
  >();
  for (const r of rows ?? []) {
    const k = r.source as Source;
    const cur = byId.get(k) ?? {
      rows_total: 0,
      rows_active: 0,
      last_synced_at: null,
      last_sync_jobs_count: 0,
      last_error: null,
    };
    cur.rows_total++;
    if (r.is_active) cur.rows_active++;
    cur.last_sync_jobs_count += r.last_sync_jobs_count ?? 0;
    if (r.last_sync_error) cur.last_error = r.last_sync_error;
    if (r.last_synced_at && (!cur.last_synced_at || r.last_synced_at > cur.last_synced_at)) {
      cur.last_synced_at = r.last_synced_at;
    }
    byId.set(k, cur);
  }

  const keyConfigured: Record<string, boolean> = {
    remoteok: true,
    greenhouse: true,
    lever: true,
    remotive: true,
    arbeitnow: true,
    ashby: true,
    manual: true,
    adzuna: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
    jsearch: !!process.env.JSEARCH_API_KEY,
    jooble: !!process.env.JOOBLE_API_KEY,
    usajobs: !!(process.env.USAJOBS_API_KEY && process.env.USAJOBS_USER_AGENT),
    serpapi: !!process.env.SERPAPI_API_KEY,
    searchapi: !!process.env.SEARCHAPI_API_KEY,
    linkedin: !!(process.env.RAPIDAPI_KEY || process.env.JSEARCH_API_KEY),
    monster: !!(process.env.RAPIDAPI_KEY || process.env.JSEARCH_API_KEY),
  };

  const out = VALID_SOURCES.map((s) => {
    const agg = byId.get(s) ?? {
      rows_total: 0,
      rows_active: 0,
      last_synced_at: null,
      last_sync_jobs_count: 0,
      last_error: null,
    };
    return {
      source: s,
      key_configured: keyConfigured[s] ?? true,
      needs_key: sourceRequiresKey(s),
      needs_slug: sourceNeedsSlug(s),
      rows_total: agg.rows_total,
      rows_active: agg.rows_active,
      last_synced_at: agg.last_synced_at,
      last_sync_jobs_count: agg.last_sync_jobs_count,
      last_error: agg.last_error,
      // status: green if it has active rows + key + recent sync; amber if missing key or 0 rows; red if last error.
      status: agg.last_error
        ? 'error'
        : sourceRequiresKey(s) && !keyConfigured[s]
          ? 'missing_key'
          : agg.rows_active === 0
            ? 'no_rows'
            : 'ok',
    };
  });
  res.json(out);
};

/** Driver list — useful for the frontend's "Add source" picker. */
export const drivers: RequestHandler = (_req, res) => {
  res.json({
    sources: VALID_SOURCES.map((s) => ({
      id: s,
      needs_slug: sourceNeedsSlug(s),
      requires_key: sourceRequiresKey(s),
    })),
  });
};
