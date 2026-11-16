import {
  foldKnows, localPersonText, mayKeepLocalPerson, membershipOf, overlayFor, parseLocalPerson, recordDone, type LocalPerson
} from '../src/session/localPersonModel';
import { firstContactOpen, identityOf, isLocalIdentity } from '../src/session/identityModel';
import { emptyOrgState, privilegesFor, type OrgState, type Privilege } from '@langquest-next/core';
import { withChainMembership } from '@langquest-next/core/nearby';
import { deriveSession } from '../src/shell/session';
import { inviteChain, person } from './localPersonFixtures';

/**
 * The local person (src/session/localPersonModel.ts, src/server/localPerson.android.ts;
 * docs/nearby-sync-plan.md 14.1, 5): what is kept, who the app runs as, one to an install, a
 * stage never going back, and the store's one-at-a-time writes.
 */

const fake = vi.hoisted(() => ({ secure: new Map<string, string>() }));
vi.mock('../src/server/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => fake.secure.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.secure.set(k, v); },
    removeItem: async (k: string) => { fake.secure.delete(k); }
  }
}));

describe('the record as kept', () => {
  it('reads back what was written, and nothing that is not a record', () => {
    for (const stage of ['asking', 'filling', 'ready', 'joined', 'done'] as const) {
      const p = person({ stage, requestId: 'r-1', refused: { status: 'expired', at: 5 } });
      expect(parseLocalPerson(localPersonText(p))).toEqual(p);
    }
    for (const raw of [null, '', 'nope', '[]', '{}', JSON.stringify({ ...person(), v: 2 }), JSON.stringify({ ...person(), stage: 'later' })]) {
      expect(parseLocalPerson(raw)).toBeNull();
    }
  });

  it('refuses a granted record whose chain names another id, key, salt, device or name', () => {
    expect(parseLocalPerson(JSON.stringify(person({ stage: 'ready', chain: null })))).toBeNull();
    for (const changed of [{ profileId: 'someone-else' }, { installKey: 'C'.repeat(42) + 'A' }, { idSalt: 'D'.repeat(21) + 'Q' }, { deviceId: 'other' }, { name: 'Other' }]) {
      const p = person({ chain: inviteChain({ profileId: 'newcomer-1', ...changed }) });
      expect(parseLocalPerson(localPersonText(p))).toBeNull();
    }
    // A one-link chain, or a second link that is not an invite, is no grant.
    expect(parseLocalPerson(localPersonText(person({ chain: inviteChain({ profileId: 'newcomer-1' }).slice(0, 1) })))).toBeNull();
  });
});

describe('one local person to an install', () => {
  it('a leftover with nothing granted is replaced; anyone granted keeps the install', () => {
    expect(mayKeepLocalPerson(null, person({ stage: 'asking' }))).toBe(true);
    expect(mayKeepLocalPerson(person({ stage: 'asking', profileId: 'old' }), person({ stage: 'asking' }))).toBe(true);
    for (const stage of ['filling', 'ready', 'joined', 'done'] as const) {
      expect(mayKeepLocalPerson(person({ stage, profileId: 'old' }), person({ stage: 'asking' }))).toBe(false);
    }
  });

  it('a stage never goes back, and the key and salt never change under one id', () => {
    expect(mayKeepLocalPerson(person({ stage: 'filling' }), person({ stage: 'ready' }))).toBe(true);
    expect(mayKeepLocalPerson(person({ stage: 'ready' }), person({ stage: 'ready', refused: { status: 'used', at: 1 } }))).toBe(true);
    expect(mayKeepLocalPerson(person({ stage: 'joined' }), person({ stage: 'ready' }))).toBe(false);
    expect(mayKeepLocalPerson(person({ stage: 'asking' }), person({ stage: 'asking', installKey: 'C'.repeat(42) + 'A' }))).toBe(false);
    // A grant must name this record.
    expect(mayKeepLocalPerson(null, person({ stage: 'filling', chain: inviteChain({ profileId: 'x' }) }))).toBe(false);
  });
});

