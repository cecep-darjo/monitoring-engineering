import { supabase, STORAGE_BUCKET, useLocalProxy } from './supabase';

// ============================================================
// STORAGE ABSTRACTION
// ------------------------------------------------------------
// Satu pintu untuk upload / hapus / URL publik foto, supaya
// backend penyimpanan bisa diganti tanpa menyentuh halaman.
//
// Driver:
//   - 'supabase' (default): Supabase Storage bucket `monitoring-photos`.
//   - 'r2'                : Cloudflare R2 lewat Worker (presigned PUT/DELETE).
//   - 'local'             : disk di server lokal (proxy), disajikan lewat /photos/*.
//
// Tidak ada database tambahan yang dibutuhkan untuk driver 'local': metadata
// foto tetap di Supabase (tabel monitoring_photos / work_request_photos).
//
// Env (build-time, prefix VITE_):
//   VITE_STORAGE_DRIVER   = supabase | r2 | local
//   VITE_R2_PUBLIC_URL    = https://photos.example.com   (baca publik)
//   VITE_STORAGE_API_URL  = https://storage.example.workers.dev (upload/delete)
//   VITE_STORAGE_PUBLIC_URL = http://192.168.1.10:8000   (opsional, untuk driver local
//                             saat aplikasi tidak diakses lewat proxy yang sama)
//
// Pada mode local-proxy (LAN tanpa internet) URL selalu dibuat relatif ke
// origin proxy, lalu diteruskan oleh server/proxy-server.mjs:
//   /storage-api/* -> Worker   |   /photos/* -> R2 public
// ============================================================

const rawDriver = (import.meta.env.VITE_STORAGE_DRIVER as string | undefined)?.trim().toLowerCase();
const R2_PUBLIC_URL = ((import.meta.env.VITE_R2_PUBLIC_URL as string | undefined) || '').trim().replace(/\/+$/, '');
const STORAGE_API_URL = ((import.meta.env.VITE_STORAGE_API_URL as string | undefined) || '').trim().replace(/\/+$/, '');
const STORAGE_PUBLIC_URL = ((import.meta.env.VITE_STORAGE_PUBLIC_URL as string | undefined) || '').trim().replace(/\/+$/, '');

export type StorageDriver = 'supabase' | 'r2' | 'local';

// Driver 'local' hanya masuk akal bila aplikasi disajikan oleh proxy lokal
// (server/proxy-server.mjs), karena hanya proxy itu yang menyediakan
// /storage-api dan /photos. Pada deploy statis (mis. Cloudflare Pages) driver
// ini akan menghasilkan URL /photos/... yang 404, jadi kita jatuh ke Supabase.
const localDriverAllowed = useLocalProxy;

export const storageDriver: StorageDriver =
  rawDriver === 'r2'
    ? 'r2'
    : rawDriver === 'local'
      ? localDriverAllowed
        ? 'local'
        : 'supabase'
      : 'supabase';

if (rawDriver === 'local' && !localDriverAllowed) {
  console.warn(
    '[storage] VITE_STORAGE_DRIVER=local diabaikan karena aplikasi tidak berjalan ' +
      'dalam mode local-proxy. Memakai Supabase Storage. ' +
      'Untuk deploy statis (Cloudflare Pages) set VITE_STORAGE_DRIVER=supabase.',
  );
}

function apiBase(): string {
  if (useLocalProxy) return `${window.location.origin}/storage-api`;
  return STORAGE_API_URL || `${window.location.origin}/storage-api`;
}

function storageApiConfigured(): boolean {
  return storageDriver === 'local' ? true : useLocalProxy || Boolean(STORAGE_API_URL);
}

/** URL publik untuk sebuah object path (sama untuk foto monitoring & titipan). */
export function photoUrl(path: string): string {
  if (!path) return '';
  if (storageDriver === 'local') {
    const base = useLocalProxy ? window.location.origin : STORAGE_PUBLIC_URL || window.location.origin;
    return `${base}/photos/${path}`;
  }
  if (storageDriver === 'r2') {
    if (useLocalProxy) return `${window.location.origin}/photos/${path}`;
    if (!R2_PUBLIC_URL) {
      console.warn('[storage] VITE_R2_PUBLIC_URL belum diisi; foto tidak akan tampil.');
      return '';
    }
    return `${R2_PUBLIC_URL}/${path}`;
  }
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Upload satu file ke path tertentu. */
export async function uploadPhoto(path: string, file: File): Promise<{ error: string | null }> {
  if (storageDriver === 'supabase') {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file);
    return { error: error?.message ?? null };
  }

  const contentType = file.type || 'application/octet-stream';
  if (!storageApiConfigured()) {
    return { error: 'VITE_STORAGE_API_URL belum diisi. Upload foto tidak bisa dilakukan.' };
  }
  try {
    if (storageDriver === 'local') {
      const res = await fetch(`${apiBase()}/upload?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType, ...(await authHeaders()) },
        body: file,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return { error: body.error || `Upload gagal (${res.status})` };
      return { error: null };
    }

    const res = await fetch(`${apiBase()}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ path, contentType }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) {
      return { error: body.error || `Gagal meminta URL upload (${res.status})` };
    }

    const put = await fetch(body.url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    if (!put.ok) return { error: `Upload ke R2 gagal (${put.status})` };
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Upload gagal' };
  }
}

/** Hapus satu atau beberapa object sekaligus. */
export async function removePhoto(paths: string[]): Promise<{ error: string | null }> {
  const clean = paths.filter(Boolean);
  if (clean.length === 0) return { error: null };

  if (storageDriver === 'supabase') {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(clean);
    return { error: error?.message ?? null };
  }

  if (!storageApiConfigured()) {
    return { error: 'VITE_STORAGE_API_URL belum diisi. Hapus foto tidak bisa dilakukan.' };
  }

  try {
    const res = await fetch(`${apiBase()}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ paths: clean }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { error: body.error || `Gagal menghapus foto (${res.status})` };
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Gagal menghapus foto' };
  }
}
