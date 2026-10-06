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
// KONFIGURASI (via environment variables)
// ---------------------------------------------------------------------------
const HOST = process.env.HOST || '0.0.0.0';               // 0.0.0.0 = bisa diakses dari LAN
const PORT = parseInt(process.env.PORT || '400', 10);     // port proxy (default 400)
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const ANON_KEY = (process.env.ANON_KEY || '').trim();     // Supabase anon key (untuk fallback header)
const STATIC_DIR = process.env.STATIC_DIR || path.resolve(__dirname, '..', 'dist');

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
const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  req.path = urlPath;

  // Jawab langsung preflight CORS (untuk skenario dev lintas-origin).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end();
    return;
  }

  // Route ke backend Supabase untuk path API. Teruskan seluruh req.url
  // (termasuk query string) agar filter & select PostgREST tetap bekerja.
  if (
    urlPath.startsWith('/rest/v1') ||
    urlPath.startsWith('/auth/v1') ||
    urlPath.startsWith('/storage/v1') ||
    urlPath.startsWith('/functions/v1')
  ) {
    return forward(req, res, req.url);
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
  console.log(`  Proxy listen: http://${HOST}:${PORT}`);
  console.log('----------------------------------------------------------');
  console.log('  Dari komputer internet-an di jaringan yang sama, buka:');
  console.log('    http://<IP-komputer-ini>:PORT/');
  console.log('  Cari IP dengan:  ipconfig   (kolom IPv4 untuk adapter aktif)');
  console.log('==========================================================');
});