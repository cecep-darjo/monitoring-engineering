/**
 * MIGRASI STORAGE: Supabase Storage -> DISK LOKAL
 * ==============================================
 *
 * Menyalin SEMUA objek dari bucket Supabase Storage ke folder lokal
 * (default: storage-data/) dengan path yang identik. Tidak butuh PostgreSQL,
 * tidak butuh Cloudflare, dan tidak butuh dependency npm apa pun.
 *
 * Cara pakai (dari folder proyek):
 *   1. copy server\.env.migrate.example server\.env.migrate   (lalu isi nilainya)
 *   2. node server\migrate-storage-local.mjs --dry-run
 *   3. node server\migrate-storage-local.mjs
 *
 * Opsi:
 *   --dry-run              hanya menampilkan daftar file
 *   --from-bucket          telusuri bucket (lambat untuk ribuan folder);
 *                          default: baca storage_path dari tabel database
 *   --prefix=<folder>      batasi ke satu folder, mis. --prefix=work-requests
 *   --limit=<n>            batasi jumlah file (untuk uji coba)
 *   --skip-existing        lewati file yang sudah ada di disk
 *   --concurrency=<n>      jumlah transfer paralel (default 4)
 *
 * Catatan: daftar path diambil dari tabel `monitoring_photos` dan
 * `work_request_photos`. Objek yang ada di bucket tetapi tidak tercatat di
 * database tidak akan tersalin; gunakan --from-bucket untuk menyapu seluruh
 * isi bucket.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. Muat konfigurasi dari server/.env.migrate (jika ada). Env manual menang.
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
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(__dirname, '..', 'storage-data');

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
const FROM_BUCKET = hasFlag('from-bucket');
const PREFIX = argValue('prefix', '').replace(/^\/+|\/+$/g, '');
const CONCURRENCY = Math.max(1, Number(argValue('concurrency', '4')) || 4);
const LIMIT = Number(argValue('limit', '0')) || 0;

// ---------------------------------------------------------------------------
// 3. Validasi
// ---------------------------------------------------------------------------
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[migrate] SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi.');
  console.error('[migrate] Salin server/.env.migrate.example menjadi server/.env.migrate lalu isi.');
  process.exit(1);
}

// Kunci publishable/anon hanya bisa membaca data publik dan akan terlihat
// seperti "bucket kosong" karena RLS menyaring semuanya. Tolak lebih awal.
if (SERVICE_KEY.startsWith('sb_publishable_')) {
  console.error('[migrate] SUPABASE_SERVICE_ROLE_KEY berisi PUBLISHABLE key, bukan service role key.');
  console.error('[migrate] Akibatnya semua bucket terlihat kosong karena RLS.');
  console.error('[migrate] Ambil kunci yang benar di Supabase Dashboard:');
  console.error('[migrate]   Project Settings -> API Keys -> Secret keys  (sb_secret_...)');
  console.error('[migrate]   atau legacy: Project Settings -> API -> service_role (JWT eyJ...)');
  process.exit(1);
}

if (!SERVICE_KEY.startsWith('sb_secret_') && !SERVICE_KEY.startsWith('eyJ')) {
  console.warn('[migrate] Peringatan: format kunci tidak dikenali (diharapkan sb_secret_... atau eyJ...).');
  console.warn('[migrate] Lanjut, tetapi jika hasilnya 0 objek, periksa jenis kunci.');
}

// ---------------------------------------------------------------------------
// 4. Helper
// ---------------------------------------------------------------------------
function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function supabaseHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

/** Pastikan path hasil gabungan tetap berada di dalam STORAGE_DIR. */
function resolveLocalPath(key) {
  const cleaned = key.replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0') || cleaned.includes('\\') || cleaned.includes('..')) return null;
  const absolute = path.resolve(STORAGE_DIR, cleaned);
  const relative = path.relative(STORAGE_DIR, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return absolute;
}

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

async function walk(prefix, out = []) {
  const items = await listFolder(prefix);
  for (const item of items) {
    const key = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null || item.id === undefined) {
      await walk(key, out);
    } else {
      out.push(key);
    }
  }
  return out;
}

/**
 * Ambil semua storage_path dari tabel database (jauh lebih cepat daripada
 * menelusuri bucket folder demi folder). Tabel yang tidak ada dilewati.
 */
