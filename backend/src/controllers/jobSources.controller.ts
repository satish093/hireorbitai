import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { runSync, runSyncForId, Source } from '../services/jobIngestion.service';
import { httpError } from '../types';

const VALID_SOURCES: Source[] = ['jooble', 'manual'];

function sourceRequiresKey(s: Source): boolean {
  return s === 'jooble'; // free Jooble API key from jooble.org/api/index
}

export const listSources: RequestHandler = async (_req, res) => {
  const { data, error } = await db
    .from('source_companies')
    .select('*')
    .order('source')
    .order('display_name');
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const createSource: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    source: z.enum(['jooble', 'manual']),
    slug: z.string().optional().nullable(),
    display_name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
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
  if (error) throw httpError(500, 'Database error');
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
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const deleteSource: RequestHandler = async (req, res) => {
  const { error } = await db.from('source_companies').delete().eq('id', req.params.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};

export const sync: RequestHandler = async (_req, res) => {
  const { reports, auto_match } = await runSync();
  res.json({
    sources_run: reports.length,
    jobs_pulled: reports.reduce((s, r) => s + r.jobs_pulled, 0),
    jobs_upserted: reports.reduce((s, r) => s + r.jobs_upserted, 0),
    new_jobs: reports.reduce((s, r) => s + (r.new_job_ids?.length ?? 0), 0),
    errors: reports.filter((r) => r.error).length,
    auto_match,
    reports,
  });
};

export const syncOne: RequestHandler = async (req, res) => {
  const report = await runSyncForId(req.params.id);
  res.json(report);
};

export const sourcesHealth: RequestHandler = async (_req, res) => {
  const { data: rows } = await db
    .from('source_companies')
    .select('source, is_active, last_synced_at, last_sync_jobs_count, last_sync_error');

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
    if (r.last_synced_at && (!cur.last_synced_at || r.last_synced_at > cur.last_synced_at))
      cur.last_synced_at = r.last_synced_at;
    byId.set(k, cur);
  }

  const keyConfigured: Record<string, boolean> = {
    jooble: !!process.env.JOOBLE_API_KEY,
    manual: true,
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
      rows_total: agg.rows_total,
      rows_active: agg.rows_active,
      last_synced_at: agg.last_synced_at,
      last_sync_jobs_count: agg.last_sync_jobs_count,
      last_error: agg.last_error,
      status: agg.last_error
        ? 'error'
        : !keyConfigured[s]
          ? 'missing_key'
          : agg.rows_active === 0
            ? 'no_rows'
            : 'ok',
    };
  });
  res.json(out);
};

export const drivers: RequestHandler = (_req, res) => {
  res.json({
    sources: VALID_SOURCES.map((s) => ({ id: s, requires_key: sourceRequiresKey(s) })),
  });
};
