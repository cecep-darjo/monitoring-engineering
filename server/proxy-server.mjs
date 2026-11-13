/**
 * EQUIPMENT MONITOR - LOCAL PROXY SERVER
 * ======================================
 *
 * Menyajikan aplikasi build React (folder `dist`) dan meneruskan semua request
 * Supabase (REST / Auth / Storage / Edge Functions) dari komputer lokal yang
 * memiliki akses internet ke backend Supabase via internet.
 *
 * Komputer lain di jaringan lokal yang TIDAK punya akses internet cukup membuka
 * `http://<IP-komputer-proxy>:<PORT>` di browser. Supabase client dibangun dengan
 * `supabaseUrl = window.location.origin`, sehingga semua request API mengarah ke
 * proxy ini, lalu proxy meneruskannya keluar.
 *
 * Proses pejalanan: `node server/proxy-server.mjs` (lihat README_PROXY.md)
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Argumen CLI (menimpa nilai dari .env.local-proxy).
// Berguna untuk menjalankan DUA instance dari satu file konfigurasi:
//   node server/proxy-server.mjs --port=8000 --role=app    (aplikasi untuk LAN)
//   node server/proxy-server.mjs --port=8001 --role=foto   (khusus tunnel)
//
// Opsi:
//   --port=<n>          port yang didengarkan
//   --role=app          mode bridge aplikasi (APP_UPSTREAM_URL dipakai)
//   --role=foto         mode foto saja (hanya /photos/* dan /storage-api/*)
//   --role=static       menyajikan folder dist/ lokal
//   --upstream=<url>    paksa URL upstream aplikasi
//   --no-upstream       matikan mode bridge walau APP_UPSTREAM_URL terisi
// ---------------------------------------------------------------------------
const CLI = { port: null, role: null, upstream: undefined };

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--port=')) {
    const n = parseInt(arg.slice('--port='.length), 10);
    if (Number.isFinite(n) && n > 0) CLI.port = n;
  } else if (arg.startsWith('--role=')) {
    const r = arg.slice('--role='.length).trim().toLowerCase();
    if (['app', 'foto', 'static'].includes(r)) CLI.role = r;
  } else if (arg.startsWith('--upstream=')) {
    CLI.upstream = arg.slice('--upstream='.length).trim();
  } else if (arg === '--no-upstream') {
    CLI.upstream = '';
  }
}

// ---------------------------------------------------------------------------
// AUTO-LOAD konfigurasi dari .env.local-proxy (jika ada) di root project.
// Memudahkan menjalankan proxy tanpa set env manual. Env manual tetap menang.
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(__dirname, '..', '.env.local-proxy');
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8');
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Terapkan argumen CLI ke process.env sebelum konfigurasi dibaca.
// ---------------------------------------------------------------------------
if (CLI.port !== null) process.env.PORT = String(CLI.port);
if (CLI.upstream !== undefined) process.env.APP_UPSTREAM_URL = CLI.upstream;
if (CLI.role === 'app') {
  process.env.STORAGE_ONLY = 'false';
  if (CLI.upstream === undefined) {
    // Pastikan mode bridge aktif; pakai default Pages bila belum diisi.
    if (!(process.env.APP_UPSTREAM_URL || '').trim()) {
      process.env.APP_UPSTREAM_URL = 'https://monitoreng.pages.dev';
    }
  }
} else if (CLI.role === 'foto') {
  process.env.STORAGE_ONLY = 'true';
  process.env.APP_UPSTREAM_URL = '';
} else if (CLI.role === 'static') {
  process.env.STORAGE_ONLY = 'false';
  process.env.APP_UPSTREAM_URL = '';
}

// ---------------------------------------------------------------------------
// KONFIGURASI (via environment variables)
// ---------------------------------------------------------------------------
const HOST = process.env.HOST || '0.0.0.0';               // 0.0.0.0 = bisa diakses dari LAN
const PORT = parseInt(process.env.PORT || '8000', 10);    // port proxy (default 8000)
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const ANON_KEY = (process.env.ANON_KEY || '').trim();     // Supabase anon key (untuk fallback header)
const STATIC_DIR = process.env.STATIC_DIR || path.resolve(__dirname, '..', 'dist');

// Storage di Cloudflare (opsional). Jika diisi, proxy meneruskan:
//   /storage-api/* -> Worker (upload/delete)   |   /photos/* -> R2 public (baca)
const STORAGE_API_URL = (process.env.STORAGE_API_URL || '').trim().replace(/\/+$/, '');
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');

// Storage lokal di komputer proxy (tanpa Cloudflare, tanpa PostgreSQL).
//   STORAGE_DRIVER=local  -> file disimpan di STORAGE_DIR dan disajikan lewat /photos/*
//   STORAGE_DRIVER=supabase (default) -> tidak dipakai proxy; browser ke Supabase Storage
//   STORAGE_DRIVER=r2 -> proxy meneruskan ke STORAGE_API_URL / R2_PUBLIC_URL
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || 'supabase').trim().toLowerCase();
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(__dirname, '..', 'storage-data');
const STORAGE_MAX_BYTES = parseInt(process.env.STORAGE_MAX_BYTES || '5242880', 10); // 5 MB default
const STORAGE_REQUIRE_AUTH = (process.env.STORAGE_REQUIRE_AUTH || 'true').trim().toLowerCase() !== 'false';

// Origin yang diizinkan mengakses proxy dari browser (CORS).
//   '*'  -> semua origin (default, cocok untuk uji coba)
//   'https://monitoreng.pages.dev' -> hanya aplikasi produksi
// Bisa berisi beberapa origin dipisah koma.
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '*').trim();
const ALLOWED_ORIGIN_LIST = ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

// Bila true, proxy HANYA melayani /photos/* dan /storage-api/*.
// Pakai ini saat proxy diekspos ke internet (mis. Cloudflare Tunnel) hanya
// untuk foto, supaya file statis aplikasi dan proxy API Supabase tidak ikut
// terbuka. Default false (perilaku lama: semua path dilayani).
const STORAGE_ONLY = (process.env.STORAGE_ONLY || 'false').trim().toLowerCase() === 'true';

// Mode "bridge": proxy meneruskan SEMUA request non-storage ke aplikasi
// upstream (mis. https://monitoreng.pages.dev). Dengan ini komputer lain di
// LAN bisa membuka aplikasi lewat PC ini, tanpa perlu build lokal.
// Kosongkan untuk menyajikan folder dist/ lokal (mode build:proxy).
const APP_UPSTREAM_URL = (process.env.APP_UPSTREAM_URL || '').trim().replace(/\/+$/, '');

// Daftar URL absolut yang ditulis ulang menjadi origin proxy saat mode bridge.
// Tujuannya agar browser klien hanya menghubungi PC ini (bukan internet):
//   "https://xxx.supabase.co"        -> window.location.origin
//   "https://foto.woeng.my.id"       -> window.location.origin
//   "https://foto.woeng.my.id/storage-api" -> window.location.origin+"/storage-api"
// Isi lewat env BRIDGE_REWRITE (dipisah koma). Default: SUPABASE_URL.
const BRIDGE_REWRITE = (process.env.BRIDGE_REWRITE || SUPABASE_URL || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

function corsOriginFor(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (ALLOWED_ORIGIN_LIST.includes('*')) return origin;
  return ALLOWED_ORIGIN_LIST.includes(origin) ? origin : null;
}

function applyCors(req, res) {
  const allowed = corsOriginFor(req);
  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
}

if (!SUPABASE_URL) {
  console.error('[proxy] ERROR: Environment variable SUPABASE_URL wajib diisi.');
  console.error('[proxy] Contoh (PowerShell):');
  console.error('[proxy]   $env:SUPABASE_URL="https://xxxx.supabase.co"');
  console.error('[proxy]   $env:ANON_KEY="eyJhbGciOi..."  # wajib jika ingin fallback header');
  process.exit(1);
}

// Target backend: pisahkan host + path prefix dari URL Supabase.
const backend = new URL(SUPABASE_URL);
const BACKEND_HOST = backend.host;                 // e.g. abc.supabase.co
const BACKEND_PATH = backend.pathname.replace(/\/+$/, ''); // e.g. "" atau "/project"
const BACKEND_HTTPS = backend.protocol === 'https:';

// ---------------------------------------------------------------------------
// Utility: kirim request ke backend, streaming, teruskan header penting.
// ---------------------------------------------------------------------------
function forward(req, res, targetUrl) {
  const headers = Object.assign({}, req.headers);
  headers.host = BACKEND_HOST;

  // Fallback: request tanpa header apikey/Authorization (mis. <img> public object).
  // Dengan header anon bawaan, objek storage/public dan endpoint publik tetap jalan.
  if (ANON_KEY) {
    if (!headers.apikey) headers.apikey = ANON_KEY;
    if (!headers.authorization && !req.path?.startsWith('/auth/v1')) {
      headers.authorization = `Bearer ${ANON_KEY}`;
    }
  }

  const target = new URL(`${BACKEND_PATH}${targetUrl}`, `${BACKEND_HTTPS ? 'https' : 'http'}://${BACKEND_HOST}`);
  const httpMod = BACKEND_HTTPS ? https : http;

  const proxyReq = httpMod.request(
    target,
    {
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const outHeaders = Object.assign({}, proxyRes.headers);

      // Tulis ulang header `location` (redirect) yang menunjuk ke host Supabase asli
      // menjadi path relatif di proxy, agar komputer tanpa internet bisa mengikutinya.
      if (outHeaders.location && SUPABASE_URL) {
        try {
          const loc = new URL(outHeaders.location);
          if (loc.host === BACKEND_HOST) {
            outHeaders.location = loc.pathname + loc.search + loc.hash;
          }
        } catch {
          /* biarkan apa adanya */
        }
      }

      // Hapus atribut Domain= pada set-cookie agar cookie berlaku untuk host proxy
      // (host-only), bukan host Supabase asli yang tak terjangkau komputer lain.
      if (outHeaders['set-cookie']) {
        outHeaders['set-cookie'] = outHeaders['set-cookie'].map((c) =>
          c.replace(/;\s*Domain=[^;]+/i, ''),
        );
      }

      res.writeHead(proxyRes.statusCode || 502, outHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Backend error untuk ${req.method} ${targetUrl}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Proxy backend error: ${err.message}` }));
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

// ---------------------------------------------------------------------------
// Utility: tulis ulang URL absolut di dalam teks (JS/HTML/CSS) menjadi origin
// proxy, supaya klien LAN tidak perlu akses internet langsung.
// ---------------------------------------------------------------------------
function rewriteOrigins(text) {
  if (!BRIDGE_REWRITE.length) return text;
  // Panjang dulu supaya "https://host/path" diproses sebelum "https://host".
  const sorted = [...BRIDGE_REWRITE].sort((a, b) => b.length - a.length);

  // Cocokkan string berkutip berisi URL absolut, mis.
  //   "https://foto.woeng.my.id/storage-api"  -> window.location.origin+"/storage-api"
  //   'https://xxx.supabase.co'               -> window.location.origin
  return text.replace(/(["'`])(https?:\/\/[^"'`\s\\]+)\1/g, (full, _quote, url) => {
    for (const origin of sorted) {
      if (url === origin) return 'window.location.origin';
      if (url.startsWith(origin + '/')) {
        const rest = url.slice(origin.length);
        return `window.location.origin+${JSON.stringify(rest)}`;
      }
    }
    return full;
  });
}

