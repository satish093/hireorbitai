/**
 * Consultants repository.
 *
 * Owns: public.consultants + the user-side joins the consultants controller
 * routinely makes.
 *
 * Read-heavy resource: dashboards + recruiters' "my consultants" list + the
 * Applications page consultant picker all hit this. Caching is a natural fit
 * — wire it in here when needed rather than scattering it across controllers.
 */

import { db } from '../config/db';
import { httpError } from '../types';

export type MarketingStatus = 'ACTIVE' | 'PAUSED' | 'PLACED';

export interface ConsultantRow {
  id: string;
  user_id: string;
  recruiter_id: string | null;
  visa_status: string | null;
  current_location: string | null;
  preferred_locations: string[] | null;
  primary_skill: string | null;
  skills: string[] | null;
  desired_positions: string[] | null;
  total_experience_years: number | null;
  relocation: boolean;
  remote_only: boolean;
  expected_rate: number | null;
  linkedin_url: string | null;
  notes: string | null;
  marketing_status: MarketingStatus;
  created_at: string;
  updated_at: string;
}

const EMBED = '*, user:users!user_id(id, full_name, email, phone, avatar_url, role)';

export async function findById(id: string): Promise<ConsultantRow | null> {
  const { data, error } = await db.from('consultants').select(EMBED).eq('id', id).maybeSingle();
  if (error) throw httpError(500, 'Database error');
  return (data as ConsultantRow | null) ?? null;
}

export async function requireById(id: string): Promise<ConsultantRow> {
  const row = await findById(id);
  if (!row) throw httpError(404, 'Consultant not found');
  return row;
}

export async function findByUserId(userId: string): Promise<ConsultantRow | null> {
  const { data, error } = await db
    .from('consultants')
    .select(EMBED)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  return (data as ConsultantRow | null) ?? null;
}

export async function listAll(): Promise<ConsultantRow[]> {
  const { data, error } = await db
    .from('consultants')
    .select(EMBED)
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, 'Database error');
  return (data as ConsultantRow[]) ?? [];
}

export async function listForRecruiter(recruiterId: string): Promise<ConsultantRow[]> {
  const { data, error } = await db
    .from('consultants')
    .select(EMBED)
    .eq('recruiter_id', recruiterId)
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, 'Database error');
  return (data as ConsultantRow[]) ?? [];
}

export async function listActive(): Promise<ConsultantRow[]> {
  const { data, error } = await db
    .from('consultants')
    .select(EMBED)
    .eq('marketing_status', 'ACTIVE')
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, 'Database error');
  return (data as ConsultantRow[]) ?? [];
}

export async function create(payload: Partial<ConsultantRow>): Promise<ConsultantRow> {
  const { data, error } = await db.from('consultants').insert(payload).select(EMBED).single();
  if (error) throw httpError(500, 'Database error');
  return data as ConsultantRow;
}

export async function updateById(
  id: string,
  patch: Partial<ConsultantRow>,
): Promise<ConsultantRow> {
  const { data, error } = await db
    .from('consultants')
    .update(patch)
    .eq('id', id)
    .select(EMBED)
    .single();
  if (error) throw httpError(500, 'Database error');
  if (!data) throw httpError(404, 'Consultant not found');
  return data as ConsultantRow;
}
