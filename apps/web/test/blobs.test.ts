import { createHash } from 'node:crypto';
import { handleApi } from '../worker/api';
import { BadDigest, handleBlobs, MAX_BYTES, parseKey, resolveRange, URL_TTL_MS, type BlobBucket, type BlobDeps } from '../worker/blobs';

/**
 * Recordings and guide media through the Worker (decisions.md 69): who may
 * use a file, that bytes must hash to their name, that a stored upload is
 * confirmed, and that read links expire. Driven by an in-memory bucket that
 * checks the hash as R2 does, so no Cloudflare or Supabase is needed.
 */

const SERVICE = 'service-role-key';
const ORIGIN = 'https://next.example';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

class MemoryBucket implements BlobBucket {
  readonly objects = new Map<string, Uint8Array>();
  async get(key: string, range?: { offset: number; length: number }) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    const part = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
    return { size: bytes.byteLength, body: new Response(part).body! };
  }
  async head(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.byteLength } : null;
  }
  async put(key: string, body: ReadableStream | Uint8Array, length: number, sha256: string) {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    if (bytes.byteLength !== length) throw new Error('length mismatch');
    if (sha(bytes) !== sha256) throw new BadDigest('The SHA-256 checksum you specified did not match what we received. (10037)');
    this.objects.set(key, bytes);
    return { size: bytes.byteLength };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async list(prefix: string, cursor?: string) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + 2);
    return {
      objects: page.map((key) => ({ key, size: this.objects.get(key)!.byteLength })),
      ...(start + 2 < keys.length ? { cursor: String(start + 2) } : {})
    };
  }
}

function world(opts: { now?: () => number } = {}) {
  const bucket = new MemoryBucket();
  const recorded: string[] = [];
  // tok-lead reads and writes org1/L1; tok-viewer only reads it.
  const deps: BlobDeps = {
    bucket,
    serviceKey: SERVICE,
    profileOf: async (t) => ({ 'tok-lead': 'lead', 'tok-viewer': 'viewer' } as Record<string, string>)[t] ?? null,
    mayUse: async (key, profileId, write) => key.startsWith('org1/L1/') && (profileId === 'lead' || (profileId === 'viewer' && !write)),
    record: async (orgId, streamId, hash, size) => { recorded.push(`${orgId}/${streamId}/${hash}:${size}`); },
    ...(opts.now ? { now: opts.now } : {})
  };
  return { bucket, recorded, deps };
}

const audio = new TextEncoder().encode('RIFF....WAVEfmt some audio bytes');
const hash = sha(audio);
const key = `org1/L1/${hash}.wav`;

const put = (deps: BlobDeps, k: string, body: Uint8Array, token?: string) =>
  handleBlobs(new Request(`${ORIGIN}/api/blobs/${k}`, {
    method: 'PUT', body, headers: { 'content-length': String(body.byteLength), ...(token ? { authorization: `Bearer ${token}` } : {}) }
  }), deps);

const linkFor = async (deps: BlobDeps, k: string, token = 'tok-lead') => {
  const res = await handleBlobs(new Request(`${ORIGIN}/api/blob-urls/${k}`, { headers: { authorization: `Bearer ${token}` } }), deps);
  const { path, expiresAt } = (await res.json()) as { path: string; expiresAt: number };
  return { url: `${ORIGIN}${path}`, expiresAt };
};

