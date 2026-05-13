import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env';

// Validation is performed by ../config/env.ts at module load — by the time
// we reach this createClient call we know the URL + anon key are present
// and well-formed.
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
