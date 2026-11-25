import { describe, expect, it } from 'vitest';
import { API_READERS, jsonLines, scrub, type ApisDeps } from '../src/logsApis';
import { maskPersonal } from '../src/logsShared';

/** The provider APIs behind the log gate (src/logsApis.ts, docs/production-reads.md, "Provider APIs"). */

const NOW = Date.parse('2026-11-24T22:30:00Z');
type Call = { url: string; init?: RequestInit };

async function rsaPem(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
}

function deps(answer: (url: string, init?: RequestInit) => unknown, env: Partial<ApisDeps['env']> = {}): ApisDeps & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    env: { CLOUDFLARE_ACCOUNT_ID: 'acc', EXPO_PROJECT_ID: 'app1', GITHUB_REPO: 'o/r', APP_STORE_APP_ID: '6812492008', GOOGLE_PLAY_PACKAGE: 'com.x', ADMIN_CLOUDFLARE_TOKEN: 'cf', ADMIN_EXPO_TOKEN: 'ex', ADMIN_GITHUB_TOKEN: 'gh', ...env },
    fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body = answer(url, init);
      return typeof body === 'string' ? new Response(body, { headers: { 'content-type': 'text/plain' } }) : Response.json(body);
    }) as typeof fetch,
    now: () => NOW
  };
}

describe('personal data', () => {
  it('hides fields that name or reach a person, and emails, IP addresses and phone numbers in any text', () => {
    expect(scrub({ reviews: [{ authorName: 'Ana', comments: [{ text: 'ok' }] }], actor: { login: 'bot', avatar_url: 'https://x' }, email: null }))
      .toEqual({ reviews: [{ authorName: '[hidden]', comments: [{ text: 'ok' }] }], actor: { login: 'bot', avatar_url: '[hidden]' }, email: null });
    expect(maskPersonal('ann@example.org at 203.0.113.9 and 2001:db8:85a3:0:0:8a2e:370:7334, call +255 712 345 678; build 1.2.3 at 10:00:00Z id 0f1e2d3c-4b5a-4968-8776-655443322110'))
      .toBe('[email] at [ip] and [ip], call [number]; build 1.2.3 at 10:00:00Z id 0f1e2d3c-4b5a-4968-8776-655443322110');
    expect(jsonLines({ a: 'x@y.io' }).lines).toEqual(['{', ' "a": "[email]"', '}']);
  });
});

describe('Cloudflare and Expo GraphQL', () => {
  it('sends a query with the account filled in, and refuses a mutation', async () => {
    const d = deps(() => ({ data: { viewer: { accounts: [{ n: 1 }] } } }));
    const answer = await API_READERS['cloudflare-graphql'](d, { query: 'query ($account: string!) { viewer { accounts(filter: {accountTag: $account}) { n } } }' });
    expect(JSON.parse(String(d.calls[0]!.init!.body)).variables).toEqual({ account: 'acc' });
    expect(answer.lines.join('')).toContain('"n": 1');
    await expect(API_READERS['cloudflare-graphql'](d, { query: 'mutation { x }' })).rejects.toThrow('never a mutation');
    await expect(API_READERS['eas-graphql'](d, { query: 'query { a } mutation { b }' })).rejects.toThrow('never a mutation');
    expect(d.calls).toHaveLength(1);
  });
});

