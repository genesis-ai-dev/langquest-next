import { LOCAL_PERSON_KEY, localPersonText } from '../src/session/localPersonModel';
import { person } from './localPersonFixtures';

/**
 * "Remove me from this phone" (docs/nearby-sync-plan.md 14.1, 5 "Me"). Why: a local person cannot
 * sign out, and a lasting refusal at first contact (taken, deleted, chain, proof, a lost key) would
 * otherwise leave the phone theirs for good, with Sign In unreachable. Removing them takes the
 * install key and every nearby record it signed, their discovery keys and who was nearby, and
 * the record last, so a removal cut short can be done again; then nobody holds the phone.
 */

const fake = vi.hoisted(() => ({ secure: new Map<string, string>(), meta: new Map<string, string>() }));
vi.mock('../src/server/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => fake.secure.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.secure.set(k, v); },
    removeItem: async (k: string) => { fake.secure.delete(k); }
  }
}));
vi.mock('../src/server/supabase', () => ({ SESSION_KEY: 'sb-session' }));
// lock.ts's own rules for discovery keys are its tests'; removing them is a plain delete.
vi.mock('../src/server/lock', () => ({ keepFindKeys: async (id: string, raw: string | null) => { if (raw === null) fake.secure.delete(`nearbyFindKeys:${id}`); return true; } }));
// As Metro resolves them on an Android phone.
vi.mock('../src/server/localPerson', () => import('../src/server/localPerson.android'));
vi.mock('../src/server/nearbyKey', () => import('../src/server/nearbyKey.android'));
vi.mock('react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o['android'] ?? o['default'] } }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(7) }));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
vi.mock('../src/storage/store', () => ({
  getStore: async () => ({
    meta: async (k: string) => fake.meta.get(k) ?? null,
    setMeta: async (k: string, v: string) => { fake.meta.set(k, v); },
    clearMeta: async (prefix: string) => { for (const k of [...fake.meta.keys()]) if (k.startsWith(prefix)) fake.meta.delete(k); }
  }),
  fileLedgerDriver: () => null
}));

beforeEach(() => {
  fake.secure.clear();
  fake.meta.clear();
});

describe('removing someone let in offline from this phone', () => {
  it('takes the install key, the chains and passes it signed, their discovery keys and who was nearby, then the person', async () => {
    const { removeLocalPerson } = await import('../src/nearby/removeLocalPerson.android');
    const { readLocalPerson, localPersonHolds } = await import('../src/server/localPerson.android');
    const p = person({ stage: 'ready', profileId: 'newcomer-1', refused: { status: 'taken', at: 5 } });
    fake.secure.set(LOCAL_PERSON_KEY, localPersonText(p));
    fake.secure.set('nearby-install-key', 'seed');
    fake.secure.set('nearbyFindKeys:newcomer-1', 'keys');
    fake.secure.set('nearbyFindKeys:someone-signed-out', 'theirs, sealed by their own sign-out');
    for (const [k, v] of [['nearbyChain:newcomer-1', '{}'], ['nearbyChainPeople', '["newcomer-1"]'], ['nearbyPasses:newcomer-1', '[]'], ['nearbyPeers:org-1', '[]'], ['other', 'kept']]) fake.meta.set(k, v);
    expect((await readLocalPerson())?.profileId).toBe('newcomer-1');
    expect(localPersonHolds()).toBe(true);

    await removeLocalPerson('newcomer-1');

    expect([...fake.secure.keys()]).toEqual(['nearbyFindKeys:someone-signed-out']);
    expect([...fake.meta.keys()]).toEqual(['other']);
    expect(await readLocalPerson()).toBeNull();
    expect(localPersonHolds()).toBe(false);
  });

  it('does nothing for a stale caller while someone else holds the phone', async () => {
    const { removeLocalPerson } = await import('../src/nearby/removeLocalPerson.android');
    fake.secure.set(LOCAL_PERSON_KEY, localPersonText(person({ stage: 'ready', profileId: 'someone-else' })));
    fake.secure.set('nearby-install-key', 'seed');
    await removeLocalPerson('newcomer-1');
    expect(fake.secure.has(LOCAL_PERSON_KEY)).toBe(true);
    expect(fake.secure.has('nearby-install-key')).toBe(true);
  });
});