describe('who the app runs as', () => {
  const auth = { id: 'newcomer-1', email: 'nyibol-482@people.langquest.org' };

  it('waits until both the saved sign-in and the local person are read', () => {
    expect(identityOf(undefined, null)).toBeUndefined();
    expect(identityOf(null, undefined)).toBeUndefined();
  });

  it('a local person from ready on, signed in for routing with no server session', () => {
    for (const stage of ['ready', 'joined'] as const) {
      expect(identityOf(null, person({ stage }))).toMatchObject({ actorId: 'newcomer-1', signedIn: true, serverSession: false, email: null });
    }
    // A copy still filling, or a record done with its account signed out, is a guest.
    for (const stage of ['asking', 'filling', 'done'] as const) {
      expect(identityOf(null, person({ stage }))).toEqual({ actorId: 'guest', email: null, signedIn: false, serverSession: false, local: null });
    }
    expect(isLocalIdentity(person({ stage: 'filling' }))).toBe(false);
  });

  it('a session wins, under the same id after first contact, so the shell keeps its key', () => {
    const local = person({ stage: 'joined' });
    expect(identityOf(auth, local)).toEqual({ actorId: 'newcomer-1', email: auth.email, signedIn: true, serverSession: true, local });
    // Someone else's session never takes the local person's record with it.
    expect(identityOf({ id: 'other' }, local)).toMatchObject({ actorId: 'other', serverSession: true, local: null });
  });

  it('offers no sign-out until first contact is over, joined too, since a session gone there runs as the record with no lock', () => {
    for (const stage of ['ready', 'joined'] as const) expect(firstContactOpen(person({ stage }), 'newcomer-1')).toBe(true);
    for (const stage of ['asking', 'filling', 'done'] as const) expect(firstContactOpen(person({ stage }), 'newcomer-1')).toBe(false);
    expect(firstContactOpen(person({ stage: 'joined' }), 'someone-else')).toBe(false);
    expect(firstContactOpen(null, 'newcomer-1')).toBe(false);
  });
});

describe('the membership the link gives', () => {
  it('names the organization, language, role and privileges the inviter signed, once granted', () => {
    expect(membershipOf(person({ stage: 'asking' }))).toBeNull();
    expect(membershipOf(null)).toBeNull();
    expect(membershipOf(person())).toEqual({
      profileId: 'newcomer-1', orgId: 'org-1', languageId: 'lang-1', roleId: 'translator', privileges: ['translate', 'view_status'], inviter: 'inviter-1'
    });
  });

  it('the fold knows the person once it has any entry for them, live or removed', () => {
    expect(foldKnows(null, 'p')).toBe(false);
    expect(foldKnows({ p: {} }, 'p')).toBe(false);
    expect(foldKnows({ p: { 'language:l': { removed: { value: true } } } }, 'p')).toBe(true);
  });
});

