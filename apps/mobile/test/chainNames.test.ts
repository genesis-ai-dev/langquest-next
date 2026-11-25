import { CHAIN_NAMES_KEPT, keepChainName, keepChainNames, namesNotMembers, withChainNames } from '../src/account/chainNamesModel';

/**
 * Names from checked chains (docs/nearby-sync-plan.md 14.1, 5 "Teammates"): someone let in
 * offline is shown under the name in their chain until the server knows them. Found on two
 * emulators: the inviter met the person it had just let in as "Someone".
 */
describe('names from checked chains', () => {
  it('fill only who the directory has no name for: the server\'s name wins once it has one', () => {
    expect(withChainNames({ ana: 'Ana' }, { nb: 'Nb', ana: 'Not Ana' })).toEqual({ ana: 'Ana', nb: 'Nb' });
    expect(withChainNames({}, {})).toEqual({});
  });

  it('keeps a name as typed at the join, and says when nothing changed', () => {
    expect(keepChainName({}, 'nb', '  Nb  ')).toEqual({ nb: 'Nb' });
    expect(keepChainName({ nb: 'Nb' }, 'nb', 'Nb')).toBeNull();
    expect(keepChainName({ nb: 'Nb' }, 'nb', 'Nyibol')).toEqual({ nb: 'Nyibol' });
  });

  it('refuses what no join could have named: empty, too long, control characters', () => {
    expect(keepChainName({}, 'nb', ' ')).toBeNull();
    expect(keepChainName({}, 'nb', 'x'.repeat(81))).toBeNull();
    expect(keepChainName({}, 'nb', 'a\u0007b')).toBeNull();
    expect(keepChainName({}, '', 'Nb')).toBeNull();
  });

  it('keeps a session\'s names in one go, each by the same rule, and says when nothing changed (review item 12)', () => {
    expect(keepChainNames({ ana: 'Ana' }, [{ profileId: 'nb', name: ' Nyibol ' }, { profileId: 'x', name: 'a\u0007b' }, { profileId: 'cy', name: 'Cy' }]))
      .toEqual({ ana: 'Ana', nb: 'Nyibol', cy: 'Cy' });
    expect(keepChainNames({ nb: 'Nyibol' }, [{ profileId: 'nb', name: 'Nyibol' }])).toBeNull();
    expect(keepChainNames({}, [])).toBeNull();
  });

  it('of a starting copy\'s names keeps as chain names those its organization does not list: people let in offline', () => {
    expect(namesNotMembers({ ana: 'Ana', nb: 'Nyibol', me: 'Me' }, { ana: {} }, 'me')).toEqual([{ profileId: 'nb', name: 'Nyibol' }]);
    expect(namesNotMembers({ ana: 'Ana' }, { ana: {} }, 'me')).toEqual([]);
    // An id a plain object inherits is a name like any other, never a member by inheritance.
    expect(namesNotMembers({ toString: 'T' }, {}, 'me')).toEqual([{ profileId: 'toString', name: 'T' }]);
  });

  // The review of item 12's fix: a copy's sender may name tens of thousands, and each name rebuilt a record of 200.
  it('looks at no more names than it keeps, however many a teammate\'s copy brings', () => {
    let read = 0;
    const many = Array.from({ length: 50_000 }, (_, i) => ({ profileId: `p${i}`, get name() { read += 1; return `P ${i}`; } }));
    const kept = keepChainNames({ ana: 'Ana' }, many)!;
    expect(read).toBe(CHAIN_NAMES_KEPT);
    expect(Object.keys(kept)).toHaveLength(CHAIN_NAMES_KEPT);
    expect(kept['p49999']).toBe('P 49999');
    expect(kept['p0']).toBeUndefined();
    const names = Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`p${i}`, `P ${i}`]));
    const notMembers = namesNotMembers(names, { p49999: {} }, 'me');
    expect(notMembers).toHaveLength(CHAIN_NAMES_KEPT);
    expect(notMembers.at(-1)).toEqual({ profileId: 'p49998', name: 'P 49998' });
  });

  it('holds the newest few, so a long life of meetings stays small', () => {
    let held: Record<string, string> = {};
    for (let i = 0; i < CHAIN_NAMES_KEPT + 5; i++) held = keepChainName(held, `p${i}`, `P ${i}`) ?? held;
    expect(Object.keys(held)).toHaveLength(CHAIN_NAMES_KEPT);
    expect(held[`p${CHAIN_NAMES_KEPT + 4}`]).toBe(`P ${CHAIN_NAMES_KEPT + 4}`);
    expect(held['p0']).toBeUndefined();
  });
});