function isTextual(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return (
    ct.includes('javascript') ||
    ct.includes('ecmascript') ||
    ct.includes('text/html') ||
    ct.includes('text/css') ||
    ct.includes('application/json')
  );
}

// ---------------------------------------------------------------------------
// Utility: teruskan request ke URL absolut (dipakai untuk /storage-api,
// /photos (mode r2), dan APP_UPSTREAM_URL).
// ---------------------------------------------------------------------------
function forwardTo(req, res, baseUrl, pathAndQuery) {
  if (!baseUrl) {
    return sendJson(res, 503, { error: 'Target upstream belum dikonfigurasi' });
  }

  let target;
  try {
    target = new URL(pathAndQuery || '/', baseUrl.replace(/\/+$/, '') + '/');
  } catch (err) {
    return sendJson(res, 502, { error: `URL upstream tidak valid: ${err.message}` });
  }

  const isHttps = target.protocol === 'https:';
  const httpMod = isHttps ? https : http;

  const headers = Object.assign({}, req.headers);
  headers.host = target.host;
  // Biarkan upstream/CDN menentukan kompresi.
  delete headers['accept-encoding'];

  const proxyReq = httpMod.request(
    target,
    { method: req.method, headers },
    (proxyRes) => {
      const outHeaders = Object.assign({}, proxyRes.headers);
      const contentType = outHeaders['content-type'] || '';
      const shouldRewrite =
        BRIDGE_REWRITE.length > 0 &&
        isTextual(contentType) &&
        (req.method === 'GET' || req.method === 'HEAD');

      if (!shouldRewrite) {
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        proxyRes.pipe(res);
        return;
      }

      // Buffer lalu tulis ulang URL absolut -> origin proxy.
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        body = rewriteOrigins(body);
        const buf = Buffer.from(body, 'utf8');
        delete outHeaders['content-encoding'];
        delete outHeaders['transfer-encoding'];
        outHeaders['content-length'] = String(buf.length);
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        res.end(req.method === 'HEAD' ? undefined : buf);
      });
      proxyRes.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
    },
  );

  proxyReq.setTimeout(30000, () => {
    proxyReq.destroy(new Error('Upstream timeout (30s)'));
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Upstream error untuk ${req.method} ${target.href}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><body style="font-family:system-ui;padding:2rem">` +
          `<h2>Tidak bisa menghubungi aplikasi upstream</h2>` +
          `<p><code>${target.href}</code></p>` +
          `<p style="color:#b00">${err.message}</p>` +
          `<p>Pastikan komputer ini terhubung ke internet.</p>` +
          `</body></html>`,
      );
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

// ---------------------------------------------------------------------------
// Utility: storage lokal (disk). Pengganti Supabase Storage / R2.
// ---------------------------------------------------------------------------
const STORAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** Ubah path relatif objek menjadi path absolut di dalam STORAGE_DIR. */
function resolveStoragePath(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const cleaned = rawPath.trim().replace(/^\/+/, '');
  if (!cleaned || cleaned.length > 512) return null;
  if (cleaned.includes('\0') || cleaned.includes('\\') || cleaned.includes('..')) return null;
  const absolute = path.resolve(STORAGE_DIR, cleaned);
  const relative = path.relative(STORAGE_DIR, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return absolute;
}

/** Verifikasi token Supabase. Mengembalikan true bila valid / auth dimatikan. */
async function verifySupabaseToken(req) {
  if (!STORAGE_REQUIRE_AUTH) return true;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  if (!SUPABASE_URL) return false;
  try {
    const upstream = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: ANON_KEY },
    });
    return upstream.ok;
  } catch (err) {
    console.error('[storage] Gagal verifikasi token:', err.message);
    return false;
  }
}

/** Baca body request ke Buffer dengan batas ukuran. */
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error(`Ukuran file melebihi batas ${Math.round(limitBytes / 1024 / 1024)} MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleLocalUpload(req, res) {
  if (!(await verifySupabaseToken(req))) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  const target = new URL(req.url, 'http://localhost');
  const objectPath = target.searchParams.get('path') || '';
  const absolute = resolveStoragePath(objectPath);
  if (!absolute) return sendJson(res, 400, { error: 'Path tidak valid' });

  let body;
  try {
    body = await readBody(req, STORAGE_MAX_BYTES);
  } catch (err) {
    return sendJson(res, 413, { error: err.message });
  }
  if (body.length === 0) return sendJson(res, 400, { error: 'File kosong' });

  try {
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, body);
  } catch (err) {
    console.error('[storage] Gagal menulis file:', err.message);
    return sendJson(res, 500, { error: 'Gagal menyimpan file' });
  }

  return sendJson(res, 200, { success: true, path: objectPath.replace(/^\/+/, ''), size: body.length });
}

async function handleLocalDelete(req, res) {
  if (!(await verifySupabaseToken(req))) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
  } catch {
    return sendJson(res, 400, { error: 'Body JSON tidak valid' });
  }

  const paths = Array.isArray(payload?.paths) ? payload.paths : [];
  const targets = paths.map(resolveStoragePath).filter(Boolean);
  if (targets.length === 0) return sendJson(res, 400, { error: 'Tidak ada path valid' });

  const failed = [];
  for (const absolute of targets) {
    try {
      await fs.promises.unlink(absolute);
    } catch (err) {
      if (err.code !== 'ENOENT') failed.push({ path: absolute, error: err.message });
    }
  }

  if (failed.length > 0) return sendJson(res, 500, { error: 'Sebagian file gagal dihapus', failed });
  return sendJson(res, 200, { success: true, deleted: targets.length });
}

