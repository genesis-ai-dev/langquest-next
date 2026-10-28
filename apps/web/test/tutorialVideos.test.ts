import { describe, expect, it } from 'vitest';
import { handleApi, type ApiDeps } from '../worker/api';
import { BadDigest, type BlobBucket } from '../worker/blobs';
import { handleWatch } from '../worker/tutorialVideos';
import { CHANNELS } from '../../../server/youtube';

/** The tutorial videos the filming made (worker/tutorialVideos.ts): public, by language, tutorial and hash, never anything else in the bucket. */

const SHA = 'a'.repeat(64);

function bucket(objects: Record<string, string>): BlobBucket {
  return {
    async get(key, range) {
      const body = objects[key];
      if (body === undefined) return null;
      const part = range ? body.slice(range.offset, range.offset + range.length) : body;
      return { size: body.length, body: new Response(part).body! };
    },
    async head(key) { return objects[key] === undefined ? null : { size: objects[key]!.length }; },
    async put() { throw new Error('read only'); },
    async delete() { throw new Error('read only'); },
    async list() { return { objects: [] }; }
  };
}

const deps = (objects: Record<string, string>): ApiDeps => ({
  profileOf: async () => null,
  reports: async () => null,
  blobs: { bucket: bucket(objects), serviceKey: 'k', mayUse: async () => false, record: async () => {} } as unknown as ApiDeps['blobs']
});

