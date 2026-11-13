/**
 * MIGRASI STORAGE: Supabase Storage -> Cloudflare R2
 * ==================================================
 *
 * Menyalin SEMUA objek dari bucket Supabase Storage ke bucket R2 dengan
 * path yang identik, sehingga aplikasi tidak perlu mengubah data di database.
 *
 * Tidak butuh dependency tambahan selain `aws4fetch` (sudah dipakai Worker).
 *
 * Cara pakai (dari folder cloudflare/worker):
 *   1. npm install
 *   2. copy .env.migrate.example .env.migrate   (lalu isi nilainya)
 *   3. npm run migrate -- --dry-run             (lihat rencana, tidak menulis)
 *   4. npm run migrate                          (salin sungguhan)
 *
 * Opsi:
 *   --dry-run              hanya menampilkan daftar file
 *   --prefix=<folder>      batasi ke satu folder, mis. --prefix=work-requests
 *   --concurrency=<n>      jumlah transfer paralel (default 4)
 *   --skip-existing        lewati file yang sudah ada di R2 (HEAD 200)
 *   --limit=<n>            batasi jumlah file (untuk uji coba)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. Muat konfigurasi dari .env.migrate (jika ada). Env manual tetap menang.
// ---------------------------------------------------------------------------
const envFile = path.resolve(__dirname, '.env.migrate');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_BUCKET = (process.env.SUPABASE_BUCKET || 'monitoring-photos').trim();

const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || '').trim();
const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = (process.env.R2_BUCKET || 'monitoring-photos').trim();

// ---------------------------------------------------------------------------
// 2. Argumen CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const argValue = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DRY_RUN = hasFlag('dry-run');
const SKIP_EXISTING = hasFlag('skip-existing');
const PREFIX = argValue('prefix', '').replace(/^\/+|\/+$/g, '');
const CONCURRENCY = Math.max(1, Number(argValue('concurrency', '4')) || 4);
const LIMIT = Number(argValue('limit', '0')) || 0;

// ---------------------------------------------------------------------------
// 3. Validasi konfigurasi
// ---------------------------------------------------------------------------
const missing = [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY],
  ['R2_ACCOUNT_ID', R2_ACCOUNT_ID],
  ['R2_ACCESS_KEY_ID', R2_ACCESS_KEY_ID],
  ['R2_SECRET_ACCESS_KEY', R2_SECRET_ACCESS_KEY],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length > 0) {
  console.error(`[migrate] Konfigurasi belum lengkap: ${missing.join(', ')}`);
  console.error('[migrate] Isi file cloudflare/worker/.env.migrate (lihat .env.migrate.example).');
  process.exit(1);
}

if (SERVICE_KEY.startsWith('sb_publishable_')) {
  console.error('[migrate] SUPABASE_SERVICE_ROLE_KEY berisi PUBLISHABLE key, bukan service role key.');
  console.error('[migrate] Semua bucket akan terlihat kosong karena RLS.');
  console.error('[migrate] Gunakan sb_secret_... (Project Settings -> API Keys -> Secret keys)');
  console.error('[migrate] atau JWT service_role legacy (eyJ...).');
  process.exit(1);
}

let aws = null;

const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// ---------------------------------------------------------------------------
// 4. Helper
// ---------------------------------------------------------------------------
const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
};

function contentTypeFor(key) {
  return MIME[path.extname(key).toLowerCase()] || 'application/octet-stream';
}

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function r2ObjectUrl(key) {
  return `${R2_ENDPOINT}/${R2_BUCKET}/${encodeKey(key)}`;
}

function supabaseHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
}

/** Daftar isi satu folder (paginated, 100 per halaman). */
async function listFolder(prefix) {
  const items = [];
  const pageSize = 100;
  let offset = 0;

  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${SUPABASE_BUCKET}`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit: pageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`List "${prefix || '/'}" gagal (${res.status}): ${detail.slice(0, 300)}`);
    }

    const page = await res.json();
    items.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return items;
}

/** Telusuri bucket secara rekursif -> daftar path file. */
async function walk(prefix, out = []) {
  const items = await listFolder(prefix);
  for (const item of items) {
    const key = prefix ? `${prefix}/${item.name}` : item.name;
    // Folder ditandai dengan id === null pada Supabase Storage API.
    if (item.id === null || item.id === undefined) {
      await walk(key, out);
    } else {
      out.push(key);
    }
  }
  return out;
}

async function downloadFromSupabase(key) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${encodeKey(key)}`, {
    headers: supabaseHeaders(),
  });
  if (!res.ok) throw new Error(`Download gagal (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function existsInR2(key) {
  const signed = await aws.sign(r2ObjectUrl(key), { method: 'HEAD', aws: { signQuery: true } });
  const res = await fetch(signed.url, { method: 'HEAD' });
  return res.ok;
}

async function uploadToR2(key, bytes) {
  const contentType = contentTypeFor(key);
  const signed = await aws.sign(r2ObjectUrl(key), {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    aws: { signQuery: true },
  });
  const res = await fetch(signed.url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Upload gagal (${res.status}): ${detail.slice(0, 200)}`);
  }
}

