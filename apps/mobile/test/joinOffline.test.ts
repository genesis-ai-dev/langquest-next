import { afterCopy, afterGrant, askingRecord, goOnOnline, JOIN_START, joinEndOf, joinName, joinReducer, notEmptyWhy, seedsFor, type JoinAction, type JoinStage } from '../src/nearby/joinOfflineModel';
import { keepGrant, setWhenWhole, type GrantStores } from '../src/nearby/joinGrant';
import type { LocalPerson } from '../src/session/localPersonModel';
import { inviteChain, KEY, person } from './localPersonFixtures';

/**
 * Joining offline on the newcomer's phone (docs/nearby-sync-plan.md 14.1, 3 to 5). Why these
 * tests: a newcomer may join only a phone with nobody on it, or a local person would lock out
 * everyone signed out there; a grant must be kept in the record and where signing reads it, with
 * its discovery key, though no session exists; and the person is set only once the copy is whole,
 * because the app remounts on the actor id.
 */

const empty = { session: false, locks: false, handOvers: false, local: null, unsent: false };

describe('only a phone with nobody on it takes a newcomer', () => {
  it('refuses a session, a lock, a hand-over, a granted local person, unsent work or a cover, and says which', () => {
    expect(notEmptyWhy(empty)).toBeNull();
    expect(notEmptyWhy({ ...empty, session: true })).toBe('session');
    expect(notEmptyWhy({ ...empty, locks: true })).toBe('locks');
    expect(notEmptyWhy({ ...empty, handOvers: true })).toBe('hand-over');
    expect(notEmptyWhy({ ...empty, unsent: true })).toBe('unsent');
    expect(notEmptyWhy({ ...empty, worn: true })).toBe('cover');
    for (const stage of ['filling', 'ready', 'joined', 'done'] as const) expect(notEmptyWhy({ ...empty, local: person({ stage }) })).toBe('local-person');
    // A leftover record with nothing granted is no one: a new key replaces it.
    expect(notEmptyWhy({ ...empty, local: person({ stage: 'asking' }) })).toBeNull();
  });

  it('keeps a leftover ask only with the same key and name, so a dropped link gets the same id', () => {
    const left = person({ stage: 'asking' });
    expect(askingRecord(left, KEY, 'Nyibol')).toBe(left);
    expect(askingRecord(left, 'Z'.repeat(43), 'Nyibol')).toBeNull();
    expect(askingRecord(left, KEY, 'Someone')).toBeNull();
    expect(askingRecord(left, null, 'Nyibol')).toBeNull();
    expect(askingRecord(person({ stage: 'filling' }), KEY, 'Nyibol')).toBeNull();
  });
});