describe('/api/tutorials', () => {
  const objects = {
    [`tutorials/zh-Hans/record-a-passage/${SHA}.mp4`]: '0123456789',
    'org-1/lang-1/secret.m4a': 'private recording'
  };
  const get = (path: string, headers?: Record<string, string>) => handleApi(new Request(`https://x${path}`, { headers }), deps(objects));

  it('answers a video without sign-in, for good', async () => {
    const r = await get(`/api/tutorials/zh-Hans/record-a-passage/${SHA}.mp4`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('0123456789');
    expect(r.headers.get('content-type')).toBe('video/mp4');
    expect(r.headers.get('content-length')).toBe('10');
    expect(r.headers.get('cache-control')).toContain('immutable');
  });

  it('answers the part a video player asks for', async () => {
    const r = await get(`/api/tutorials/zh-Hans/record-a-passage/${SHA}.mp4`, { range: 'bytes=2-5' });
    expect(r.status).toBe(206);
    expect(await r.text()).toBe('2345');
    expect(r.headers.get('content-range')).toBe('bytes 2-5/10');
    expect((await get(`/api/tutorials/zh-Hans/record-a-passage/${SHA}.mp4`, { range: 'bytes=20-' })).status).toBe(416);
  });

  it('reaches nothing outside tutorials/', async () => {
    for (const path of [
      '/api/tutorials/../org-1/lang-1/secret.m4a', `/api/tutorials/zh-Hans/../${SHA}.mp4`, `/api/tutorials/org-1/lang-1/${SHA}.mp4`,
      `/api/tutorials/en/record-a-passage/${SHA}.mp4`, '/api/tutorials/zh-Hans/record-a-passage/secret.m4a', `/api/tutorials/zh-Hans/Record/${SHA}.mp4`
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });
});

describe('PUT /api/tutorials', () => {
  const BYTES = 'a filmed video';
  const shaOf = async (text: string) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

  /** A bucket that checks the hash as R2 does, and keeps what it took. */
  function writable() {
    const stored: Record<string, { body: string; type: string }> = {};
    const b: BlobBucket = {
      ...bucket({}),
      async put(key, body, length, sha256, contentType) {
        const text = body instanceof Uint8Array ? new TextDecoder().decode(body) : await new Response(body).text();
        if (text.length !== length) throw new Error('length');
        if ((await shaOf(text)) !== sha256) throw new BadDigest();
        stored[key] = { body: text, type: contentType };
        return { size: length };
      }
    };
    return { stored, deps: { ...deps({}), blobs: { ...deps({}).blobs!, bucket: b } } as ApiDeps };
  }
  const put = (d: ApiDeps, path: string, body: string, key?: string) =>
    handleApi(new Request(`https://x${path}`, {
      method: 'PUT', body, headers: { 'content-length': String(body.length), ...(key ? { authorization: `Bearer ${key}` } : {}) }
    }), d);

  it('stores a film the service brings, under its hash', async () => {
    const { stored, deps: d } = writable();
    const sha = await shaOf(BYTES);
    const r = await put(d, `/api/tutorials/fr/record-a-passage/${sha}.mp4`, BYTES, 'k');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sha256: sha, size: BYTES.length });
    expect(stored[`tutorials/fr/record-a-passage/${sha}.mp4`]).toEqual({ body: BYTES, type: 'video/mp4' });
  });

  it('takes nothing from anyone but the service', async () => {
    const { stored, deps: d } = writable();
    const sha = await shaOf(BYTES);
    expect((await put(d, `/api/tutorials/fr/record-a-passage/${sha}.mp4`, BYTES)).status).toBe(401);
    expect((await put(d, `/api/tutorials/fr/record-a-passage/${sha}.mp4`, BYTES, 'a person')).status).toBe(401);
    expect(stored).toEqual({});
  });

  it('refuses bytes that are not the name, and names outside tutorials/', async () => {
    const { stored, deps: d } = writable();
    expect((await put(d, `/api/tutorials/fr/record-a-passage/${SHA}.mp4`, BYTES, 'k')).status).toBe(422);
    expect((await put(d, `/api/tutorials/fr/../org-1/${await shaOf(BYTES)}.mp4`, BYTES, 'k')).status).toBe(404);
    expect((await put(d, `/api/tutorials/fr/record-a-passage/${await shaOf(BYTES)}.m4a`, BYTES, 'k')).status).toBe(404);
    expect(stored).toEqual({});
  });

  it('refuses a video too big for a request before reading it', async () => {
    const { deps: d } = writable();
    const r = await handleApi(new Request(`https://x/api/tutorials/fr/record-a-passage/${SHA}.mp4`, {
      method: 'PUT', body: 'x', headers: { 'content-length': String(101 * 1024 * 1024), authorization: 'Bearer k' }
    }), d);
    expect(r.status).toBe(413);
  });
});

describe('/v/<language>/<tutorial>', () => {
  const asked: string[] = [];
  const watch = (path: string, newest: string | null | Error) => handleWatch(new Request(`https://x${path}`), async (tutorial, language) => {
    asked.push(`${language}/${tutorial}`);
    if (newest instanceof Error) throw newest;
    return newest;
  });

  it('goes on to the newest version on YouTube', async () => {
    const r = await watch('/v/es/record-a-passage', 'abcdefghijk');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://youtu.be/abcdefghijk');
  });

  it('goes on to the language\'s channel while none is up, or when the database cannot say', async () => {
    expect((await watch('/v/fr/invite-your-team', null)).headers.get('location')).toBe(`https://www.youtube.com/channel/${CHANNELS.fr}`);
    expect((await watch('/v/sw/invite-your-team', new Error('down'))).headers.get('location')).toBe(`https://www.youtube.com/channel/${CHANNELS.sw}`);
  });

  it('asks the database once in a while, except after it failed', async () => {
    asked.length = 0;
    await watch('/v/pt/do-a-check', 'abcdefghijk');
    await watch('/v/pt/do-a-check', 'zzzzzzzzzzz');
    await watch('/v/ha/do-a-check', new Error('down'));
    await watch('/v/ha/do-a-check', null);
    expect(asked).toEqual(['pt/do-a-check', 'ha/do-a-check', 'ha/do-a-check']);
  });

  it('knows only LangQuest\'s languages and plain video names', async () => {
    for (const path of ['/v/de/record-a-passage', '/v/es/Record', '/v/es/a/b', '/v/constructor/record-a-passage']) expect((await watch(path, 'abcdefghijk')).status).toBe(404);
  });
});
