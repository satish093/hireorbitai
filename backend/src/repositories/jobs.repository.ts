/**
 * Jobs repository.
 *
 * Owns: public.jobs (the upserted feed from every ingestion driver).
 *
 * Caveats:
 *   - The ingestion service does its own bulk upserts in jobIngestion.service.ts
 *     because it batches at sizes the query builder would split awkwardly.
 *     That's fine — repositories are a guideline for HTTP-shaped reads, not a
 *     religion.
 */

import { db } from '../config/db';
import { httpError } from '../types';

export interface JobRow {
  id: string;
  source: string;
  external_id: string;
  title: string;
  company_name: string;
  description: string | null;
  location: string | null;
  remote: boolean;
  job_type: string | null;
  level: string | null;
  required_skills: string[] | null;
  rate_min: number | null;
  rate_max: number | null;
  apply_url: string;
  posted_at: string | null;
  publisher: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function findById(id: string): Promise<JobRow | null> {
  const { data, error } = await db.from('jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw httpError(500, error.message);
  return (data as JobRow | null) ?? null;
}

export async function requireById(id: string): Promise<JobRow> {
  const row = await findById(id);
  if (!row) throw httpError(404, 'Job not found');
  return row;
}

export async function listActive(opts?: { limit?: number }): Promise<JobRow[]> {
  let q = db
    .from('jobs')
    .select('*')
    .eq('is_active', true)
    .order('posted_at', { ascending: false, nullsFirst: false });
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw httpError(500, error.message);
  return (data as JobRow[]) ?? [];
}

/** Lookup by the (source, external_id) dedup key the ingestion drivers use. */
export async function findByExternal(source: string, externalId: string): Promise<JobRow | null> {
  const { data, error } = await db
    .from('jobs')
    .select('*')
    .eq('source', source)
    .eq('external_id', externalId)
    .maybeSingle();
  if (error) throw httpError(500, error.message);
  return (data as JobRow | null) ?? null;
}

export async function deactivateById(id: string): Promise<void> {
  const { error } = await db.from('jobs').update({ is_active: false }).eq('id', id);
  if (error) throw httpError(500, error.message);
}