function serveLocalPhoto(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const objectPath = decodeURIComponent(urlPath.slice('/photos/'.length));
  const absolute = resolveStoragePath(objectPath);
  if (!absolute) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  fs.stat(absolute, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(absolute).toLowerCase();
    res.writeHead(200, {
      'Content-Type': STORAGE_MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(absolute).pipe(res);
  });
}

// ---------------------------------------------------------------------------
// Utility: sajikan file statis.
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  // Cegah path traversal.
  if (urlPath.includes('\0') || urlPath.includes('..')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  // Default ke index.html.
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  let filePath = path.join(STATIC_DIR, path.normalize(urlPath));
  // Folder index.
  if (filePath.endsWith(path.sep)) filePath = path.join(filePath, 'index.html');

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA fallback -> index.html (untuk path non-file).
    const indexFile = path.join(STATIC_DIR, 'index.html');
    fs.stat(indexFile, (e2, s2) => {
      if (!e2 && s2.isFile()) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        fs.createReadStream(indexFile).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Server utama
// ---------------------------------------------------------------------------
if (STORAGE_DRIVER === 'local') {
  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  } catch (err) {
    console.error(`[storage] Gagal membuat folder ${STORAGE_DIR}:`, err.message);
    process.exit(1);
  }
}

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  req.path = urlPath;

  // Pasang header CORS untuk semua respons (termasuk respons non-preflight),
  // supaya aplikasi statis di origin lain (mis. Cloudflare Pages) bisa
  // membaca respons upload/hapus dan memuat foto.
  applyCors(req, res);

  // Jawab langsung preflight CORS (untuk skenario dev lintas-origin).
  if (req.method === 'OPTIONS') {
    const allowed = corsOriginFor(req);
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowed || req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  // Mode khusus foto: tolak semua path selain /photos/* dan /storage-api/*.
  // Diabaikan otomatis bila APP_UPSTREAM_URL diisi (mode bridge aplikasi).
  if (
    STORAGE_ONLY &&
    !APP_UPSTREAM_URL &&
    !urlPath.startsWith('/photos/') &&
    !urlPath.startsWith('/storage-api/')
  ) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Route ke backend Supabase untuk path API. Teruskan seluruh req.url
  // (termasuk query string) agar filter & select PostgREST tetap bekerja.
  if (urlPath.startsWith('/storage-api/')) {
    if (STORAGE_DRIVER === 'local') {
      if (urlPath === '/storage-api/upload') return handleLocalUpload(req, res);
      if (urlPath === '/storage-api/delete') return handleLocalDelete(req, res);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (!STORAGE_API_URL) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'STORAGE_API_URL belum dikonfigurasi di .env.local-proxy' }));
      return;
    }
    return forwardTo(req, res, STORAGE_API_URL, req.url.slice('/storage-api'.length));
  }

  if (urlPath.startsWith('/photos/')) {
    if (STORAGE_DRIVER === 'local') {
      return serveLocalPhoto(req, res, urlPath);
    }
    if (!R2_PUBLIC_URL) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'R2_PUBLIC_URL belum dikonfigurasi di .env.local-proxy' }));
      return;
    }
    return forwardTo(req, res, R2_PUBLIC_URL, req.url.slice('/photos'.length));
  }

  if (
    urlPath.startsWith('/rest/v1') ||
    urlPath.startsWith('/auth/v1') ||
    urlPath.startsWith('/storage/v1') ||
    urlPath.startsWith('/functions/v1')
  ) {
    return forward(req, res, req.url);
  }

  // Mode bridge: teruskan semua request lain (HTML, JS, CSS, asset) ke
  // aplikasi upstream. Ini membuat PC ini menjadi "jembatan internet" bagi
  // komputer lain di LAN untuk membuka aplikasi Pages.
  if (APP_UPSTREAM_URL) {
    return forwardTo(req, res, APP_UPSTREAM_URL, req.url);
  }

  // Segala sesuatu yang lain: file statis aplikasi.
  return serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log('==========================================================');
  console.log('  EQUIPMENT MONITOR - LOCAL PROXY SERVER');
  console.log('==========================================================');
  console.log(`  Static dir  : ${STATIC_DIR}`);
  console.log(`  Supabase    : ${SUPABASE_URL}`);
  console.log(`  Storage     : ${STORAGE_DRIVER}${STORAGE_DRIVER === 'local' ? ` (${STORAGE_DIR})` : ''}`);
  console.log(`  Proxy listen: http://${HOST}:${PORT}`);
  if (CLI.role) console.log(`  Role (CLI)  : ${CLI.role}`);
  if (APP_UPSTREAM_URL) {
    console.log(`  Mode        : BRIDGE -> ${APP_UPSTREAM_URL}`);
    console.log('                (aplikasi diteruskan ke upstream, foto dari disk lokal)');
    if (BRIDGE_REWRITE.length) {
      console.log(`  Rewrite URL : ${BRIDGE_REWRITE.join(', ')}`);
    }
  } else if (STORAGE_ONLY) {
    console.log('  Mode        : STORAGE_ONLY (hanya /photos/* dan /storage-api/*)');
  } else {
    console.log(`  Mode        : STATIC (menyajikan ${STATIC_DIR})`);
  }
  if (ALLOWED_ORIGIN !== '*') console.log(`  CORS origin : ${ALLOWED_ORIGIN}`);
  console.log('----------------------------------------------------------');
  console.log('  Dari komputer internet-an di jaringan yang sama, buka:');
  console.log('    http://<IP-komputer-ini>:PORT/');
  console.log('  Cari IP dengan:  ipconfig   (kolom IPv4 untuk adapter aktif)');
  console.log('==========================================================');
});

