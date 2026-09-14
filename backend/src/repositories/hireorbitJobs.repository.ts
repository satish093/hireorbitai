/**
 * Read-only repository for public.hireorbit_jobs.
 *
 * Owns: public.hireorbit_jobs — the immutable feed synced in by the external
 * HACP/Oracle agent (backend/src/../../ hireorbit_receiver.py on the VPS,
 * port 9999). Intentionally separate from public.jobs / jobs.repository.ts —
 * never merged, never written to from this app. DB-level guards (BEFORE
 * DELETE/TRUNCATE triggers + a role with no DELETE grant) already make the
 * table immutable; this repository only ever SELECTs.
 */

import { db } from '../config/db';
import { httpError } from '../types';

export interface HireorbitJobRow {
  id: number;
  fingerprint: string;
  title: string;
  company: string;
  location: string;
  work_model: string | null;
  seniority_level: string | null;
  experience_years_str: string | null;
  min_experience_years: number | null;
  h1b_sponsorship: boolean | null;
  posted_date: string | null;
  skills_required: string | null;
  skills_tags: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  ats_provider: string | null;
  apply_url: string | null;
  full_description: string | null;
  synced_at: string;
}

export async function listSynced(opts?: { limit?: number }): Promise<HireorbitJobRow[]> {
  let q = db.from('hireorbit_jobs').select('*').order('synced_at', { ascending: false });
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw httpError(500, 'Database error');
  return (data as HireorbitJobRow[]) ?? [];
}
