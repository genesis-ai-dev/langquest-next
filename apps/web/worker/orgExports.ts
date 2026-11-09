import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The organization export's door (decisions.md 206, docs/org-export.md).
 * An organization admin asks for an export, a job builds one zip in R2, and
 * the admin downloads it from a short-lived link. The job reaches this door
 * with the service key to put the zip in the bucket in parts (a Worker takes
 * a request body of 100 MB at most, a zip is far larger), so the Worker holds
 * no archive in memory and the phone holds none at all.
 *
 *   POST /api/orgs/:org/exports            ask (org admin; body {languageIds?})
 *   GET  /api/orgs/:org/exports            this organization's exports, newest first (org admin)
 *   GET  /api/orgs/:org/exports/:id/link   a link to the zip, an hour long (org admin)
 *   GET  /api/org-exports/:id/file         the zip, by that link (range reads)
 *   POST /api/org-exports/:id/upload       the job: ?action=create | part&n=&uploadId= | complete | abort
 */

/** What the person sees of an export. */
export interface ExportRow {
  id: string;
  orgId: string;
  requestedBy: string;
  /** null: every language. */
  languageIds: string[] | null;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: { phase: string; filesDone: number; filesTotal: number; bytes: number } | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  /** A fixed code for a failed export, never a message. */
  error: string | null;
}

export interface ExportStore {
  create(orgId: string, profileId: string, languageIds: string[] | null): Promise<ExportRow>;
  list(orgId: string): Promise<ExportRow[]>;
  get(id: string): Promise<ExportRow | null>;
  /** Ready exports past their date: their file is deleted and they read as expired. */
  expire(orgId: string, now: number): Promise<string[]>;
}