describe('blob uploads', () => {
  it('stores bytes under their hash and confirms them before answering', async () => {
    // Why: PLAN.md section 14 rule 2. The phone never declares an upload
    // done; the server's BlobStored does, and it must follow the bytes.
    const { deps, bucket, recorded } = world();
    const res = await put(deps, key, audio, 'tok-lead');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash, size: audio.byteLength });
    expect(bucket.objects.get(key)).toEqual(audio);
    expect(recorded).toEqual([`org1/L1/${hash}:${audio.byteLength}`]);
  });

  it('a re-upload is harmless', async () => {
    // Why: content addressing makes retries safe; a lost answer is sent again.
    const { deps, bucket, recorded } = world();
    expect((await put(deps, key, audio, 'tok-lead')).status).toBe(200);
    expect((await put(deps, key, audio, 'tok-lead')).status).toBe(200);
    expect(bucket.objects.size).toBe(1);
    expect(recorded).toHaveLength(2); // record_blob is idempotent by event id
  });

  it('refuses bytes that do not hash to their name, and stores nothing', async () => {
    // Why: decision 17. Nobody may download garbage under a good name; a
    // 4xx tells the phone that sending the same file again will not help.
    const { deps, bucket, recorded } = world();
    const res = await put(deps, `org1/L1/${'b'.repeat(64)}.wav`, audio, 'tok-lead');
    expect(res.status).toBe(422);
    expect(bucket.objects.size).toBe(0);
    expect(recorded).toEqual([]);
  });

  it('refuses whoever may not write the stream', async () => {
    const { deps, bucket } = world();
    expect((await put(deps, key, audio)).status).toBe(401);
    expect((await put(deps, key, audio, 'tok-nobody')).status).toBe(401);
    expect((await put(deps, key, audio, 'tok-viewer')).status).toBe(403);
    expect((await put(deps, `org2/L9/${hash}.wav`, audio, 'tok-lead')).status).toBe(403);
    expect(bucket.objects.size).toBe(0);
  });

  it('the service key may upload anywhere (imports, the copy from Supabase)', async () => {
    const { deps, bucket } = world();
    expect((await put(deps, `org2/L9/${hash}.wav`, audio, SERVICE)).status).toBe(200);
    expect(bucket.objects.has(`org2/L9/${hash}.wav`)).toBe(true);
  });

  it('refuses a file over the cap, or one sent without its length', async () => {
    const { deps } = world();
    const big = new Request(`${ORIGIN}/api/blobs/${key}`, { method: 'PUT', headers: { authorization: 'Bearer tok-lead', 'content-length': String(MAX_BYTES + 1) } });
    expect((await handleBlobs(big, deps)).status).toBe(413);
    const unsized = new Request(`${ORIGIN}/api/blobs/${key}`, { method: 'PUT', headers: { authorization: 'Bearer tok-lead' } });
    expect((await handleBlobs(unsized, deps)).status).toBe(411);
  });

  it('answers 502 when stored but not confirmed, so the phone sends it again', async () => {
    const { deps } = world();
    deps.record = async () => { throw new Error('database down'); };
    expect((await put(deps, key, audio, 'tok-lead')).status).toBe(502);
  });

  it('refuses names that are not a hash and a known format', async () => {
    const { deps } = world();
    expect((await put(deps, 'org1/L1/deadbeef.wav', audio, 'tok-lead')).status).toBe(404);
    expect((await put(deps, `org1/L1/${hash}.exe`, audio, 'tok-lead')).status).toBe(404);
    expect((await put(deps, `org1/../${hash}.wav`, audio, 'tok-lead')).status).toBe(404);
    expect(parseKey(`org1/_org/${hash}.jpg`)).toEqual({ key: `org1/_org/${hash}.jpg`, orgId: 'org1', streamId: '_org', hash, ext: 'jpg' });
  });
});

