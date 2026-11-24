import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { APP_ID, ensureRequest } from './app-store-analytics-request.mjs';

/** The one report request that makes Apple write the analytics reports (scripts/app-store-analytics-request.mjs). */

const key = { keyId: 'K1', privateKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };

function fake(listed: unknown[]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
    return init.method === 'POST' ? Response.json({ data: { id: 'new-1' } }, { status: 201 }) : Response.json({ data: listed });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe('the App Store report request', () => {
  it('changes nothing when an ongoing request is there', async () => {
    const f = fake([{ id: 'r1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }]);
    expect(await ensureRequest(key, f.fetcher)).toEqual({ made: false, id: 'r1' });
    expect(f.calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('makes one ongoing request for this app when there is none', async () => {
    const f = fake([]);
    expect(await ensureRequest(key, f.fetcher)).toEqual({ made: true, id: 'new-1' });
    const post = f.calls[1]!;
    expect(post.url).toBe('https://api.appstoreconnect.apple.com/v1/analyticsReportRequests');
    expect(JSON.parse(post.body!).data).toEqual({ type: 'analyticsReportRequests', attributes: { accessType: 'ONGOING' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } });
  });
});
