import { describe, expect, it, vi } from 'vitest';
import { jsonSecret, pemToDer, signJwt } from '../src/jwt';
import { appStoreAlerts, appStoreSection, buildsFrom, crashesFrom, storeReviewsFrom, versionsFrom } from '../src/sources/appstore';
import { googlePlaySection, playAlerts, reviewsFrom, weekRate, weighted, type GooglePlay } from '../src/sources/googleplay';

const NOW = Date.parse('2026-10-19T22:00:00Z');
const dAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

async function pem(alg: 'RS256' | 'ES256') {
  const params = alg === 'RS256'
    ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
    : { name: 'ECDSA', namedCurve: 'P-256' };
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const body = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const part = (jwt: string, i: number) => JSON.parse(new TextDecoder().decode(fromB64url(jwt.split('.')[i]!)));

describe('signing in to Google and Apple from the Worker', () => {
  it.each(['RS256', 'ES256'] as const)('signs a %s token the public key verifies', async (alg) => {
    const { pem: key, publicKey } = await pem(alg);
    const jwt = await signJwt(alg, key, { iss: 'me', aud: 'them' }, { kid: 'K1' });
    expect(part(jwt, 0)).toEqual({ alg, typ: 'JWT', kid: 'K1' });
    expect(part(jwt, 1)).toEqual({ iss: 'me', aud: 'them' });
    const [h, c, sig] = jwt.split('.');
    const verify = alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
    const signature = fromB64url(sig!);
    if (alg === 'ES256') expect(signature).toHaveLength(64);
    expect(await crypto.subtle.verify(verify, publicKey, signature, new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });

  it("reads a key whose line breaks came through as \\n, as in Google's key file", async () => {
    const { pem: key } = await pem('ES256');
    expect(pemToDer(key.replace(/\n/g, '\\n'))).toEqual(pemToDer(key));
  });

  it('names the secret and the field when a JSON secret is wrong', () => {
    expect(() => jsonSecret('nope', 'ADMIN_APP_STORE_KEY', ['keyId'])).toThrow('ADMIN_APP_STORE_KEY is not JSON');
    expect(() => jsonSecret('{"issuerId":"x"}', 'ADMIN_APP_STORE_KEY', ['issuerId', 'keyId'])).toThrow('ADMIN_APP_STORE_KEY has no "keyId"');
  });
});

describe('Google Play', () => {
  const row = (perceived: number, plain: number, users: number) => ({ metrics: [
    { metric: 'userPerceivedCrashRate', decimalValue: { value: String(perceived) } },
    { metric: 'crashRate', decimalValue: { value: String(plain) } },
    { metric: 'distinctUsers', decimalValue: { value: String(users) } }
  ] });

  it('weights each day by its users', () => {
    expect(weighted([row(0.02, 0.03, 100), row(0, 0, 300), { metrics: [] }], 'userPerceivedCrashRate', 'crashRate'))
      .toEqual({ userPerceived: 0.005, rate: 0.0075, users: 400 });
    expect(weighted([], 'userPerceivedCrashRate', 'crashRate')).toBeNull();
  });

  it("prefers the newest day's 7-day user-weighted rate, as Play Console judges it", () => {
    const day = (d: number, p7: number) => ({ startTime: { year: 2026, month: 10, day: d }, metrics: [
      { metric: 'userPerceivedCrashRate7dUserWeighted', decimalValue: { value: String(p7) } },
      { metric: 'crashRate7dUserWeighted', decimalValue: { value: '0.02' } },
      { metric: 'distinctUsers', decimalValue: { value: '80' } }
    ] });
    expect(weekRate([day(16, 0.009), day(17, 0.012), day(15, 0.001)], 'userPerceivedCrashRate', 'crashRate')).toEqual({ userPerceived: 0.012, rate: 0.02, users: 80 });
  });

  it("uses Play's own bad-behaviour lines, and watches at half of them", () => {
    const base: GooglePlay = { package: 'p', crash: null, anr: null, freshThrough: null, issues: [], reviews: null, notes: [] };
    expect(playAlerts({ ...base, crash: { userPerceived: 0.0115, rate: 0.02, users: 50 } })[0]).toMatchObject({ level: 'problem', text: expect.stringContaining('1.15% of Android users met a crash') });
    expect(playAlerts({ ...base, anr: { userPerceived: 0.003, rate: 0.004, users: 50 } })[0]).toMatchObject({ level: 'watch' });
    expect(playAlerts({ ...base, crash: { userPerceived: 0.001, rate: 0.001, users: 50 } })).toEqual([]);
  });

  it("counts the week's low reviews, newest first, and never keeps the author", () => {
    const r = reviewsFrom([
      { comments: [{ userComment: { text: 'Crashes when I stop recording', starRating: 1, appVersionName: '1.0.3', lastModified: { seconds: (NOW - 86_400_000) / 1000 } } }] },
      { comments: [{ userComment: { text: 'Great', starRating: 5, lastModified: { seconds: String((NOW - 2 * 86_400_000) / 1000) } } }] },
      { comments: [{ userComment: { text: 'Old', starRating: 2, lastModified: { seconds: (NOW - 20 * 86_400_000) / 1000 } } }] }
    ], NOW);
    expect(r).toEqual({ lowWeek: 1, average: 8 / 3, recent: [
      { stars: 1, text: 'Crashes when I stop recording', version: '1.0.3', at: dAgo(1) },
      { stars: 5, text: 'Great', version: null, at: dAgo(2) },
      { stars: 2, text: 'Old', version: null, at: dAgo(20) }
    ] });
  });

  it('waits for its key', async () => {
    expect(await googlePlaySection({ GOOGLE_PLAY_PACKAGE: 'p' })).toMatchObject({ state: 'off', setup: expect.stringContaining('ADMIN_GOOGLE_PLAY_KEY') });
  });

  it("signs in as the service account, reads vitals up to Play's freshness, and keeps going when reviews are refused", async () => {
    const { pem: key } = await pem('RS256');
    const seen: string[] = [];
    let queried: { timelineSpec: { startTime: unknown; endTime: unknown } } | null = null;
    const end = { year: 2026, month: 10, day: 18, timeZone: { id: 'America/Los_Angeles' } };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url.replace(/\?.*/, ''));
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        expect(String(init?.body)).toMatch(/^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=ey/);
        return Response.json({ access_token: 'goog', expires_in: 3600 });
      }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer goog');
      if (url.endsWith('MetricSet')) return Response.json({ freshnessInfo: { freshnesses: [{ aggregationPeriod: 'HOURLY', latestEndTime: end }, { aggregationPeriod: 'DAILY', latestEndTime: end }] } });
      if (url.endsWith('crashRateMetricSet:query')) {
        queried = JSON.parse(String(init?.body));
        return Response.json({ rows: [row(0.015, 0.02, 200)] });
      }
      if (url.endsWith('anrRateMetricSet:query')) return Response.json({ rows: [] });
      if (url.includes('errorIssues:search')) {
        const q = new URL(url).searchParams;
        expect([q.get('interval.startTime.timeZone.id'), q.get('interval.endTime.hours'), q.get('interval.endTime.day')]).toEqual(['UTC', '22', '19']);
        return Response.json({ errorIssues: [{ type: 'APPLICATION_NOT_RESPONDING', cause: 'Input dispatching timed out', location: 'MainActivity', errorReportCount: '3', distinctUsers: '2' }, { type: 'CRASH', cause: 'java.lang.IllegalStateException', location: 'Recorder.stop', errorReportCount: '42', distinctUsers: '9', lastErrorReportTime: dAgo(1), issueUri: 'https://play.google.com/console/x' }] });
      }
      if (url.includes('/reviews')) return new Response('{}', { status: 403 });
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const s = await googlePlaySection({ ADMIN_GOOGLE_PLAY_KEY: JSON.stringify({ client_email: 'admin-page@lq.iam.gserviceaccount.com', private_key: key }), GOOGLE_PLAY_PACKAGE: 'com.frontierrnd.langquestnext' }, fetcher, NOW);
    expect(queried!.timelineSpec).toEqual({ aggregationPeriod: 'DAILY', startTime: { year: 2026, month: 10, day: 11, timeZone: { id: 'America/Los_Angeles' } }, endTime: end });
    expect(s.data).toMatchObject({ crash: { userPerceived: 0.015, users: 200 }, anr: null, issues: [{ type: 'ANR', reports: 3 }, { type: 'CRASH', reports: 42, users: 9 }], reviews: null });
    expect(s.data!.freshThrough).toBe('2026-10-17');
    expect(s.data!.notes[0]).toContain('Reviews: Play reviews: HTTP 403');
    expect(s.alerts[0]?.level).toBe('problem');
    expect(seen.filter((u) => u === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
  });
});

describe('App Store', () => {
  it('reads versions newest first, from the current state field or the old one', () => {
    expect(versionsFrom([
      { id: '1', attributes: { versionString: '1.0.2', platform: 'IOS', appStoreState: 'READY_FOR_SALE', createdDate: dAgo(30) } },
      { id: '2', attributes: { versionString: '1.0.3', platform: 'IOS', appVersionState: 'REJECTED', createdDate: dAgo(2) } }
    ]).map((v) => `${v.version} ${v.state}`)).toEqual(['1.0.3 REJECTED', '1.0.2 READY_FOR_SALE']);
  });

  it('names each build by its marketing version from the included pre-release version', () => {
    expect(buildsFrom(
      [{ id: 'b', attributes: { version: '57', processingState: 'FAILED', uploadedDate: dAgo(1), expired: false }, relationships: { preReleaseVersion: { data: { id: 'p', type: 'preReleaseVersions' } } } }],
      [{ id: 'p', attributes: { version: '1.0.3' } }]
    )).toEqual([{ version: '1.0.3', build: '57', state: 'FAILED', uploadedAt: dAgo(1), expired: false }]);
  });

  it('keeps only the device and system of TestFlight crash reports, and counts the week', () => {
    expect(crashesFrom([
      { id: 'c1', attributes: { createdDate: dAgo(2), deviceModel: 'iPhone15,2', osVersion: '18.1' } },
      { id: 'c2', attributes: { createdDate: dAgo(9), deviceModel: 'iPhone12,1', osVersion: '17.6' } }
    ], NOW)).toEqual({ week: 1, recent: [{ device: 'iPhone15,2', os: '18.1', at: dAgo(2) }, { device: 'iPhone12,1', os: '17.6', at: dAgo(9) }] });
  });

  it('calls a rejected version or a failed build a problem, and watches low reviews', () => {
    const alerts = appStoreAlerts({
      appId: 'a', notes: [], testflightCrashes: null,
      versions: [{ version: '1.0.3', platform: 'IOS', state: 'REJECTED', at: dAgo(1) }],
      builds: [{ version: '1.0.3', build: '57', state: 'INVALID', uploadedAt: dAgo(1), expired: false }],
      reviews: storeReviewsFrom([{ id: 'r', attributes: { rating: 2, title: 'Slow', body: 'Downloads stall', territory: 'NPL', createdDate: dAgo(3) } }], NOW)
    });
    expect(alerts.map((a) => `${a.level} ${a.text}`)).toEqual([
      'problem App Store: version 1.0.3 was rejected in review.',
      'problem App Store: the latest build 1.0.3 (57) is invalid after processing.',
      'watch App Store: 1 one- or two-star review in the last 7 days.'
    ]);
  });

  it('signs with the key, asks for the app by its id, and shows what it could read', async () => {
    const { pem: key } = await pem('ES256');
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const jwt = String(new Headers(init?.headers).get('authorization')).replace('Bearer ', '');
      expect(part(jwt, 0)).toMatchObject({ alg: 'ES256', kid: 'KEY123' });
      expect(part(jwt, 1)).toMatchObject({ iss: 'issuer-uuid', aud: 'appstoreconnect-v1' });
      if (url.includes('/apps/6812492008/appStoreVersions')) return Response.json({ data: [{ id: 'v', attributes: { versionString: '1.0.3', platform: 'IOS', appVersionState: 'WAITING_FOR_REVIEW', createdDate: dAgo(1) } }] });
      if (url.includes('/builds?filter[app]=6812492008')) return Response.json({ data: [] });
      if (url.includes('/customerReviews')) return new Response('{}', { status: 403 });
      if (url.includes('/betaFeedbackCrashSubmissions')) {
        expect(url).toContain('fields[betaFeedbackCrashSubmissions]=createdDate,deviceModel,osVersion');
        return Response.json({ data: [] });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const s = await appStoreSection({ ADMIN_APP_STORE_KEY: JSON.stringify({ issuerId: 'issuer-uuid', keyId: 'KEY123', privateKey: key }), APP_STORE_APP_ID: '6812492008' }, fetcher, NOW);
    expect(s.state).toBe('ok');
    expect(s.data).toMatchObject({ versions: [{ state: 'WAITING_FOR_REVIEW' }], builds: [], reviews: null, testflightCrashes: { week: 0 } });
    expect(s.alerts).toEqual([]);
    expect(s.data!.notes[0]).toContain('HTTP 403');
  });
});
