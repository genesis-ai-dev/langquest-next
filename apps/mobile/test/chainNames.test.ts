import { CHAIN_NAMES_KEPT, keepChainName, withChainNames } from '../src/account/chainNamesModel';

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

  it('holds the newest few, so a long life of meetings stays small', () => {
    let held: Record<string, string> = {};
    for (let i = 0; i < CHAIN_NAMES_KEPT + 5; i++) held = keepChainName(held, `p${i}`, `P ${i}`) ?? held;
    expect(Object.keys(held)).toHaveLength(CHAIN_NAMES_KEPT);
    expect(held[`p${CHAIN_NAMES_KEPT + 4}`]).toBe(`P ${CHAIN_NAMES_KEPT + 4}`);
    expect(held['p0']).toBeUndefined();
  });
});