// ---------------------------------------------------------------------------
// Penanganan error server (mis. port sudah dipakai proses lain).
// Tanpa ini Node mencetak stack trace mentah dan proses berhenti mendadak.
// ---------------------------------------------------------------------------
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error('==========================================================');
    console.error(`  GAGAL: port ${PORT} sudah dipakai proses lain.`);
    console.error('==========================================================');
    console.error('  Kemungkinan proxy ini sudah berjalan di jendela lain.');
    console.error('');
    console.error('  Cara mengatasi:');
    console.error(`    1. Cari proses yang memakai port ${PORT}:`);
    console.error(`         netstat -ano | findstr :${PORT}`);
    console.error('    2. Hentikan prosesnya (ganti <PID> dengan angka dari langkah 1):');
    console.error('         taskkill /PID <PID> /F');
    console.error('    3. Atau pakai port lain: ubah PORT di .env.local-proxy');
    console.error('       (mis. PORT=8001) lalu sesuaikan config.yml tunnel.');
    console.error('');
    console.error('  Cek cepat di PowerShell:');
    console.error(`    Get-NetTCPConnection -LocalPort ${PORT} -State Listen |`);
    console.error('      Select-Object OwningProcess');
    console.error('==========================================================');
    process.exit(1);
  }

  if (err.code === 'EACCES') {
    console.error('');
    console.error(`  GAGAL: tidak punya izin memakai port ${PORT}.`);
    console.error('  Port < 1024 butuh hak administrator. Pakai port lain (mis. 8000).');
    process.exit(1);
  }

  console.error('[proxy] Error server:', err.message);
  process.exit(1);
});

// Matikan dengan rapi saat Ctrl+C / jendela ditutup.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[proxy] Menerima ${signal}, menghentikan server...`);
    server.close(() => process.exit(0));
    // Jaring pengaman bila koneksi menggantung.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}