export interface ExportBucket {
  create(key: string): Promise<{ uploadId: string }>;
  part(key: string, uploadId: string, n: number, body: ArrayBuffer): Promise<{ etag: string }>;
  complete(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<{ size: number }>;
  abort(key: string, uploadId: string): Promise<void>;
  get(key: string, range?: { offset: number; length: number }): Promise<{ size: number; body: ReadableStream } | null>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
}

export interface ExportDeps {
  serviceKey: string;
  profileOf(token: string): Promise<string | null>;
  /** The person holds the organization-level admin role (Manage roles at organization scope). */
  mayExport(orgId: string, profileId: string): Promise<boolean>;
  /** The languages of the organization, so a request names only its own. */
  languagesOf(orgId: string): Promise<string[]>;
  store: ExportStore;
  bucket: ExportBucket;
  /** Starts the export job, or has the one under way take this request when it ends. */
  start(): Promise<'started' | 'running' | 'disabled'>;
  now(): number;
}

/** How long the zip is kept, and how long a link to it works. */
export const KEEP_MS = 7 * 86_400_000;
export const LINK_MS = 60 * 60_000;

export const exportKey = (orgId: string, id: string) => `exports/${orgId}/${id}.zip`;

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
const bearer = (r: Request) => /^Bearer (.+)$/.exec(r.headers.get('authorization') ?? '')?.[1];
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const bytes = (s: string) => new TextEncoder().encode(s);

async function hmacKey(serviceKey: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', bytes(`langquest org export links v1\n${serviceKey}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', bytes(a)), crypto.subtle.digest('SHA-256', bytes(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i += 1) diff |= p[i]! ^ q[i]!;
  return diff === 0 && b.length > 0;
}

export async function linkPath(id: string, deps: Pick<ExportDeps, 'serviceKey' | 'now'>): Promise<{ path: string; expiresAt: number }> {
  const expiresAt = deps.now() + LINK_MS;
  const sig = hex(await crypto.subtle.sign('HMAC', await hmacKey(deps.serviceKey), bytes(`${id}\n${expiresAt}`)));
  return { path: `/api/org-exports/${id}/file?expires=${expiresAt}&sig=${sig}`, expiresAt };
}

async function validLink(url: URL, id: string, deps: ExportDeps): Promise<boolean> {
  const expires = Number(url.searchParams.get('expires'));
  const sig = url.searchParams.get('sig') ?? '';
  if (!Number.isSafeInteger(expires) || expires < deps.now() || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(deps.serviceKey), new Uint8Array(sig.match(/../g)!.map((b) => parseInt(b, 16))), bytes(`${id}\n${expires}`));
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export async function handleOrgExports(request: Request, deps: ExportDeps): Promise<Response> {
  try {
    return await answer(request, deps);
  } catch (e) {
    console.error('org exports:', e);
    return json(502, { error: 'Exports are not available just now. Try again.' });
  }
}

async function answer(request: Request, deps: ExportDeps): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  const file = new RegExp(`^/api/org-exports/(${UUID})/file$`).exec(url.pathname);
  if (file) {
    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'Only GET is supported.' });
    const row = await deps.store.get(file[1]!);
    if (!row || row.status !== 'ready' || !(await validLink(url, row.id, deps))) return json(403, { error: 'This link has expired. Ask for a new one.' });
    const key = exportKey(row.orgId, row.id);
    const head = await deps.bucket.head(key);
    if (!head) return json(404, { error: 'This export has been removed.' });
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    const start = range && range[1] !== '' ? Number(range[1]) : null;
    const end = range && range[2] !== '' ? Number(range[2]) : null;
    let offset = 0, length = head.size, status = 200;
    if (range && (start !== null || end !== null)) {
      offset = start ?? Math.max(0, head.size - end!);
      const last = start === null ? head.size - 1 : Math.min(end ?? head.size - 1, head.size - 1);
      if (offset >= head.size || last < offset) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
      length = last - offset + 1;
      status = 206;
    }
    const headers: Record<string, string> = {
      'content-type': 'application/zip', 'content-length': String(length), 'accept-ranges': 'bytes', 'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="langquest-export-${row.createdAt.slice(0, 10)}.zip"`, 'x-content-type-options': 'nosniff',
      ...(status === 206 ? { 'content-range': `bytes ${offset}-${offset + length - 1}/${head.size}` } : {})
    };
    if (method === 'HEAD') return new Response(null, { status, headers });
    const object = await deps.bucket.get(key, status === 206 ? { offset, length } : undefined);
    return object ? new Response(object.body, { status, headers }) : json(404, { error: 'This export has been removed.' });
  }

  const upload = new RegExp(`^/api/org-exports/(${UUID})/upload$`).exec(url.pathname);
  if (upload) {
    if (method !== 'POST') return json(405, { error: 'Only POST is supported.' });
    const token = bearer(request);
    if (!token || !(await sameSecret(token, deps.serviceKey))) return json(403, { error: 'Only the export job may write exports.' });
    const row = await deps.store.get(upload[1]!);
    if (!row || row.status !== 'running') return json(409, { error: 'That export is not running.' });
    const key = exportKey(row.orgId, row.id);
    const action = url.searchParams.get('action');
    const uploadId = url.searchParams.get('uploadId') ?? '';
    if (action === 'create') return json(200, await deps.bucket.create(key));
    if (!uploadId) return json(400, { error: 'uploadId is required.' });
    if (action === 'part') {
      const n = Number(url.searchParams.get('n'));
      if (!Number.isInteger(n) || n < 1 || n > 10_000) return json(400, { error: 'n must be a part number from 1 to 10000.' });
      return json(200, await deps.bucket.part(key, uploadId, n, await request.arrayBuffer()));
    }
    if (action === 'complete') {
      const parts = (await request.json().catch(() => null)) as { partNumber: number; etag: string }[] | null;
      if (!Array.isArray(parts) || parts.some((p) => !Number.isInteger(p?.partNumber) || typeof p?.etag !== 'string')) return json(400, { error: 'parts must be a list of {partNumber, etag}.' });
      return json(200, await deps.bucket.complete(key, uploadId, parts));
    }
    if (action === 'abort') { await deps.bucket.abort(key, uploadId); return json(200, { ok: true }); }
    return json(400, { error: 'action must be create, part, complete or abort.' });
  }

  const m = new RegExp(`^/api/orgs/([^/]+)/exports(?:/(${UUID})/link)?$`).exec(url.pathname);
  if (!m) return json(404, { error: 'Not found.' });
  const orgId = decodeURIComponent(m[1]!);
  const token = bearer(request);
  const profileId = token ? await deps.profileOf(token) : null;
  if (!profileId) return json(401, { error: 'Sign in again.' });
  // Only an organization's admin, and only for its own data: every route below starts here.
  if (!(await deps.mayExport(orgId, profileId))) return json(403, { error: 'Only an organization admin may export its data.' });

  if (m[2]) {
    if (method !== 'GET') return json(405, { error: 'Only GET is supported.' });
    const row = await deps.store.get(m[2]);
    if (!row || row.orgId !== orgId) return json(404, { error: 'No such export.' });
    if (row.status !== 'ready') return json(409, { error: 'This export is not ready.' });
    return json(200, await linkPath(row.id, deps));
  }
  if (method === 'GET') {
    for (const id of await deps.store.expire(orgId, deps.now())) await deps.bucket.delete(exportKey(orgId, id)).catch(() => undefined);
    return json(200, { exports: await deps.store.list(orgId) });
  }
  if (method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { languageIds?: unknown };
    let languageIds: string[] | null = null;
    if (body.languageIds !== undefined && body.languageIds !== null) {
      const own = new Set(await deps.languagesOf(orgId));
      if (!Array.isArray(body.languageIds) || body.languageIds.length === 0 || body.languageIds.some((l) => typeof l !== 'string' || !own.has(l))) {
        return json(400, { error: 'languageIds must name languages of this organization.' });
      }
      languageIds = [...new Set(body.languageIds as string[])].sort();
    }
    const open = (await deps.store.list(orgId)).find((r) => r.status === 'queued' || r.status === 'running');
    if (open) return json(409, { error: 'An export is already being made.', export: open });
    const row = await deps.store.create(orgId, profileId, languageIds);
    return json(202, { export: row, job: await deps.start() });
  }
  return json(405, { error: 'Only GET and POST are supported.' });
}

