import { encodeHlc } from '@langquest-next/core';
import { readyToCarryOf, seenOf, wallOf, type CarryFacts } from '../src/nearby/readyToCarryModel';

// Ready to carry on Share nearby (docs/nearby-sync-plan.md 5.8): what this phone holds of what it
// knows, what is missing and why, and each teammate by how recent the newest work held from them is.

const DAY = 86_400_000;
const TODAY = 1_700_000_000_000 - (1_700_000_000_000 % DAY);
const hlc = (ms: number, node = 'd') => encodeHlc(ms, 0, node);

const facts = (over: Partial<CarryFacts> = {}): CarryFacts => ({
  me: 'me', myKey: 'K-me', members: [], names: new Map(), vectorKeys: [], holdings: new Map(), present: new Set(), batches: [], inRange: [],
  hold: true, noRoom: false, pulledUnshared: false, olderFromServer: false, farAhead: [], lastOnlineMs: TODAY - 3 * DAY, todayStartMs: TODAY,
  ...over
});

describe('Ready to carry', () => {
  it('holds everything when every recording teammates hold is here and nothing waits on the Worker', () => {
    const r = readyToCarryOf(facts({ holdings: new Map([['K-sam', { files: ['a', 'b'] }], ['K-me', { files: ['a'] }]]), present: new Set(['a', 'b']) }));
    expect(r).toMatchObject({ everything: true, missing: 0, coming: 0, elsewhere: [] });
  });

  it('counts what teammates hold and this phone lacks: still coming from someone in range, else on whose phone it stays', () => {
    const r = readyToCarryOf(facts({
      names: new Map([['K-sam', 'sam'], ['K-ana', 'ana']]),
      holdings: new Map([['K-sam', { files: ['a', 'b'] }], ['K-ana', { files: ['b', 'c'] }], ['K-x', { files: ['d'] }], ['K-me', { files: ['z'] }]]),
      present: new Set(['z']), inRange: ['K-ana', null]
    }));
    expect(r.everything).toBe(false);
    expect(r.missing).toBe(4);
    expect(r.coming).toBe(2);
    expect(r.elsewhere).toEqual([{ profileId: 'sam', files: 1 }, { profileId: null, files: 1 }]);
  });

  // Found on two emulators: a new person was told a recording was missing that the server had stored, from a teammate's older holdings.
  it('counts nothing the server has stored as missing: it needs no carrying, whatever an older holdings entry says', () => {
    const r = readyToCarryOf(facts({
      names: new Map([['K-sam', 'sam']]), holdings: new Map([['K-sam', { files: ['a', 'b'] }]]), present: new Set(), onServer: new Set(['a'])
    }));
    expect(r).toMatchObject({ missing: 1, elsewhere: [{ profileId: 'sam', files: 1 }] });
    expect(readyToCarryOf(facts({ holdings: new Map([['K-sam', { files: ['a'] }]]), onServer: new Set(['a']) })).everything).toBe(true);
  });

  it('never counts this phone\'s own entry, and says when the row is off, there is no room, or pulled rows wait', () => {
    expect(readyToCarryOf(facts({ holdings: new Map([['K-me', { files: ['gone'] }]]) })).everything).toBe(true);
    expect(readyToCarryOf(facts({ hold: false }))).toMatchObject({ everything: false, notAllRecordings: true });
    expect(readyToCarryOf(facts({ noRoom: true }))).toMatchObject({ everything: false, noRoom: true });
    expect(readyToCarryOf(facts({ pulledUnshared: true }))).toMatchObject({ everything: false, pulledUnshared: true });
    expect(readyToCarryOf(facts({ olderFromServer: true, farAhead: [{ actorId: 'sam' }, { actorId: 'sam' }] }))).toMatchObject({ olderFromServer: true, farAhead: ['sam'] });
  });

  it('lists teammates from the members, the vector, the holdings and the batches, never the person signed in', () => {
    const r = readyToCarryOf(facts({
      members: ['me', 'ana', 'joe'], names: new Map([['K-sam', 'sam'], ['K-lee', 'lee'], ['K-me2', 'me']]), vectorKeys: ['K-sam', 'K-me2'],
      holdings: new Map([['K-lee', { files: [] }]]), batches: [{ key: 'K-kim', actorId: 'kim', firstHlc: hlc(TODAY + 1000) }]
    }));
    expect(r.teammates.map((m) => m.profileId).sort()).toEqual(['ana', 'joe', 'kim', 'lee', 'sam']);
    expect(r.teammates[0]).toEqual({ profileId: 'kim', seen: 'today', newestMs: TODAY + 1000 });
  });

  it('says how recent the newest work held from each is, by its author\'s clock, relayed or not', () => {
    const r = readyToCarryOf(facts({
      batches: [
        { key: 'K-sam', actorId: 'sam', firstHlc: hlc(TODAY - 2 * DAY) },
        { key: 'K-sam', actorId: 'sam', firstHlc: hlc(TODAY - 5 * DAY) },
        { key: 'K-ana', actorId: 'ana', firstHlc: hlc(TODAY - 4 * DAY) },
        { key: 'K-other', actorId: 'joe', firstHlc: null }
      ]
    }));
    expect(r.teammates).toEqual([
      { profileId: 'sam', seen: 'since-online', newestMs: TODAY - 2 * DAY },
      { profileId: 'ana', seen: 'not-since-online', newestMs: TODAY - 4 * DAY },
      { profileId: 'joe', seen: 'not-since-online', newestMs: null }
    ]);
  });

  it('counts work as since the last time online when this phone has nothing from the server to place it before', () => {
    expect(seenOf(TODAY - DAY, null, TODAY)).toBe('since-online');
    expect(seenOf(null, null, TODAY)).toBe('not-since-online');
    expect(seenOf(TODAY + 5, TODAY + 10, TODAY)).toBe('today');
    expect(wallOf('nonsense')).toBeNull();
    expect(wallOf(null)).toBeNull();
  });
});
