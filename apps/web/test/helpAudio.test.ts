import { handleApi, type ApiDeps } from '../worker/api';
import type { BlobBucket } from '../worker/blobs';

/** Help mode's recorded lines (worker/helpAudio.ts): public, by language and hash, never anything else in the bucket. */

function bucket(objects: Record<string, string>): BlobBucket {
  return {
    async get(key) {
      const body = objects[key];
      return body === undefined ? null : { size: body.length, body: new Response(body).body! };
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

describe('/api/help-audio', () => {
  const objects = {
    'help-audio/es/index.json': '{"lines":["0123456789abcdef"]}',
    'help-audio/es/0123456789abcdef.m4a': 'audio',
    'org-1/lang-1/secret.m4a': 'private recording'
  };

  it('answers a language’s list and its lines without sign-in', async () => {
    const list = await handleApi(new Request('https://x/api/help-audio/es/index.json'), deps(objects));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ lines: ['0123456789abcdef'] });
    const line = await handleApi(new Request('https://x/api/help-audio/es/0123456789abcdef.m4a'), deps(objects));
    expect(line.status).toBe(200);
    expect(line.headers.get('content-type')).toBe('audio/mp4');
    expect(line.headers.get('cache-control')).toContain('immutable');
  });

  it('reaches nothing outside help-audio/', async () => {
    for (const path of ['/api/help-audio/../org-1/lang-1/secret.m4a', '/api/help-audio/org-1/secret.m4a', '/api/help-audio/es/../../org-1/lang-1/secret.m4a', '/api/help-audio/es/x.m4a']) {
      expect((await handleApi(new Request(`https://x${path}`), deps(objects))).status, path).toBe(404);
    }
  });
});
