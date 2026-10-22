import { describe, expect, it } from 'vitest';
import { checkStores, liveFromLookup, liveFromPlayPage, storeCheckDue } from '../worker/storeReleases';

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
  const store = (playPage: string) =>
    (async (url: string) => new Response(String(url).includes('itunes') ? apple : playPage)) as unknown as typeof fetch;

  it('writes what it found through record_app_release', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { error: null }; } };
    const live = await checkStores(db as never, store('<x>[[["2026.1021.900"]]</x>'));
    expect(live).toHaveLength(2);
    expect(calls).toEqual([
      ['record_app_release', { p_platform: 'ios', p_version: '2026.1022.1830', p_live_since: '2026-10-23T08:00:00Z' }],
      ['record_app_release', { p_platform: 'android', p_version: '2026.1021.900', p_live_since: null }],
    ]);
  });

  it('records the iPhone version and says so when the Play page shows none', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { error: null }; } };
    await expect(checkStores(db as never, store('<html>changed</html>'))).rejects.toThrow(/layout may have changed/);
    expect(calls).toHaveLength(1);
  });
});
