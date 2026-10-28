import { describe, expect, it } from 'vitest';
import { handleApi, type ApiDeps } from '../worker/api';
import type { BlobBucket } from '../worker/blobs';

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