/** Jalankan tugas async dengan batas paralel. */
async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------
async function main() {
  let AwsClient;
  try {
    ({ AwsClient } = await import('aws4fetch'));
  } catch {
    console.error('[migrate] Dependency "aws4fetch" belum terpasang.');
    console.error('[migrate] Jalankan dulu:  cd cloudflare/worker && npm install');
    process.exit(1);
  }

  aws = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });

  console.log('============================================================');
  console.log('  MIGRASI STORAGE: Supabase -> Cloudflare R2');
  console.log('============================================================');
  console.log(`  Supabase : ${SUPABASE_URL}`);
  console.log(`  Bucket   : ${SUPABASE_BUCKET}  ->  R2: ${R2_BUCKET}`);
  console.log(`  Prefix   : ${PREFIX || '(seluruh bucket)'}`);
  console.log(`  Mode     : ${DRY_RUN ? 'DRY RUN (tidak menulis)' : 'SALIN SUNGGUHAN'}`);
  console.log(`  Paralel  : ${CONCURRENCY}`);
  console.log('------------------------------------------------------------');

  console.log('[1/3] Mendaftar objek di Supabase Storage ...');
  let keys = await walk(PREFIX);
  if (LIMIT > 0) keys = keys.slice(0, LIMIT);
  console.log(`      Ditemukan ${keys.length} objek.`);

  if (keys.length === 0) {
    console.log('[migrate] Tidak ada objek untuk disalin. Selesai.');
    return;
  }

  if (DRY_RUN) {
    for (const key of keys.slice(0, 50)) console.log(`      - ${key}`);
    if (keys.length > 50) console.log(`      ... dan ${keys.length - 50} objek lainnya`);
    console.log('[migrate] DRY RUN selesai. Jalankan tanpa --dry-run untuk menyalin.');
    return;
  }

  console.log('[2/3] Menyalin objek ...');
  let copied = 0;
  let skipped = 0;
  let totalBytes = 0;
  const failures = [];

  await pool(keys, CONCURRENCY, async (key, index) => {
    try {
      if (SKIP_EXISTING && (await existsInR2(key))) {
        skipped++;
        return;
      }
      const bytes = await downloadFromSupabase(key);
      await uploadToR2(key, bytes);
      copied++;
      totalBytes += bytes.byteLength;
      if ((copied + skipped) % 25 === 0 || copied + skipped === keys.length) {
        console.log(`      ${copied + skipped}/${keys.length} (${formatBytes(totalBytes)})`);
      }
    } catch (err) {
      failures.push({ key, error: err instanceof Error ? err.message : String(err) });
      console.error(`      [GAGAL] ${key}: ${failures[failures.length - 1].error}`);
    }
  });

  console.log('[3/3] Ringkasan');
  console.log('------------------------------------------------------------');
  console.log(`  Disalin   : ${copied}`);
  console.log(`  Dilewati  : ${skipped}`);
  console.log(`  Gagal     : ${failures.length}`);
  console.log(`  Total data: ${formatBytes(totalBytes)}`);
  if (failures.length > 0) {
    console.log('  Daftar gagal:');
    for (const f of failures) console.log(`    - ${f.key} :: ${f.error}`);
    process.exitCode = 1;
  } else {
    console.log('  Semua objek berhasil disalin.');
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
