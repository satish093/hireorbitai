/**
 * Applications repository.
 *
 * Owns: public.applications (job submissions).
 * Used by: controllers/applications.controller.ts, services/jobIngestion.service.ts.
 *
 * Exemplar repository — covers the read patterns the applications controller
 * actually uses. The controller itself still talks to `db.from()` directly
 * today; refactor it onto these helpers the next time you touch it.
 */

import { db } from '../config/db';
import { httpError } from '../types';

export interface ApplicationRow {
  id: string;
  consultant_id: string;
  job_id: string | null;
  vendor_id: string | null;
  status: string;
  submitted_at: string | null;
  archived_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Find one application; null if not found. */
export async function findById(id: string): Promise<ApplicationRow | null> {
  const { data, error } = await db.from('applications').select('*').eq('id', id).maybeSingle();
  if (error) throw httpError(500, error.message);
  return (data as ApplicationRow | null) ?? null;
}

/** Find one application; throws 404 if not found. */
export async function requireById(id: string): Promise<ApplicationRow> {
  const row = await findById(id);
  if (!row) throw httpError(404, 'Application not found');
  return row;
}

/**
 * List applications for a consultant, optionally filtered by status.
 * Joined with `job` + `vendor` + `consultant` via embedded selects.
 */
export async function listForConsultant(
  consultantId: string,
  opts?: { status?: string },
): Promise<ApplicationRow[]> {
  let q = db
    .from('applications')
    .select('*, job:jobs(*), vendor:vendors(*), consultant:consultants(*)')
    .eq('consultant_id', consultantId);
  if (opts?.status) q = q.eq('status', opts.status);
  const { data, error } = await q.order('submitted_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  return (data as ApplicationRow[]) ?? [];
}

/** Insert + return the inserted row. */
export async function create(payload: Partial<ApplicationRow>): Promise<ApplicationRow> {
  const { data, error } = await db.from('applications').insert(payload).select().single();
  if (error) throw httpError(500, error.message);
  return data as ApplicationRow;
}

/** Update by id + return the mutated row. Throws 404 if the id doesn't exist. */
export async function updateById(
  id: string,
  patch: Partial<ApplicationRow>,
): Promise<ApplicationRow> {
  const { data, error } = await db
    .from('applications')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, 'Application not found');
  return data as ApplicationRow;
}

/** Hard delete (legacy callsite — prefer archiving). */
export async function deleteById(id: string): Promise<void> {
  const { error } = await db.from('applications').delete().eq('id', id);
  if (error) throw httpError(500, error.message);
}
