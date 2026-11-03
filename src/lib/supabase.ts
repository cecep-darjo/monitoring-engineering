import { createClient } from '@supabase/supabase-js';

// Dua mode deploy:
// - Normal (internet): URL Supabase dibaca dari .env / VITE_SUPABASE_URL.
// - Local-proxy (LAN tanpa internet): VITE_USE_LOCAL_PROXY='true' saat build, sehingga
//   semua request memakai asal halaman (http://<IP-proxy>:<PORT>) dan diteruskan oleh
//   server/proxy-server.mjs ke Supabase asli. Flag ini dipakai (bukan mengosongkan
//   VITE_SUPABASE_URL) karena PowerShell menghapus env var yang di-set ke string kosong,
//   sehingga nilai dari file .env akan menang dan URL Supabase asli ikut ter-bundle.
const useLocalProxy = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

const supabaseUrl = useLocalProxy
  ? window.location.origin
  : rawUrl && rawUrl.trim()
    ? rawUrl.trim().replace(/\/+$/, '')
    : window.location.origin;

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Semua panggilan edge function harus memakai URL yang sama dengan client Supabase,
// supaya pada mode local-proxy ikut lewat proxy (bukan langsung ke Supabase).
export const FUNCTIONS_URL = `${supabaseUrl}/functions/v1`;

export { supabaseUrl };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const STORAGE_BUCKET = 'monitoring-photos';