describe('the grant and the copy', () => {
  const asked = person({ stage: 'asking' });
  const grant = { chain: inviteChain({ profileId: asked.profileId }), orgId: 'org-1', languageId: 'lang-1', discovery: { key: 'k'.repeat(43), gen: 4, floor: 2 } };

  function stores(o: { keep?: boolean; find?: boolean } = {}) {
    const log: string[] = [];
    const kept: LocalPerson[] = [];
    const chains: Record<string, Record<string, unknown[]>> = {};
    const find: Record<string, string> = {};
    const seeds = new Map<string, string>();
    const missed: string[] = [];
    const s: GrantStores = {
      keepLocalPerson: async (p) => { log.push('record'); if (o.keep === false) return false; kept.push(p); return true; },
      keepChains: async (id, c) => { log.push('chain'); chains[id] = c; },
      keepFindKeys: async (id, raw) => { log.push('key'); if (o.find === false) return false; find[id] = raw; return true; },
      seed: async (pairs) => { log.push('seed'); for (const [k, v] of pairs) seeds.set(k, v); },
      missed: (w) => missed.push(w)
    };
    return { s, log, kept, chains, find, seeds, missed };
  }

  it('keeps the chain in the record and in nearbyChain, then the discovery key with no session, then the first start\'s seeds', async () => {
    const t = stores();
    const next = await keepGrant(asked, grant, t.s);
    expect(t.log).toEqual(['record', 'chain', 'key', 'seed']);
    expect(next).toMatchObject({ stage: 'filling', chain: grant.chain, profileId: asked.profileId });
    expect(t.kept).toEqual([next]);
    expect(t.chains[asked.profileId]).toEqual({ 'org-1': grant.chain });
    expect(JSON.parse(t.find[asked.profileId]!)).toEqual({ 'org-1/lang-1': { gen: 4, key: 'k'.repeat(43), floor: 2, direct: false } });
    expect(t.seeds.get(`selection:${asked.profileId}`)).toBe(JSON.stringify({ orgId: 'org-1' }));
    expect(t.seeds.get(`language:${asked.profileId}:org-1`)).toBe('lang-1');
    expect(t.seeds.get(`joined:${asked.profileId}`)).toBe('1');
  });

  it('a grant the record will not take keeps nothing at all, and the session asks for no copy', async () => {
    const t = stores({ keep: false });
    await expect(keepGrant(asked, grant, t.s)).rejects.toThrow();
    expect(t.log).toEqual(['record']);
    const other = stores();
    await expect(keepGrant(asked, { ...grant, chain: inviteChain({ profileId: 'someone-else' }) }, other.s)).rejects.toThrow();
    expect(other.log).toEqual([]);
  });

  it('a key that could not be kept is said, and the grant still stands', async () => {
    const t = stores({ find: false });
    await keepGrant(asked, grant, t.s);
    expect(t.missed).toEqual(['discovery key']);
    expect(t.log).toEqual(['record', 'chain', 'key', 'seed']);
  });

  it('sets the person only once the copy is whole', async () => {
    const filling = afterGrant(asked, grant.chain)!;
    const set: LocalPerson[] = [];
    const keep = async (p: LocalPerson) => { set.push(p); return true; };
    expect(await setWhenWhole(filling, false, keep)).toBe(false);
    expect(await setWhenWhole(null, true, keep)).toBe(false);
    expect(set).toEqual([]);
    expect(await setWhenWhole(filling, true, keep)).toBe(true);
    expect(set).toEqual([{ ...filling, stage: 'ready' }]);
    expect(afterCopy(asked, true)).toBeNull();
    expect(afterCopy(person({ stage: 'ready' }), true)).toBeNull();
  });

  // Carl, 2026-11-09: online, a copy left part way needs no teammate. Found on two emulators: such a person sat on the join screen online and never reached the server.
  it('sets a person whose copy stopped part way once the server answers, and no one else', () => {
    const filling = afterGrant(asked, grant.chain)!;
    expect(goOnOnline(filling)).toEqual({ ...filling, stage: 'ready' });
    for (const stage of ['asking', 'ready', 'joined', 'done'] as const) expect(goOnOnline(person({ stage }))).toBeNull();
  });

  it('seeds the names the copy gave, with the person\'s own, and leaves out what is not a name', () => {
    const seeds = new Map(seedsFor({ profileId: 'n1', orgId: 'o', languageId: 'l', name: ' Nyibol ', names: { ana: 'Ana', blank: ' ', bad: 3 as unknown as string } }));
    expect(JSON.parse(seeds.get('profile-directory:n1')!)).toEqual({ ana: 'Ana', n1: 'Nyibol' });
  });
});

