/**
 * Recruiters repository.
 *
 * Owns: public.recruiters + the user-side joins.
 *
 * Symmetric with consultants.repository — same pattern, same embed shape.
 */

import { db } from '../config/db';
import { httpError } from '../types';

export interface RecruiterRow {
  id: string;
  user_id: string;
  manager_id: string | null;
  team: string | null;
  target_submissions_per_week: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const EMBED = '*, user:users!user_id(id, full_name, email, phone, avatar_url, role)';

export async function findById(id: string): Promise<RecruiterRow | null> {
  const { data, error } = await db.from('recruiters').select(EMBED).eq('id', id).maybeSingle();
  if (error) throw httpError(500, error.message);
  return (data as RecruiterRow | null) ?? null;
}

export async function requireById(id: string): Promise<RecruiterRow> {
  const row = await findById(id);
  if (!row) throw httpError(404, 'Recruiter not found');
  return row;
}

export async function findByUserId(userId: string): Promise<RecruiterRow | null> {
  const { data, error } = await db
    .from('recruiters')
    .select(EMBED)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw httpError(500, error.message);
  return (data as RecruiterRow | null) ?? null;
}

export async function listAll(): Promise<RecruiterRow[]> {
  const { data, error } = await db
    .from('recruiters')
    .select(EMBED)
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  return (data as RecruiterRow[]) ?? [];
}

export async function listForManager(managerId: string): Promise<RecruiterRow[]> {
  const { data, error } = await db
    .from('recruiters')
    .select(EMBED)
    .eq('manager_id', managerId)
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  return (data as RecruiterRow[]) ?? [];
}

export async function create(payload: Partial<RecruiterRow>): Promise<RecruiterRow> {
  const { data, error } = await db.from('recruiters').insert(payload).select(EMBED).single();
  if (error) throw httpError(500, error.message);
  return data as RecruiterRow;
}

export async function updateById(id: string, patch: Partial<RecruiterRow>): Promise<RecruiterRow> {
  const { data, error } = await db
    .from('recruiters')
    .update(patch)
    .eq('id', id)
    .select(EMBED)
    .single();
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, 'Recruiter not found');
  return data as RecruiterRow;
}