/** The R2 binding as the export door uses it. */
export function r2ExportBucket(r2: R2Bucket): ExportBucket {
  return {
    async create(key) { return { uploadId: (await r2.createMultipartUpload(key, { httpMetadata: { contentType: 'application/zip' } })).uploadId }; },
    async part(key, uploadId, n, body) { return { etag: (await r2.resumeMultipartUpload(key, uploadId).uploadPart(n, body)).etag }; },
    async complete(key, uploadId, parts) { return { size: (await r2.resumeMultipartUpload(key, uploadId).complete(parts)).size }; },
    async abort(key, uploadId) { await r2.resumeMultipartUpload(key, uploadId).abort(); },
    async get(key, range) {
      const o = await r2.get(key, range ? { range } : {});
      return o ? { size: o.size, body: o.body } : null;
    },
    async head(key) { const o = await r2.head(key); return o ? { size: o.size } : null; },
    async delete(key) { await r2.delete(key); }
  };
}

interface DbRow {
  id: string; org_id: string; requested_by: string; language_ids: string[] | null; status: ExportRow['status'];
  created_at: string; started_at: string | null; finished_at: string | null; progress: ExportRow['progress']; size_bytes: number | null;
  expires_at: string | null; error: string | null;
}

const toRow = (r: DbRow): ExportRow => ({
  id: r.id, orgId: r.org_id, requestedBy: r.requested_by, languageIds: r.language_ids, status: r.status, createdAt: r.created_at,
  startedAt: r.started_at, finishedAt: r.finished_at, progress: r.progress, sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  expiresAt: r.expires_at, error: r.error
});

/** The `org_exports` table, read and written with the service role (migration 20261107120000_org_exports.sql). */
export function supabaseExportStore(service: SupabaseClient): ExportStore {
  const fail = (what: string, e: { message: string }) => new Error(`${what}: ${e.message}`);
  return {
    async create(orgId, profileId, languageIds) {
      const { data, error } = await service.from('org_exports').insert({ org_id: orgId, requested_by: profileId, language_ids: languageIds }).select().single();
      if (error) throw fail('org_exports insert', error);
      return toRow(data as DbRow);
    },
    async list(orgId) {
      const { data, error } = await service.from('org_exports').select().eq('org_id', orgId).order('created_at', { ascending: false }).limit(20);
      if (error) throw fail('org_exports list', error);
      return (data as DbRow[]).map(toRow);
    },
    async get(id) {
      const { data, error } = await service.from('org_exports').select().eq('id', id).maybeSingle();
      if (error) throw fail('org_exports get', error);
      return data ? toRow(data as DbRow) : null;
    },
    async expire(orgId, now) {
      const { data, error } = await service.from('org_exports').update({ status: 'expired' }).eq('org_id', orgId).eq('status', 'ready')
        .lt('expires_at', new Date(now).toISOString()).select('id');
      if (error) throw fail('org_exports expire', error);
      return (data as { id: string }[]).map((r) => r.id);
    }
  };
}
