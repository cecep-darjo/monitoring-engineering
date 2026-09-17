import { createClient } from '@supabase/supabase-js';

// Empty VITE_SUPABASE_URL means "call whatever host served this page" — used for the
// local-proxy deployment, where a Node server on the same machine both serves the app
// and forwards Supabase API calls out to the internet on the technician's behalf.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || window.location.origin;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const STORAGE_BUCKET = 'monitoring-photos';
