import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

// Service-role client — bypasses RLS. Use only in trusted server code.
export const supabaseAdmin: SupabaseClient = createClient(
  env.supabase.url,
  env.supabase.serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Anon-key client for verifying user JWTs.
export const supabaseAnon: SupabaseClient = createClient(
  env.supabase.url,
  env.supabase.anonKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const STORAGE_BUCKET = env.supabase.storageBucket;
