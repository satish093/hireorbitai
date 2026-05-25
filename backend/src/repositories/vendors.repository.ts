/**
 * Vendors repository.
 *
 * Owns: public.vendors. Used by the Vendors page + Applications form.
 */

import { db } from '../config/db';
import { httpError } from '../types';

export interface VendorRow {
  id: string;
  company_name: string;
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

export async function findById(id: string): Promise<VendorRow | null> {
  const { data, error } = await db.from('vendors').select('*').eq('id', id).maybeSingle();
  if (error) throw httpError(500, 'Database error');
  return (data as VendorRow | null) ?? null;
}

export async function requireById(id: string): Promise<VendorRow> {
  const row = await findById(id);
  if (!row) throw httpError(404, 'Vendor not found');
  return row;
}

export async function listAll(): Promise<VendorRow[]> {
  const { data, error } = await db
    .from('vendors')
    .select('*')
    .order('company_name', { ascending: true });
  if (error) throw httpError(500, 'Database error');
  return (data as VendorRow[]) ?? [];
}

export async function create(payload: Partial<VendorRow>): Promise<VendorRow> {
  const { data, error } = await db.from('vendors').insert(payload).select().single();
  if (error) throw httpError(500, 'Database error');
  return data as VendorRow;
}

export async function updateById(id: string, patch: Partial<VendorRow>): Promise<VendorRow> {
  const { data, error } = await db.from('vendors').update(patch).eq('id', id).select().single();
  if (error) throw httpError(500, 'Database error');
  if (!data) throw httpError(404, 'Vendor not found');
  return data as VendorRow;
}

export async function deleteById(id: string): Promise<void> {
  const { error } = await db.from('vendors').delete().eq('id', id);
  if (error) throw httpError(500, 'Database error');
}