async function listFromDatabase() {
  const tables = ['monitoring_photos', 'work_request_photos'];
  const paths = new Set();
  const pageSize = 1000;

  for (const table of tables) {
    let offset = 0;
    for (;;) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?select=storage_path&order=storage_path.asc`,
        {
          headers: {
            ...supabaseHeaders(),
            Range: `${offset}-${offset + pageSize - 1}`,
            'Range-Unit': 'items',
          },
        },
      );

      if (res.status === 404) {
        console.log(`      (tabel ${table} tidak ada, dilewati)`);
        break;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Query ${table} gagal (${res.status}): ${detail.slice(0, 200)}`);
      }

      const rows = await res.json();
      for (const row of rows) {
        if (row?.storage_path) paths.add(String(row.storage_path).replace(/^\/+/, ''));
      }
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  return [...paths];
}

async function downloadFromSupabase(key) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${encodeKey(key)}`, {
    headers: supabaseHeaders(),
  });
  if (!res.ok) throw new Error(`Download gagal (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

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
  console.log('============================================================');
  console.log('  MIGRASI STORAGE: Supabase -> DISK LOKAL');
  console.log('============================================================');
  console.log(`  Supabase   : ${SUPABASE_URL}`);
  console.log(`  Bucket     : ${SUPABASE_BUCKET}`);
  console.log(`  Tujuan     : ${STORAGE_DIR}`);
  console.log(`  Prefix     : ${PREFIX || '(seluruh bucket)'}`);
  console.log(`  Mode       : ${DRY_RUN ? 'DRY RUN (tidak menulis)' : 'SALIN SUNGGUHAN'}`);
  console.log(`  Paralel    : ${CONCURRENCY}`);
  console.log('------------------------------------------------------------');

  console.log(`[1/3] Mendaftar objek (${FROM_BUCKET ? 'menelusuri bucket' : 'dari database'}) ...`);
  let keys = FROM_BUCKET ? await walk(PREFIX) : await listFromDatabase();
  if (PREFIX) keys = keys.filter((k) => k === PREFIX || k.startsWith(`${PREFIX}/`));
  if (LIMIT > 0) keys = keys.slice(0, LIMIT);
  console.log(`      Ditemukan ${keys.length} objek.`);

  if (keys.length === 0) {
    const bucketsRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers: supabaseHeaders() }).catch(() => null);
    const buckets = bucketsRes && bucketsRes.ok ? await bucketsRes.json().catch(() => null) : null;

    if (Array.isArray(buckets) && buckets.length === 0) {
      console.error('[migrate] Tidak ada bucket yang terlihat. Kemungkinan besar kunci yang dipakai');
      console.error('[migrate] bukan service role key (RLS menyembunyikan semua bucket).');
      console.error('[migrate] Periksa SUPABASE_SERVICE_ROLE_KEY di server/.env.migrate.');
      process.exitCode = 1;
      return;
    }

    const names = Array.isArray(buckets) ? buckets.map((b) => b.name || b.id) : [];
    if (names.length > 0 && !names.includes(SUPABASE_BUCKET)) {
      console.error(`[migrate] Bucket "${SUPABASE_BUCKET}" tidak ditemukan.`);
      console.error(`[migrate] Bucket yang tersedia: ${names.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    console.log('[migrate] Tidak ada objek untuk disalin. Selesai.');
    return;
  }

  if (DRY_RUN) {
    for (const key of keys.slice(0, 50)) console.log(`      - ${key}`);
    if (keys.length > 50) console.log(`      ... dan ${keys.length - 50} objek lainnya`);
    console.log('[migrate] DRY RUN selesai. Jalankan tanpa --dry-run untuk menyalin.');
    return;
  }

  fs.mkdirSync(STORAGE_DIR, { recursive: true });

  console.log('[2/3] Menyalin objek ...');
  let copied = 0;
  let skipped = 0;
  let totalBytes = 0;
  const failures = [];

  await pool(keys, CONCURRENCY, async (key) => {
    try {
      const target = resolveLocalPath(key);
      if (!target) throw new Error('Path tidak valid');

      if (SKIP_EXISTING && fs.existsSync(target)) {
        skipped++;
        return;
      }

      const bytes = await downloadFromSupabase(key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      copied++;
      totalBytes += bytes.length;
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
    console.log('  Semua objek berhasil disalin ke disk lokal.');
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
