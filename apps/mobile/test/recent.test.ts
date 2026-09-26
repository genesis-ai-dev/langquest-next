import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); }
  }
}));

const { pushRecent, readRecent, recentKey, rememberRecent, RECENT_MAX } = await import('../src/recent');

describe('My Work: Recent', () => {
  it('lists the last passages opened, newest first, each once, capped', () => {
    // Why: Recent answers "where was I?"; a passage reopened moves to the top
    // rather than appearing twice, and the section never grows past five.
    let list = pushRecent([], { unitId: 'a', laneId: 'L' });
    list = pushRecent(list, { unitId: 'b', laneId: 'L' });
    list = pushRecent(list, { unitId: 'a', laneId: 'L' });
    expect(list.map((r) => r.unitId)).toEqual(['a', 'b']);
    // The same passage in another language is another place to be.
    expect(pushRecent(list, { unitId: 'a', laneId: 'M' })).toHaveLength(3);
    for (const id of 'cdefg') list = pushRecent(list, { unitId: id, laneId: 'L' });
    expect(list.map((r) => r.unitId)).toEqual(['g', 'f', 'e', 'd', 'c']);
    expect(list).toHaveLength(RECENT_MAX);
  });

  it('keeps each person\'s trail apart and survives quick successive visits', async () => {
    // Why: a shared device must not show one person's trail to another, and
    // two visits in quick succession must not overwrite each other.
    const mine = recentKey('org', 'proj', 'me');
    await Promise.all([rememberRecent(mine, { unitId: 'x', laneId: 'L' }), rememberRecent(mine, { unitId: 'y', laneId: 'L' })]);
    expect((await readRecent(mine)).map((r) => r.unitId)).toEqual(['y', 'x']);
    expect(await readRecent(recentKey('org', 'proj', 'someone-else'))).toEqual([]);
    store.set(mine, 'not json');
    expect(await readRecent(mine)).toEqual([]);
  });
});