describe('GET APIs', () => {
  it('reads GitHub under this repository only, and refuses a path that climbs out', async () => {
    const d = deps(() => ({ workflow_runs: [{ id: 5, conclusion: 'failure' }] }));
    await API_READERS['github-api'](d, { path: 'actions/runs?per_page=5' });
    expect(d.calls[0]!.url).toBe('https://api.github.com/repos/o/r/actions/runs?per_page=5');
    await expect(API_READERS['github-api'](d, { path: '../../users/x' })).rejects.toThrow('..');
    await expect(API_READERS['github-api'](d, { path: 'https://evil.example/x' })).rejects.toThrow();
  });

  it('refuses App Store Connect\'s lists of people before it signs anything', async () => {
    const d = deps(() => ({}), { ADMIN_APP_STORE_KEY: '{"keyId":"K","privateKey":"none"}' });
    await expect(API_READERS['app-store-api'](d, { path: 'v1/users' })).rejects.toThrow('personal data');
    await expect(API_READERS['app-store-api'](d, { path: 'v1/apps/{app}/betaTesters?limit=5' })).rejects.toThrow('personal data');
    await expect(API_READERS['app-store-api'](d, { path: 'apps/{app}' })).rejects.toThrow('v1/');
    expect(d.calls).toHaveLength(0);
  });

  it('reads one Play crash group\'s reports for this app', async () => {
    const d = deps((url) => (url.includes('oauth2') ? { access_token: 't', expires_in: 3600 } : { errorReports: [{ reportText: 'java.lang.NullPointerException', deviceModel: { marketingName: 'Pixel' } }] }),
      { ADMIN_GOOGLE_PLAY_KEY: JSON.stringify({ client_email: 'logs-test@x.iam.gserviceaccount.com', private_key: await rsaPem() }) });
    const answer = await API_READERS['play-crashes'](d, { issue: '1234' });
    const url = new URL(d.calls[1]!.url);
    expect(url.pathname).toBe('/v1beta1/apps/com.x/errorReports:search');
    expect(url.searchParams.get('filter')).toBe('errorIssueId = 1234');
    expect(answer.lines.join('')).toContain('NullPointerException');
    await expect(API_READERS['google-play-api'](d, { api: 'reporting', path: 'apps/com.other/errorIssues:search' })).rejects.toThrow('apps/{package}');
  });
});

describe('App Store analytics reports', () => {
  it('reads the newest App Crashes rows from Apple\'s gzip files, and no file on another host', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const privateKey = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
    const gz = new Uint8Array(await new Response(new Blob(['Date\tApp Version\tCrashes\n2026-11-23\t2026.1124\t3\n']).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const d = deps((url) => {
      if (url.includes('/analyticsReportRequests?')) return { data: [{ id: 'req' }] };
      if (url.includes('/reports?')) return { data: [{ id: 'rep' }] };
      if (url.includes('/instances?')) return { data: [{ id: 'ins', attributes: { processingDate: '2026-11-23' } }] };
      if (url.includes('/segments')) return { data: [{ attributes: { url: 'https://analytics.apple.com/seg1.gz' } }, { attributes: { url: 'https://evil.example/seg2.gz' } }] };
      return 'unexpected';
    }, { ADMIN_APP_STORE_KEY: JSON.stringify({ keyId: 'K', privateKey }) });
    const real = d.fetcher;
    d.fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).endsWith('seg1.gz') ? (d.calls.push({ url: String(input) }), new Response(gz)) : real(input, init))) as typeof fetch;
    const answer = await API_READERS['app-store-report'](d, {});
    expect(answer.lines).toEqual(['Date\tApp Version\tCrashes', '2026-11-23\t2026.1124\t3', '(a segment on evil.example, not read: not one of Apple\'s hosts)']);
    expect(decodeURIComponent(d.calls[1]!.url)).toContain('filter[name]=App Crashes');
    expect(d.calls.some((c) => c.url.includes('evil'))).toBe(false);
  });
});

describe('stored files', () => {
  it('asks the app Worker for sizes and times, never bytes', async () => {
    const asked: unknown[] = [];
    const d = deps(() => ({}), {
      APP_JOBS: {
        jobs: async () => [],
        blobs: async (ask) => { asked.push(ask); return { objects: [{ key: 'o/s/a.m4a', size: 9, uploaded: '2026-11-24T00:00:00.000Z', type: 'audio/mp4' }], missing: ['o/s/b.m4a'], truncated: false, cursor: null }; }
      }
    });
    const answer = await API_READERS['r2-blobs'](d, { keys: ['o/s/a.m4a', 'o/s/b.m4a', 7] });
    expect(asked[0]).toEqual({ keys: ['o/s/a.m4a', 'o/s/b.m4a'] });
    expect(answer.lines).toEqual(['key\tsize\tuploaded\ttype', 'o/s/a.m4a\t9\t2026-11-24T00:00:00.000Z\taudio/mp4', 'o/s/b.m4a\tmissing']);
    await API_READERS['r2-blobs'](d, { prefix: 'o/s/', limit: 5000 });
    expect(asked[1]).toEqual({ prefix: 'o/s/', limit: 1000 });
  });
});
