import { supabase, useLocalProxy } from './supabase';

// ============================================================
// STORAGE - LOKAL SAJA
// ------------------------------------------------------------
// Foto hanya diunggah/disimpan di server lokal (folder storage-data/),
// disajikan lewat /photos/* dan dikelola lewat /storage-api/*.
// Supabase Storage sudah tidak dipakai lagi.
//
// Env (build-time, prefix VITE_):
//   VITE_STORAGE_PUBLIC_URL = https://foto.example.com             (baca foto: /photos/*)
//   VITE_STORAGE_API_URL    = https://foto.example.com/storage-api (upload/hapus)
//
// Saat aplikasi disajikan oleh proxy lokal (LAN, VITE_USE_LOCAL_PROXY=true),
// URL selalu relatif ke origin proxy (window.location.origin) lalu diteruskan
// oleh server/proxy-server.mjs.
// ============================================================

const STORAGE_API_URL = ((import.meta.env.VITE_STORAGE_API_URL as string | undefined) || '').trim().replace(/\/+$/, '');
const STORAGE_PUBLIC_URL = ((import.meta.env.VITE_STORAGE_PUBLIC_URL as string | undefined) || '').trim().replace(/\/+$/, '');

function apiBase(): string {
  if (useLocalProxy) return `${window.location.origin}/storage-api`;
  return STORAGE_API_URL || `${window.location.origin}/storage-api`;
}

function publicBase(): string {
  if (useLocalProxy) return window.location.origin;
  return STORAGE_PUBLIC_URL || window.location.origin;
}

/** URL publik untuk sebuah object path (sama untuk foto monitoring & titipan). */
export function photoUrl(path: string): string {
  if (!path) return '';
  return `${publicBase()}/photos/${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Upload satu file ke path tertentu (storage lokal). */
export async function uploadPhoto(path: string, file: File): Promise<{ error: string | null }> {
  const contentType = file.type || 'application/octet-stream';
  try {
    const res = await fetch(`${apiBase()}/upload?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, ...(await authHeaders()) },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { error: body.error || `Upload gagal (${res.status})` };
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Upload gagal' };
  }
}

/** Hapus satu atau beberapa object sekaligus (storage lokal). */
export async function removePhoto(paths: string[]): Promise<{ error: string | null }> {
  const clean = paths.filter(Boolean);
  if (clean.length === 0) return { error: null };

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
