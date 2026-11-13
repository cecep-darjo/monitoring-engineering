import { AwsClient } from 'aws4fetch';

// ============================================================
// MONITORING STORAGE WORKER (Cloudflare R2)
// ------------------------------------------------------------
// Pengganti Supabase Storage untuk bucket `monitoring-photos`.
//
// Endpoint:
//   POST /upload  { path, contentType } -> { url }  (presigned PUT, 15 menit)
//   POST /delete  { paths: string[] }   -> { success, deleted }
//
// Semua request wajib membawa `Authorization: Bearer <supabase access token>`.
// Token diverifikasi ke Supabase Auth sebelum URL ditandatangani, sehingga
// hanya user yang login yang bisa upload/hapus (pengganti RLS Storage).
//
// Baca publik TIDAK lewat Worker: pakai custom domain / r2.dev pada bucket.
// ============================================================

interface Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ALLOWED_ORIGIN?: string;
}

const MAX_PATH_LENGTH = 512;
const PRESIGN_TTL_SECONDS = 900;

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}

/** Tolak path traversal / path absolut / karakter aneh. */
function safePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.trim().replace(/^\/+/, '');
  if (!path || path.length > MAX_PATH_LENGTH) return null;
  if (path.includes('..') || path.includes('\\') || path.includes('\0')) return null;
  return path;
}

async function isAuthenticated(req: Request, env: Env): Promise<boolean> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const res = await fetch(`${base}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY },
  });
  return res.ok;
}

function s3Client(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
}

function objectUrl(env: Env, path: string): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${path}`;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(req.url);

    if (!(await isAuthenticated(req, env))) {
      return json({ error: 'Unauthorized' }, 401, env);
    }

    if (url.pathname === '/upload' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { path?: string; contentType?: string } | null;
      const path = safePath(body?.path);
      if (!path) return json({ error: 'Invalid path' }, 400, env);

      const target = new URL(objectUrl(env, path));
      target.searchParams.set('X-Amz-Expires', String(PRESIGN_TTL_SECONDS));

      const signed = await s3Client(env).sign(target.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': body?.contentType || 'application/octet-stream' },
        aws: { signQuery: true },
      });

      return json({ url: signed.url }, 200, env);
    }

    if (url.pathname === '/delete' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { paths?: string[] } | null;
      const paths = (body?.paths || []).map(safePath).filter((p): p is string => Boolean(p));
      if (paths.length === 0) return json({ error: 'No valid paths' }, 400, env);

      const aws = s3Client(env);
      const results = await Promise.all(
        paths.map(async (path) => {
          const res = await aws.fetch(objectUrl(env, path), { method: 'DELETE' });
          return { path, ok: res.ok || res.status === 404 };
        }),
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        return json({ error: 'Sebagian object gagal dihapus', failed }, 502, env);
      }
      return json({ success: true, deleted: paths.length }, 200, env);
    }

    return json({ error: 'Not found' }, 404, env);
  },
};
