#!/usr/bin/env node
// ============================================================
// BUILD CLOUDFLARE PAGES (Node.js - lintas platform)
// ------------------------------------------------------------
// Versi Node dari server/build-cloudflare.ps1 supaya bisa jalan
// di build environment Cloudflare Pages (Linux, tanpa PowerShell).
//
// Perbedaan dengan build:proxy:
//   - VITE_USE_LOCAL_PROXY = false  -> client memakai VITE_SUPABASE_URL
//   - VITE_STORAGE_DRIVER  = supabase (default) atau local
//       * supabase : foto dibaca dari Supabase Storage
//       * local    : foto disimpan di folder storage-data/ server proxy sendiri.
//                    Aktif bila VITE_STORAGE_PUBLIC_URL + VITE_STORAGE_API_URL
//                    diisi (mis. lewat Cloudflare Tunnel ke server proxy).
//
// Hasil: folder `dist-cloudflare/` siap di-upload ke Cloudflare Pages.
//
// Cara pakai:
//   npm run build:cloudflare
//
// Di Cloudflare Pages (Settings -> Build):
//   Build command : npm run build:cloudflare
//   Output dir    : dist-cloudflare
//   Env vars      : VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
//                   (+ VITE_STORAGE_PUBLIC_URL, VITE_STORAGE_API_URL bila pakai storage lokal)
// ============================================================

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');

const log = (msg = '') => console.log(msg);
const line = '='.repeat(60);

log(line);
log('  MEMBANGUN APLIKASI (MODE CLOUDFLARE PAGES)');
log(line);

// ------- 1. Baca .env sebagai sumber nilai (jika ada) -------
const envFile = join(projectDir, '.env');
if (existsSync(envFile)) {
  log('Membaca konfigurasi dari .env ...');
  const content = readFileSync(envFile, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // buang tanda kutip pembungkus
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // environment dari Cloudflare Pages menang atas .env
    if (!process.env[key]) process.env[key] = value;
  }
}

// ------- 2. Tentukan driver storage -------
// Mode default: Supabase Storage.
// Mode "local": foto disimpan di folder storage-data/ pada server proxy sendiri.
//   Aktif bila VITE_STORAGE_PUBLIC_URL (baca foto) dan VITE_STORAGE_API_URL
//   (upload/hapus) diisi, mis. lewat Cloudflare Tunnel ke server proxy.
process.env.VITE_USE_LOCAL_PROXY = 'false';

const storagePublicUrl = (process.env.VITE_STORAGE_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const storageApiUrl = (process.env.VITE_STORAGE_API_URL || '').trim().replace(/\/+$/, '');
const useLocalStorage = Boolean(storagePublicUrl && storageApiUrl);

if (useLocalStorage) {
  process.env.VITE_STORAGE_DRIVER = 'local';
  process.env.VITE_STORAGE_PUBLIC_URL = storagePublicUrl;
  process.env.VITE_STORAGE_API_URL = storageApiUrl;
  delete process.env.VITE_R2_PUBLIC_URL;
} else {
  process.env.VITE_STORAGE_DRIVER = 'supabase';
  delete process.env.VITE_STORAGE_API_URL;
  delete process.env.VITE_R2_PUBLIC_URL;
  delete process.env.VITE_STORAGE_PUBLIC_URL;
}

// ------- 3. Validasi konfigurasi -------
let missing = false;
if (!process.env.VITE_SUPABASE_URL) {
  console.error(
    'ERROR: VITE_SUPABASE_URL tidak ditemukan. Isi di .env atau environment Cloudflare Pages.'
  );
  missing = true;
}
if (!process.env.VITE_SUPABASE_ANON_KEY) {
  console.error(
    'ERROR: VITE_SUPABASE_ANON_KEY tidak ditemukan. Isi di .env atau environment Cloudflare Pages.'
  );
  missing = true;
}
if (useLocalStorage && !/^https?:\/\//i.test(storagePublicUrl)) {
  console.error(
    'ERROR: VITE_STORAGE_PUBLIC_URL harus berupa URL absolut, mis. https://foto.example.com'
  );
  missing = true;
}
if (useLocalStorage && !/^https?:\/\//i.test(storageApiUrl)) {
  console.error(
    'ERROR: VITE_STORAGE_API_URL harus berupa URL absolut, mis. https://foto.example.com/storage-api'
  );
  missing = true;
}
if (missing) process.exit(1);

log('');
log('  Mode build            : CLOUDFLARE PAGES (statis)');
log('  VITE_USE_LOCAL_PROXY  : false');
log(`  VITE_STORAGE_DRIVER   : ${process.env.VITE_STORAGE_DRIVER}`);
if (useLocalStorage) {
  log(`  VITE_STORAGE_PUBLIC_URL: ${storagePublicUrl}`);
  log(`  VITE_STORAGE_API_URL   : ${storageApiUrl}`);
}
log(`  VITE_SUPABASE_URL     : ${process.env.VITE_SUPABASE_URL}`);
log('  VITE_SUPABASE_ANON_KEY: (terisi, dibakar ke bundle)');
log('');

// ------- 4. Build ke folder terpisah -------
log('Menjalankan build ke dist-cloudflare ...');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(
  npmCmd,
  ['run', 'build', '--', '--outDir', 'dist-cloudflare', '--emptyOutDir'],
  { cwd: projectDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }
);

if (result.error) {
  console.error('ERROR: gagal menjalankan build:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`ERROR: Build gagal (exit code ${result.status}).`);
  process.exit(result.status ?? 1);
}

log('');
log(line);
log('  BUILD SELESAI. Upload folder dist-cloudflare/ ke Cloudflare Pages.');
log(line);
