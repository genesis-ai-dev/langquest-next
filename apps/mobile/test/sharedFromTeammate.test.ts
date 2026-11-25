/**
 * The Bibles other organizations share, from a teammate's phone (2026-11-24, review item 9). Why
 * these tests: a team whose language recommends no Bible reads other organizations' shared ones, and
 * a phone that joined offline had none of them, only the bundled English text. A phone serves only
 * the rows of Bibles in its team's languages; a teammate's rows fill only what this phone has no
 * server list for, and the server's read ends that.
 */
import { emptyLanguageState, type OrgState } from '@langquest-next/core';

const fake = vi.hoisted(() => ({ saved: new Map<string, string>(), docs: new Map<string, unknown>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => fake.saved.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.saved.set(k, v); },
    multiSet: async (rows: [string, string][]) => { for (const [k, v] of rows) fake.saved.set(k, v); },
    removeItem: async (k: string) => { fake.saved.delete(k); }
  }
}));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));
vi.mock('../src/library/docStore', () => ({ heldDoc: async (h: string) => fake.docs.get(h) ?? null }));
vi.mock('../src/reference/languages', () => ({
  teamLanguages: () => ['swh', 'eng'],
  inLanguages: (l: string | undefined, ls: string[]) => !l || ls.includes(l)
}));

const H = (c: string) => c.repeat(64);
const row = (org: string, item: string, hash: string) => ({
  org_id: org, org_name: org, item_id: item, kind: 'material', name: item, description: '', subscribable: true, version_count: 1, latest_hash: hash, updated_hlc: '1:0:a'
});
const bible = (language: string) => ({ format: 'source@1', language });

beforeEach(() => {
  fake.saved.clear();
  fake.docs.clear();
  vi.resetModules();
});

async function shared() {
  const { phoneSharedFor } = await import('../src/library/sharedTeammate.native');
  return phoneSharedFor({ orgId: 'mine', languageId: 'luo', org: () => ({}) as OrgState, state: () => emptyLanguageState() });
}

describe('shared Bibles from a teammate\'s phone', () => {
  it('serves only other organizations\' Bibles in the team\'s languages, and any it cannot tell', async () => {
    fake.saved.set('library-shared:material', JSON.stringify([
      row('a', 'swahili', H('1')), row('b', 'russian', H('2')), row('c', 'key-words', H('3')), row('mine', 'own', H('4')), row('d', 'unknown', H('5'))
    ]));
    fake.docs.set(H('1'), bible('swh'));
    fake.docs.set(H('2'), bible('rus'));
    fake.docs.set(H('3'), { format: 'material@1' });
    const s = await shared();
    expect(await s.hashes()).toEqual([H('1'), H('5')]);
    expect((await s.rows()).map((r) => r.item_id)).toEqual(['swahili', 'unknown']);
  });

  it('keeps a teammate\'s rows only where it has none, marks them as not the server\'s, and never its own organization\'s', async () => {
    const s = await shared();
    expect(await s.fromServer()).toBe(false);
    await s.keep([row('a', 'swahili', H('1')), row('mine', 'own', H('4'))]);
    expect(JSON.parse(fake.saved.get('library-shared:material')!).map((r: { item_id: string }) => r.item_id)).toEqual(['swahili']);
    expect(fake.saved.get('library-shared-teammate:material')).toBe('1');
    expect(await s.fromServer()).toBe(false);
    // The same item again changes nothing.
    fake.saved.delete('library-shared-teammate:material');
    await s.keep([row('a', 'swahili', H('9'))]);
    expect(fake.saved.has('library-shared-teammate:material')).toBe(false);
    // A list from the server, and no teammate's since: nothing is asked, and nothing a teammate sends joins it.
    expect(await s.fromServer()).toBe(true);
    const before = fake.saved.get('library-shared:material');
    await s.keep([row('b', 'another', H('8'))]);
    expect(fake.saved.get('library-shared:material')).toBe(before);
  });

  // The security review of 2026-11-24: a hostile teammate could add rows without end, and name any document as a Bible.
  it('keeps at most 200 rows a teammate gave, over every session, and drops one whose document came and is no Bible of the team\'s', async () => {
    const s = await shared();
    await s.keep(Array.from({ length: 150 }, (_, i) => row('a', `b${i}`, H('1'))));
    await s.keep(Array.from({ length: 150 }, (_, i) => row('a', `c${i}`, H('1'))));
    expect(JSON.parse(fake.saved.get('library-shared:material')!)).toHaveLength(200);
    fake.saved.set('library-shared:material', JSON.stringify([row('a', 'notes', H('3')), row('a', 'swahili', H('1'))]));
    fake.docs.set(H('3'), { format: 'material@1' });
    fake.docs.set(H('1'), bible('swh'));
    expect(await s.hashes()).toEqual([H('1')]);
    expect(JSON.parse(fake.saved.get('library-shared:material')!).map((r: { item_id: string }) => r.item_id)).toEqual(['swahili']);
  });
});
