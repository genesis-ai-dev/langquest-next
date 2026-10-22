import { describe, expect, it } from 'vitest';
import { checkStores, liveFromLookup, storeCheckDue } from '../worker/storeReleases';

// The store check (storeReleases.ts, decisions.md 150): only a version that
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

  it('writes what it found through record_app_release', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { error: null }; } };
    const fetcher = (async () => new Response(JSON.stringify({ results: [{ version: '2026.1022.1830', currentVersionReleaseDate: '2026-10-23T08:00:00Z' }] }))) as typeof fetch;
    const live = await checkStores(db as never, fetcher);
    expect(live).toHaveLength(1);
    expect(calls).toEqual([['record_app_release', { p_platform: 'ios', p_version: '2026.1022.1830', p_live_since: '2026-10-23T08:00:00Z' }]]);
  });
});