describe('the progress screen', () => {
  const run = (...actions: JoinAction[]): JoinStage => actions.reduce(joinReducer, JOIN_START);

  it('goes from the name through the ask and the copy to whole', () => {
    const begun: JoinAction[] = [{ t: 'checked', notEmpty: null, code: true, filling: false }, { t: 'start' }, { t: 'asked', pictures: [3, 9] }];
    expect(run(...begun)).toEqual({ t: 'asked', pictures: [3, 9] });
    expect(run(...begun, { t: 'granted' }, { t: 'part' }, { t: 'part' })).toEqual({ t: 'copying', parts: 2 });
    expect(run(...begun, { t: 'granted' }, { t: 'copied', whole: true })).toEqual({ t: 'whole' });
  });

  it('says why a phone that holds someone\'s work cannot join, and asks for a code when none was scanned', () => {
    expect(run({ t: 'checked', notEmpty: 'locks', code: true, filling: false })).toEqual({ t: 'not-empty', why: 'locks' });
    expect(run({ t: 'checked', notEmpty: null, code: false, filling: false })).toEqual({ t: 'no-code' });
    expect(run({ t: 'checked', notEmpty: null, code: false, filling: true })).toEqual({ t: 'unfinished' });
    // The local person the check sees is the one whose copy is left to finish.
    expect(run({ t: 'checked', notEmpty: 'local-person', code: false, filling: true })).toEqual({ t: 'unfinished' });
  });

  it('after the grant a drop leaves the copy to finish, never a new code; before it, a new code', () => {
    const granted: JoinAction[] = [{ t: 'checked', notEmpty: null, code: true, filling: false }, { t: 'start' }, { t: 'granted' }];
    expect(run(...granted, { t: 'ended', why: 'dropped' })).toEqual({ t: 'unfinished' });
    expect(run(...granted, { t: 'copied', whole: false })).toEqual({ t: 'unfinished' });
    expect(run(...granted, { t: 'copied', whole: false }, { t: 'look' }, { t: 'look-stopped' })).toEqual({ t: 'unfinished' });
    expect(run({ t: 'checked', notEmpty: null, code: true, filling: false }, { t: 'start' }, { t: 'ended', why: 'not-let-in' })).toEqual({ t: 'ended', why: 'not-let-in' });
  });

  it('goes on when the server answers while the copy is left to finish, and not before the grant', () => {
    const left: JoinAction[] = [{ t: 'checked', notEmpty: null, code: false, filling: true }];
    expect(run(...left, { t: 'online' })).toEqual({ t: 'whole' });
    expect(run(...left, { t: 'look' }, { t: 'online' })).toEqual({ t: 'whole' });
    expect(run(...left, { t: 'look' }, { t: 'wifi-off' }, { t: 'online' })).toEqual({ t: 'whole' });
    // Before the grant there is no one to set: the server's answer changes nothing.
    expect(run({ t: 'checked', notEmpty: null, code: true, filling: false }, { t: 'online' })).toEqual({ t: 'name' });
    expect(run({ t: 'checked', notEmpty: null, code: true, filling: false }, { t: 'start' }, { t: 'online' })).toEqual({ t: 'connecting' });
    // A copy still coming goes on coming; the screen goes on only once it has stopped.
    expect(run({ t: 'checked', notEmpty: null, code: true, filling: false }, { t: 'start' }, { t: 'granted' }, { t: 'online' })).toEqual({ t: 'copying', parts: 0 });
  });

  it('says when the teammate met runs another version, and keeps saying so while looking on', () => {
    const left: JoinAction[] = [{ t: 'checked', notEmpty: null, code: false, filling: true }, { t: 'look' }];
    expect(run(...left, { t: 'other-version' })).toEqual({ t: 'looking', otherVersion: true });
    expect(run(...left, { t: 'other-version' }, { t: 'look-stopped' })).toEqual({ t: 'unfinished', otherVersion: true });
    expect(run(...left, { t: 'other-version' }, { t: 'look-stopped' }, { t: 'look' })).toEqual({ t: 'looking', otherVersion: true });
    expect(run(...left, { t: 'other-version' }, { t: 'copied', whole: true })).toEqual({ t: 'whole' });
    // Only while a copy is left to finish.
    expect(run({ t: 'checked', notEmpty: null, code: true, filling: false }, { t: 'other-version' })).toEqual({ t: 'name' });
  });

  it('reads how a session ended for someone not let in', () => {
    const base = { versionsDiffer: false, clockOff: false, join: { granted: false, refused: null } };
    expect(joinEndOf({ ...base, ended: { how: 'heard', reason: 'stopped' } })).toBe('not-let-in');
    expect(joinEndOf({ ...base, ended: { how: 'silent' } })).toBe('no-answer');
    expect(joinEndOf({ ...base, versionsDiffer: true, ended: { how: 'said', reason: 'protocol' } })).toBe('versions');
    expect(joinEndOf({ ...base, clockOff: true, ended: { how: 'said', reason: 'protocol' } })).toBe('clock');
    expect(joinEndOf({ ...base, ended: { how: 'said', reason: 'identity' } })).toBe('refused');
    expect(joinEndOf({ ...base, ended: { how: 'dropped' } })).toBe('dropped');
  });

  it('takes a name of 1 to 80 characters with no control character', () => {
    expect(joinName('  Nyibol   Deng ')).toBe('Nyibol Deng');
    expect(joinName('   ')).toBeNull();
    expect(joinName('x'.repeat(81))).toBeNull();
    expect(joinName('a\u0007b')).toBeNull();
  });
});