describe('blob reads', () => {
  it('a reader gets a link that serves the file, ranges included', async () => {
    // Why: players stream with Range requests and cannot send a token.
    const { deps } = world();
    await put(deps, key, audio, 'tok-lead');
    const { url } = await linkFor(deps, key, 'tok-viewer');
    expect(url.startsWith(`${ORIGIN}/api/blobs/${key}?expires=`)).toBe(true);

    const whole = await handleBlobs(new Request(url), deps);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('audio/wav');
    // Never sniffed into a type a browser would run.
    expect(whole.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(audio);

    const part = await handleBlobs(new Request(url, { headers: { range: 'bytes=4-7' } }), deps);
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 4-7/${audio.byteLength}`);
    expect(await part.text()).toBe('....');

    const past = await handleBlobs(new Request(url, { headers: { range: `bytes=${audio.byteLength}-` } }), deps);
    expect(past.status).toBe(416);
  });

  it('a link expires, and cannot be moved to another file', async () => {
    let now = 1_800_000_000_000;
    const { deps } = world({ now: () => now });
    await put(deps, key, audio, 'tok-lead');
    const { url } = await linkFor(deps, key);
    const other = sha(new TextEncoder().encode('other'));
    expect((await handleBlobs(new Request(url.replace(hash, other)), deps)).status).toBe(403);
    expect((await handleBlobs(new Request(url.replace(/sig=[0-9a-f]+/, `sig=${'0'.repeat(64)}`)), deps)).status).toBe(403);
    now += URL_TTL_MS + 1;
    expect((await handleBlobs(new Request(url), deps)).status).toBe(403);
  });

  it('no link for whoever may not read the stream', async () => {
    const { deps } = world();
    const res = await handleBlobs(new Request(`${ORIGIN}/api/blob-urls/org2/L9/${hash}.wav`, { headers: { authorization: 'Bearer tok-lead' } }), deps);
    expect(res.status).toBe(403);
    expect((await handleBlobs(new Request(`${ORIGIN}/api/blob-urls/${key}`), deps)).status).toBe(401);
  });

  it('a file not stored is a 404 through a valid link', async () => {
    const { deps } = world();
    const { url } = await linkFor(deps, key);
    expect((await handleBlobs(new Request(url), deps)).status).toBe(404);
  });

  it('a range is resolved against the size', () => {
    expect(resolveRange('bytes=0-', 10)).toEqual({ offset: 0, length: 10 });
    expect(resolveRange('bytes=-3', 10)).toEqual({ offset: 7, length: 3 });
    expect(resolveRange('bytes=5-100', 10)).toEqual({ offset: 5, length: 5 });
    expect(resolveRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(resolveRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(resolveRange(null, 10)).toBeNull();
  });
});

describe('the service paths (the reconciler, the copy from Supabase)', () => {
  it('lists, reads and removes with the service key, and nobody else may', async () => {
    const { deps } = world();
    const files = ['a', 'b', 'c'].map((t) => new TextEncoder().encode(t));
    for (const f of files) await put(deps, `org1/L1/${sha(f)}.wav`, f, 'tok-lead');

    const service = { authorization: `Bearer ${SERVICE}` };
    const keys: string[] = [];
    let cursor: string | null = null;
    do {
      const res: Response = await handleBlobs(new Request(`${ORIGIN}/api/blobs?prefix=org1/L1/${cursor ? `&cursor=${cursor}` : ''}`, { headers: service }), deps);
      const page = (await res.json()) as { objects: { key: string; size: number }[]; cursor: string | null };
      keys.push(...page.objects.map((o) => o.key));
      cursor = page.cursor;
    } while (cursor);
    expect(keys).toHaveLength(3);

    const first = keys[0]!;
    expect((await handleBlobs(new Request(`${ORIGIN}/api/blobs/${first}`, { headers: service }), deps)).status).toBe(200);
    expect((await handleBlobs(new Request(`${ORIGIN}/api/blobs?prefix=org1/`, { headers: { authorization: 'Bearer tok-lead' } }), deps)).status).toBe(403);
    expect((await handleBlobs(new Request(`${ORIGIN}/api/blobs/${first}`, { method: 'DELETE', headers: { authorization: 'Bearer tok-lead' } }), deps)).status).toBe(403);
    expect((await handleBlobs(new Request(`${ORIGIN}/api/blobs/${first}`, { method: 'DELETE', headers: service }), deps)).status).toBe(204);
    expect((await handleBlobs(new Request(`${ORIGIN}/api/blobs/${first}`, { headers: service }), deps)).status).toBe(404);
  });
});

describe('through the API router', () => {
  it('routes /api/blobs and /api/blob-urls, and lets a local web app PUT', async () => {
    const { deps } = world();
    const api = { profileOf: deps.profileOf, reports: async () => null, blobs: deps };
    const res = await handleApi(new Request(`${ORIGIN}/api/blobs/${key}`, {
      method: 'PUT', body: audio, headers: { authorization: 'Bearer tok-lead', 'content-length': String(audio.byteLength), origin: 'http://localhost:8091' }
    }), api);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8091');
    const pre = await handleApi(new Request(`${ORIGIN}/api/blobs/${key}`, { method: 'OPTIONS', headers: { origin: 'http://localhost:8091' } }), api);
    expect(pre.headers.get('access-control-allow-methods')).toContain('PUT');
    expect((await handleApi(new Request(`${ORIGIN}/api/blob-urls/${key}`, { headers: { authorization: 'Bearer tok-lead' } }), api)).status).toBe(200);
    expect((await handleApi(new Request(`${ORIGIN}/api/blobs/${key}`), { profileOf: deps.profileOf, reports: async () => null })).status).toBe(503);
  });
});
