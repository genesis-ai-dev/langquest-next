import { describe, expect, it } from 'vitest';
import { checkStores, liveFromLookup, liveFromPlayPage, PLAY_REQUEST, storeCheckDue } from '../worker/storeReleases';

// The store check (storeReleases.ts, decisions.md 154): only a version that
// is live in the App Store is recorded.

describe('the store check', () => {
  it('reads the live version from Apple\'s lookup', () => {
    expect(liveFromLookup({ resultCount: 1, results: [{ version: '2026.1022.1830', currentVersionReleaseDate: '2026-10-23T08:00:00Z' }] }))
      .toEqual({ platform: 'ios', version: '2026.1022.1830', liveSince: '2026-10-23T08:00:00Z' });
  });

  it('records nothing while the app is not live', () => {
    expect(liveFromLookup({ resultCount: 0, results: [] })).toBeNull();
    expect(liveFromLookup({ results: [{ version: 'beta' }] })).toBeNull();
  });

  it('runs once an hour, on the first ten-minute tick', () => {
    expect(storeCheckDue(Date.UTC(2026, 9, 22, 18, 0))).toBe(true);
    expect(storeCheckDue(Date.UTC(2026, 9, 22, 18, 10))).toBe(false);
  });

  it('reads the live Android version from Google Play\'s app page', () => {
    const page = '<script>AF_initDataCallback({data:[null,[[["2026.1022.1830"]],[[[35]],[[[24,"7.0"]]]]]]});</script>';
    expect(liveFromPlayPage(page)).toEqual({ platform: 'android', version: '2026.1022.1830', liveSince: null });
    expect(liveFromPlayPage('<html>no app here</html>')).toBeNull();
  });

  const apple = JSON.stringify({ results: [{ version: '2026.1022.1830', currentVersionReleaseDate: '2026-10-23T08:00:00Z' }] });
  const response = (body: string, status = 200, url = '') => Object.defineProperty(new Response(body, { status }), 'url', { value: url });
  const store = (play: Response) =>
    (async (url: string) => (String(url).includes('itunes') ? response(apple, 200, String(url)) : play)) as unknown as typeof fetch;
  const playPage = (version: string) => response(`<x>[[["${version}"]]</x>`, 200, 'https://play.google.com/store/apps/details?id=com.frontierrnd.langquestnext');
  const recorder = () => {
    const calls: unknown[] = [];
    return { calls, db: { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { error: null }; } } as never };
  };

  it('writes what it found through record_app_release, and counts what each store answered', async () => {
    const { calls, db } = recorder();
    const { live, counts, problems } = await checkStores(db, store(playPage('2026.1021.900')));
    expect(live).toHaveLength(2);
    expect(problems).toEqual([]);
    expect(counts).toEqual({ appleStatus: 200, appleFound: 1, playStatus: 200, playRedirected: 0, playFound: 1 });
    expect(calls).toEqual([
      ['record_app_release', { p_platform: 'ios', p_version: '2026.1022.1830', p_live_since: '2026-10-23T08:00:00Z' }],
      ['record_app_release', { p_platform: 'android', p_version: '2026.1021.900', p_live_since: null }],
    ]);
  });

  it('records nothing for Android when Google sends the request to its consent page, and says so', async () => {
    const { calls, db } = recorder();
    const { counts, problems } = await checkStores(db, store(response('<html>Before you continue</html>', 200, 'https://consent.google.com/ml?continue=x')));
    expect(counts).toMatchObject({ playStatus: 200, playRedirected: 1, playFound: 0 });
    expect(problems).toEqual(['Google Play sent the request to consent.google.com']);
    expect(calls).toHaveLength(1);
  });

  it('records nothing for Android when Play answers with an error', async () => {
    const { calls, db } = recorder();
    const { counts, problems } = await checkStores(db, store(response('', 429, 'https://play.google.com/store/apps/details')));
    expect(counts).toMatchObject({ playStatus: 429, playFound: 0 });
    expect(problems).toEqual(["Google Play's page answered 429"]);
    expect(calls).toHaveLength(1);
  });

  it('records nothing for Android when Play\'s page shows no version', async () => {
    const { calls, db } = recorder();
    const { counts, problems } = await checkStores(db, store(response('<html>changed</html>', 200, 'https://play.google.com/store/apps/details')));
    expect(counts).toMatchObject({ playStatus: 200, playRedirected: 0, playFound: 0 });
    expect(problems[0]).toMatch(/layout may have changed/);
    expect(calls).toHaveLength(1);
  });

  it('asks Play as a browser in the US that has answered the consent page', () => {
    const headers = PLAY_REQUEST.headers as Record<string, string>;
    expect(headers['user-agent']).toMatch(/Chrome/);
    expect(headers['accept-language']).toMatch(/^en-US/);
    expect(headers.cookie).toMatch(/SOCS=/);
  });
});
