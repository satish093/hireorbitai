/**
 * Clients repository.
 *
 * Owns: public.clients. Symmetric with vendors.repository.
 */

import { db } from '../config/db';
import { httpError } from '../types';

export interface ClientRow {
  id: string;
  company_name: string;
  industry: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function findById(id: string): Promise<ClientRow | null> {
  const { data, error } = await db.from('clients').select('*').eq('id', id).maybeSingle();
  if (error) throw httpError(500, error.message);
  return (data as ClientRow | null) ?? null;
}

export async function requireById(id: string): Promise<ClientRow> {
  const row = await findById(id);
  if (!row) throw httpError(404, 'Client not found');
  return row;
}

export async function listAll(): Promise<ClientRow[]> {
  const { data, error } = await db
    .from('clients')
    .select('*')
    .order('company_name', { ascending: true });
  if (error) throw httpError(500, error.message);
  return (data as ClientRow[]) ?? [];
}

export async function create(payload: Partial<ClientRow>): Promise<ClientRow> {
  const { data, error } = await db.from('clients').insert(payload).select().single();
  if (error) throw httpError(500, error.message);
  return data as ClientRow;
}

export async function updateById(id: string, patch: Partial<ClientRow>): Promise<ClientRow> {
  const { data, error } = await db.from('clients').update(patch).eq('id', id).select().single();
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, 'Client not found');
  return data as ClientRow;
}

export async function deleteById(id: string): Promise<void> {
  const { error } = await db.from('clients').delete().eq('id', id);
  if (error) throw httpError(500, error.message);
}