describe('the overlay at Workspace', () => {
  const lay = (state: OrgState, p: LocalPerson, orgId: string) => {
    const m = overlayFor(p, orgId);
    return m ? withChainMembership(state, { ...m, privileges: m.privileges as Privilege[] }) : state;
  };

  it('gives the link\'s privileges in the chain\'s language, and nothing in another organization or before the grant', () => {
    const state = emptyOrgState();
    const p = person();
    const mine = lay(state, p, 'org-1');
    expect([...privilegesFor(mine, 'newcomer-1', 'lang-1')].sort()).toEqual(['translate', 'view_status']);
    expect(privilegesFor(mine, 'newcomer-1', 'lang-2').size).toBe(0);
    expect(lay(state, p, 'org-2')).toBe(state);
    expect(lay(state, person({ stage: 'asking' }), 'org-1')).toBe(state);
    // The fold's own state is left as it was.
    expect(state.members).toEqual({});
    // Every screen then sees a member who may translate there, and a local person, not a guest.
    const session = deriveSession('newcomer-1', null, false, mine, 'lang-1', false, null, true);
    expect(session).toMatchObject({ isLocal: true, isGuest: false, hasNoOrg: false, isAdmin: false });
    expect(session.can('translate')).toBe(true);
    expect(deriveSession('newcomer-1', null, false, mine, 'lang-1').isLocal).toBe(false);
  });

  it('goes once the fold has the person, and the record with it once the certificate route answered', () => {
    const none = { hlc: '', eventId: '' };
    const state = emptyOrgState();
    // Removed in the fold: the removal sticks, and the chain gives nothing back.
    state.members['newcomer-1'] = { 'language:lang-1': { roleId: { value: 'viewer', ...none }, removed: { value: true, ...none }, scope: { level: 'language', languageId: 'lang-1' } } };
    expect(lay(state, person(), 'org-1')).toBe(state);
    expect(privilegesFor(lay(state, person(), 'org-1'), 'newcomer-1', 'lang-1').size).toBe(0);
    expect(recordDone(person({ stage: 'done' }), { 'newcomer-1': { x: {} } })).toBe(true);
    expect(recordDone(person({ stage: 'joined' }), { 'newcomer-1': { x: {} } })).toBe(false);
    expect(recordDone(person({ stage: 'done' }), {})).toBe(false);
  });
});

describe('the store on an Android phone', () => {
  async function load() {
    vi.resetModules();
    return import('../src/server/localPerson.android');
  }
  beforeEach(() => fake.secure.clear());

  it('keeps, tells, and holds the phone from ready until the certificate answers', async () => {
    const store = await load();
    expect(await store.readLocalPerson()).toBeNull();
    const heard: (LocalPerson | null)[] = [];
    const off = store.onLocalPerson((p) => heard.push(p));
    expect(await store.keepLocalPerson(person({ stage: 'filling' }))).toBe(true);
    expect(store.localPersonHolds()).toBe(false);
    expect(await store.updateLocalPerson('newcomer-1', (p) => ({ ...p, stage: 'ready' }))).toMatchObject({ stage: 'ready' });
    expect(store.localPersonHolds()).toBe(true);
    await store.updateLocalPerson('newcomer-1', (p) => ({ ...p, stage: 'done' }));
    expect(store.localPersonHolds()).toBe(false);
    off();
    expect(heard.map((p) => p?.stage)).toEqual(['filling', 'ready', 'done']);
    // A fresh read (a restart) finds the same record.
    const again = await load();
    expect((await again.readLocalPerson())?.stage).toBe('done');
  });

  it('refuses a second person, a stage back, and removes only the named person', async () => {
    const store = await load();
    expect(await store.keepLocalPerson(person({ stage: 'ready' }))).toBe(true);
    expect(await store.keepLocalPerson(person({ stage: 'asking', profileId: 'second' }))).toBe(false);
    expect(await store.keepLocalPerson(person({ stage: 'filling' }))).toBe(false);
    expect(await store.updateLocalPerson('second', (p) => p)).toBeNull();
    await store.forgetLocalPerson('second');
    expect((await store.readLocalPerson())?.profileId).toBe('newcomer-1');
    await store.forgetLocalPerson('newcomer-1');
    expect(await store.readLocalPerson()).toBeNull();
    expect(fake.secure.size).toBe(0);
  });

  it('two writes at once: the first wins, the second is judged against it', async () => {
    const store = await load();
    const [a, b] = await Promise.all([store.keepLocalPerson(person({ stage: 'ready', profileId: 'a' })), store.keepLocalPerson(person({ stage: 'ready', profileId: 'b' }))]);
    expect([a, b]).toEqual([true, false]);
    expect((await store.readLocalPerson())?.profileId).toBe('a');
  });
});
