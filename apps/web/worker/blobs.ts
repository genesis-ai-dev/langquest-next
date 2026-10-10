/**
 * Recordings and guide media in R2 (decisions.md 69). Objects live at
 * `<org>/<stream>/<sha256>.<ext>`, named by the hash of their bytes, so an
 * upload is an idempotent overwrite and R2 itself refuses bytes that do not
 * hash to their name. Who may use an object is the database's answer
 * (`blob_access`), the same rule the bucket policies held before.
 *
 *   PUT    /api/blobs/:key                 upload; Bearer access token or service key
 *   GET    /api/blob-urls/:key             a link (a path) to read it for ten minutes; Bearer access token
 *   GET    /api/blobs/:key?expires&sig     read through that link, Range supported
 *   GET    /api/blobs/:key                 read; Bearer service key
 *   DELETE /api/blobs/:key                 remove; Bearer service key (the reconciler)
 *   GET    /api/blobs?prefix=&cursor=      list; Bearer service key
 *
 * An upload is confirmed by appending v1.BlobStored before it answers 200,
 * so a phone learns of it through the pull it already does (decision 14).
 */

/** The bucket as this file uses it; index.ts adapts R2's binding, tests use a map. */
export interface BlobBucket {
  /** The whole object, or `range` of it; null when there is none. */
  get(key: string, range?: { offset: number; length: number }): Promise<{ size: number; body: ReadableStream } | null>;
  head(key: string): Promise<{ size: number } | null>;
  /** Throws BadDigest when the bytes do not hash to `sha256`. */
  put(key: string, body: ReadableStream | Uint8Array, length: number, sha256: string, contentType: string): Promise<{ size: number }>;
  delete(key: string): Promise<void>;
  list(prefix: string, cursor?: string): Promise<{ objects: { key: string; size: number }[]; cursor?: string }>;
}

/** R2 refused the bytes: they do not hash to the name they were sent under. */
export class BadDigest extends Error {}

export interface BlobDeps {
  bucket: BlobBucket;
  /** The profile a Supabase access token belongs to, or null when it is not valid. */
  profileOf(token: string): Promise<string | null>;
  /** May this profile read the object, or with `write`, upload it? */
  mayUse(key: string, profileId: string, write: boolean): Promise<boolean>;
  /** Append v1.BlobStored for the object (idempotent: the event id carries hash and size). */
  record(orgId: string, streamId: string, hash: string, size: number): Promise<void>;
  /** The service-role key: scripts and the reconciler present it, and read links are signed with a key derived from it. */
  serviceKey: string;
  now?: () => number;
}

/** The cap Supabase Storage had (supabase/config.toml), under the Worker's 100 MB request limit. */
export const MAX_BYTES = 50 * 1024 * 1024;
/** How long a read link lasts, as the signed URLs it replaces did. */
export const URL_TTL_MS = 10 * 60 * 1000;

const MIME: Record<string, string> = {
  wav: 'audio/wav', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', aac: 'audio/aac',
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm'
};

const KEY = new RegExp(`^([^/\\s?#]{1,200})/([^/\\s?#]{1,200})/([0-9a-f]{64})\\.(${Object.keys(MIME).join('|')})$`);

interface BlobKey { key: string; orgId: string; streamId: string; hash: string; ext: string }

/** A key from a request path, or null when it is not one this bucket holds. */
export function parseKey(path: string): BlobKey | null {
  let key: string;
  try {
    key = path.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  const m = KEY.exec(key);
  if (!m || ['.', '..'].includes(m[1]!) || ['.', '..'].includes(m[2]!)) return null;
  return { key, orgId: m[1]!, streamId: m[2]!, hash: m[3]!, ext: m[4]! };
}

const NO_STORE = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE } });

const bearer = (request: Request) => /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Equal without leaking where they differ: both sides are hashed first, so lengths do not show either. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i]! ^ y[i]!;
  return diff === 0 && b.length > 0;
}

