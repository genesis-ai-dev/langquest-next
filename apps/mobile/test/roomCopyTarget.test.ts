import type { CopyNeed } from '@langquest-next/sync';

/**
 * Where Share nearby and the quiet room take a starting copy for a person let in offline
 * (2026-11-24, review items 6 and 26). Why these tests: a person set with a short copy, or whose
 * copy an update dropped, never went back to the join screen, whose Look was the only way to take
 * one, so no teammate could finish it. The rooms pass a target only for that person, and it asks
 * a teammate only while a copy is still wanted.
 */

const fake = vi.hoisted(() => ({
  person: null as unknown,
  directory: null as string | null,
  written: [] as [string, string][],
  chainNames: [] as { profileId: string; name: string }[][]
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => fake.directory, setItem: async (k: string, v: string) => { fake.written.push([k, v]); } }
}));
vi.mock('../src/server/localPerson', () => ({ readLocalPerson: async () => fake.person }));
vi.mock('../src/session/localPersonModel', () => ({
  localPersonIs: (p: { profileId: string } | null, id: string) => p?.profileId === id,
  membershipOf: (p: { orgId: string; languageId: string } | null) => p
}));
vi.mock('../src/nearby/nearbyLibrary.native', () => ({ phoneDocs: { head: async () => null, text: async () => null, keep: async () => true }, phoneLabels: { lang: async () => null } }));
vi.mock('../src/account/chainNames', () => ({ noteChainNames: async (_actorId: string, names: { profileId: string; name: string }[]) => { fake.chainNames.push(names); } }));

function client(need: { now: CopyNeed }) {
  return {
    copyNeed: async () => need.now, keptRecords: () => ({}), adoptStartingCopy: async () => undefined, fillFromCopy: async () => ({ filled: 0, filling: false }),
    dropStartingCopy: async () => undefined, keptPassageLinks: async () => ({}), getState: () => ({ members: { ana: {} } })
  };
}

beforeEach(() => {
  fake.person = { profileId: 'nyibol', orgId: 'o1', languageId: 'l1' };
  fake.directory = null;
  fake.written = [];
  fake.chainNames = [];
});

describe('a room\'s starting copy for a person let in offline', () => {
  const args = (language: { now: CopyNeed }, org: { now: CopyNeed }) =>
    ({ actorId: 'nyibol', orgId: 'o1', languageId: 'l1', language: client(language) as never, org: client(org) as never });

  it('is only for the local person of this organization and language, and only while a copy is needed', async () => {
    const { roomCopyTargetFor } = await import('../src/nearby/nearbyCopyTarget.native');
    expect(await roomCopyTargetFor(args({ now: null }, { now: null }))).toBeNull();
    expect((await roomCopyTargetFor(args({ now: 'lost' }, { now: 'lost' })))?.need).toBe('lost');
    expect((await roomCopyTargetFor(args({ now: null }, { now: 'missing' })))?.need).toBe('missing');
    expect(await roomCopyTargetFor({ ...args({ now: 'lost' }, { now: 'lost' }), actorId: 'ana' })).toBeNull();
    expect(await roomCopyTargetFor({ ...args({ now: 'lost' }, { now: 'lost' }), languageId: 'l2' })).toBeNull();
    expect(await roomCopyTargetFor({ ...args({ now: 'lost' }, { now: 'lost' }), org: null })).toBeNull();
    fake.person = null;
    expect(await roomCopyTargetFor(args({ now: 'lost' }, { now: 'lost' }))).toBeNull();
  });

  it('asks a teammate only while wanted, takes only what is missing, and keeps the names this phone has', async () => {
    const { roomCopyTargetFor } = await import('../src/nearby/nearbyCopyTarget.native');
    const language = { now: 'filling' as CopyNeed };
    const org = { now: null as CopyNeed };
    const got = (await roomCopyTargetFor(args(language, org)))!;
    // A copy still filling is held, and only filled; an organization from the server is held, and never asked for.
    expect(await got.target.language.holdsCopy()).toBe(true);
    expect(await got.target.org!.holdsCopy()).toBe(true);
    expect(got.target.language.dropCopy).toBeDefined();
    expect(await got.target.wanted!()).toBe(true);
    language.now = null;
    expect(await got.target.wanted!()).toBe(false);
    language.now = 'lost';
    expect(await got.target.language.holdsCopy()).toBe(false);
    fake.directory = JSON.stringify({ nyibol: 'Nyibol' });
    await got.target.names!({ ana: 'Ana', nyibol: 'Someone else', deng: 'Deng' });
    expect(fake.written).toEqual([['profile-directory:nyibol', JSON.stringify({ ana: 'Ana', nyibol: 'Nyibol', deng: 'Deng' })]]);
    // Those the organization does not list, but this person, are people let in offline: kept as chain names too (review item 12).
    expect(fake.chainNames).toEqual([[{ profileId: 'deng', name: 'Deng' }]]);
    // The names the team's library items go by come with the copy (review item 13).
    expect(got.target.labels).toBeDefined();
  });
});
