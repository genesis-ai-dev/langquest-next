import { handleApi, type ApiDeps } from '../worker/api';
import type { ResponseCache } from '../worker/bible';

/** The language explorer's data route (worker/languoids.ts): public, built once, cached. */

class MapCache implements ResponseCache {
  readonly entries = new Map<string, string>();
  async match(key: Request) {
    const body = this.entries.get(key.url);
    return body === undefined ? undefined : new Response(body);
  }
  async put(key: Request, response: Response) {
    this.entries.set(key.url, await response.text());
  }
}

const deps = (load: () => Promise<unknown>, cache = new MapCache()): ApiDeps => ({
  profileOf: async () => null,
  reports: async () => null,
  languoids: { load, cache }
});

describe('/api/languoids', () => {
  it('answers without sign-in, and builds the data once', async () => {
    let builds = 0;
    const d = deps(async () => {
      builds += 1;
      return { release: 'v5.3', languoid: { name: ['Dinka'] } };
    });
    const first = await handleApi(new Request('https://x/api/languoids'), d);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ release: 'v5.3', languoid: { name: ['Dinka'] } });
    const second = await handleApi(new Request('https://x/api/languoids'), d);
    expect(await second.json()).toEqual({ release: 'v5.3', languoid: { name: ['Dinka'] } });
    expect(builds).toBe(1);
    expect(second.headers.get('cache-control')).toMatch(/^public/);
  });

  it('says so when the database does not answer, and caches nothing', async () => {
    const cache = new MapCache();
    const res = await handleApi(new Request('https://x/api/languoids'), deps(async () => { throw new Error('down'); }, cache));
    expect(res.status).toBe(502);
    expect(cache.entries.size).toBe(0);
  });

  it('only reads', async () => {
    const res = await handleApi(new Request('https://x/api/languoids', { method: 'POST' }), deps(async () => ({})));
    expect(res.status).toBe(405);
  });

  it('answers 503 where it is not set up', async () => {
    const res = await handleApi(new Request('https://x/api/languoids'), { profileOf: async () => null, reports: async () => null });
    expect(res.status).toBe(503);
  });
});