/** The link-signing key: derived from the service key, so there is no other secret to keep. */
async function urlKey(serviceKey: string): Promise<CryptoKey> {
  const raw = await sha256(`langquest blob urls v1\n${serviceKey}`);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const signed = (key: string, expires: number) => new TextEncoder().encode(`${key}\n${expires}`);

/**
 * `/api/blobs/<key>?expires=…&sig=…`, readable by anyone holding it until it
 * expires. A path, not a URL: the caller already knows the Worker's address,
 * and the request's own host is not it under `wrangler dev`, which rewrites
 * it to the route's custom domain.
 */
export async function readPath(key: string, deps: Pick<BlobDeps, 'serviceKey' | 'now'>): Promise<{ path: string; expiresAt: number }> {
  const expiresAt = (deps.now ?? Date.now)() + URL_TTL_MS;
  const sig = hex(await crypto.subtle.sign('HMAC', await urlKey(deps.serviceKey), signed(key, expiresAt)));
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return { path: `/api/blobs/${encoded}?expires=${expiresAt}&sig=${sig}`, expiresAt };
}

async function validLink(url: URL, key: string, deps: BlobDeps): Promise<boolean> {
  const expires = Number(url.searchParams.get('expires'));
  const sig = url.searchParams.get('sig') ?? '';
  if (!Number.isSafeInteger(expires) || expires < (deps.now ?? Date.now)() || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const bytes = new Uint8Array(sig.match(/../g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.verify('HMAC', await urlKey(deps.serviceKey), bytes, signed(key, expires));
}

/**
 * One `bytes=` range, resolved against the object's size; null for none or
 * one this does not serve (a multi-range answer is the whole file, as HTTP
 * allows), 'unsatisfiable' for one that starts past the end.
 */
export function resolveRange(header: string | null, size: number): { offset: number; length: number } | 'unsatisfiable' | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const suffix = Math.min(Number(m[2]), size);
    return suffix === 0 ? 'unsatisfiable' : { offset: size - suffix, length: suffix };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { offset: start, length: end - start + 1 };
}

async function read(request: Request, b: BlobKey, deps: BlobDeps): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': MIME[b.ext]!,
    // Read as the type its name says, never sniffed into something a browser would run.
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
    etag: `"${b.hash}"`,
    // The name is the content: what was read once never changes.
    'cache-control': 'private, max-age=31536000, immutable'
  };
  const rangeHeader = request.headers.get('range');
  let range: { offset: number; length: number } | undefined;
  let size: number;
  if (rangeHeader) {
    const head = await deps.bucket.head(b.key);
    if (!head) return json(404, { error: 'Not stored.' });
    size = head.size;
    const r = resolveRange(rangeHeader, size);
    if (r === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    if (r) range = r;
  }
  if (request.method === 'HEAD' && !range) {
    const head = await deps.bucket.head(b.key);
    if (!head) return json(404, { error: 'Not stored.' });
    return new Response(null, { status: 200, headers: { ...headers, 'content-length': String(head.size) } });
  }
  const object = await deps.bucket.get(b.key, range);
  if (!object) return json(404, { error: 'Not stored.' });
  size = object.size;
  const body = request.method === 'HEAD' ? null : object.body;
  if (!range) return new Response(body, { status: 200, headers: { ...headers, 'content-length': String(size) } });
  return new Response(body, {
    status: 206,
    headers: { ...headers, 'content-length': String(range.length), 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` }
  });
}

async function upload(request: Request, b: BlobKey, deps: BlobDeps): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isSafeInteger(length) || length < 0) return json(411, { error: 'Send the file with its length.' });
  if (length > MAX_BYTES) return json(413, { error: `Files are at most ${MAX_BYTES / 1024 / 1024} MB.` });
  let stored: { size: number };
  try {
    stored = await deps.bucket.put(b.key, request.body ?? new Uint8Array(), length, b.hash, MIME[b.ext]!);
  } catch (e) {
    if (e instanceof BadDigest) return json(422, { error: 'The file does not match its name; it was not stored.' });
    console.error(`blob put ${b.key}:`, e);
    return json(502, { error: 'The file could not be stored just now. Try again.' });
  }
  try {
    await deps.record(b.orgId, b.streamId, b.hash, stored.size);
  } catch (e) {
    // Stored but not yet confirmed: the phone sends it again, which is harmless,
    // and the reconciler confirms it if it never does.
    console.error(`record_blob ${b.key}:`, e);
    return json(502, { error: 'The file was stored but not confirmed. Try again.' });
  }
  return json(200, { hash: b.hash, size: stored.size });
}

/** Who is asking: the service, a signed-in person, or nobody. */
async function caller(request: Request, deps: BlobDeps): Promise<{ service: true } | { profileId: string } | null> {
  const token = bearer(request);
  if (!token) return null;
  if (await sameSecret(token, deps.serviceKey)) return { service: true };
  const profileId = await deps.profileOf(token);
  return profileId ? { profileId } : null;
}

async function allowed(who: { service: true } | { profileId: string }, key: string, write: boolean, deps: BlobDeps): Promise<boolean> {
  return 'service' in who || deps.mayUse(key, who.profileId, write);
}

export async function handleBlobs(request: Request, deps: BlobDeps): Promise<Response> {
  try {
    return await answer(request, deps);
  } catch (e) {
    console.error('blobs:', e);
    return json(502, { error: 'Files are not available just now. Try again.' });
  }
}

async function answer(request: Request, deps: BlobDeps): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  if (url.pathname.startsWith('/api/blob-urls/')) {
    if (method !== 'GET') return json(405, { error: 'Only GET is supported.' });
    const b = parseKey(url.pathname.slice('/api/blob-urls/'.length));
    if (!b) return json(404, { error: 'Not a stored file name.' });
    const who = await caller(request, deps);
    if (!who) return json(401, { error: 'Sign in again.' });
    if (!(await allowed(who, b.key, false, deps))) return json(403, { error: 'You may not open this file.' });
    return json(200, await readPath(b.key, deps));
  }

  if (url.pathname === '/api/blobs' || url.pathname === '/api/blobs/') {
    if (method !== 'GET') return json(405, { error: 'Only GET is supported.' });
    const who = await caller(request, deps);
    if (!who || !('service' in who)) return json(403, { error: 'Only the service may list files.' });
    const prefix = url.searchParams.get('prefix') ?? '';
    const page = await deps.bucket.list(prefix, url.searchParams.get('cursor') ?? undefined);
    return json(200, { objects: page.objects, cursor: page.cursor ?? null });
  }

  if (!url.pathname.startsWith('/api/blobs/')) return json(404, { error: 'Not found.' });
  const b = parseKey(url.pathname.slice('/api/blobs/'.length));
  if (!b) return json(404, { error: 'Not a stored file name.' });

  if (method === 'GET' || method === 'HEAD') {
    if (url.searchParams.has('sig')) {
      return (await validLink(url, b.key, deps)) ? read(request, b, deps) : json(403, { error: 'This link has expired.' });
    }
    const who = await caller(request, deps);
    if (!who) return json(401, { error: 'Sign in again.' });
    if (!(await allowed(who, b.key, false, deps))) return json(403, { error: 'You may not open this file.' });
    return read(request, b, deps);
  }
  if (method === 'PUT') {
    const who = await caller(request, deps);
    if (!who) return json(401, { error: 'Sign in again.' });
    if (!(await allowed(who, b.key, true, deps))) return json(403, { error: 'You may not add files here.' });
    return upload(request, b, deps);
  }
  if (method === 'DELETE') {
    const who = await caller(request, deps);
    if (!who || !('service' in who)) return json(403, { error: 'Only the service may remove files.' });
    await deps.bucket.delete(b.key);
    return new Response(null, { status: 204 });
  }
  return json(405, { error: 'Not supported.' });
}
