import { createHash } from 'node:crypto';
import fc from 'fast-check';
import type { ChainLink } from '../src/nearbyChain';
import { NEARBY_HOLDINGS_MAX_FILES, copiesOf, mergeHoldings, parseHoldings, summaryText, withMyHolding, type HoldingEntry, type Holdings } from '../src/nearbyHoldings';
import { holdingsFilesHash, holdingsText, nearbyBytes } from '../src/nearbySigning';
import { HOLDINGS_FILES, PUBLIC_KEY, SUMMARY_TEXT } from './nearbyVectors';

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());
const SIG = 'A'.repeat(86);
const KEY = (c: string) => `${c.repeat(42)}A`;
const FILE = (c: string) => c.repeat(64);
const chainOf = (profileId: string) => [{ kind: 'worker@1', kid: 'k', body: { profileId }, sig: SIG }] as unknown as ChainLink[];
const entry = (counter: number, files: string[], over: Partial<HoldingEntry> = {}): HoldingEntry => ({ counter, files, sig: SIG, chain: chainOf('p'), ...over });

describe('mergeHoldings', () => {
  const me = KEY('m');

  it('takes the higher counter wholesale, so a phone can retract a file', () => {
    const merged = mergeHoldings(new Map([[KEY('a'), entry(1, [FILE('a'), FILE('b')])]]), new Map([[KEY('a'), entry(2, [FILE('b')])]]), me);
    expect(merged.get(KEY('a'))?.files).toEqual([FILE('b')]);
    const back = mergeHoldings(new Map([[KEY('a'), entry(2, [FILE('b')])]]), new Map([[KEY('a'), entry(1, [FILE('a')])]]), me);
    expect(back.get(KEY('a'))?.files).toEqual([FILE('b')]);
  });

  it('adds a key it did not know', () => {
    expect(mergeHoldings(new Map(), new Map([[KEY('a'), entry(1, [])]]), me).has(KEY('a'))).toBe(true);
  });

  it('skips this phone\'s own key, so nobody can move its entry or its counter', () => {
    const mine = entry(3, [FILE('a')]);
    const merged = mergeHoldings(new Map([[me, mine]]), new Map([[me, entry(99, [FILE('b')])]]), me);
    expect(merged.get(me)).toBe(mine);
    expect(mergeHoldings(new Map(), new Map([[me, entry(99, [])]]), me).has(me)).toBe(false);
  });

  it('a tie with different files goes to the lower list, whoever merges whom', () => {
    const lo = entry(2, [FILE('a')]);
    const hi = entry(2, [FILE('b')]);
    for (const [x, y] of [[lo, hi], [hi, lo]]) {
      expect(mergeHoldings(new Map([[KEY('a'), x!]]), new Map([[KEY('a'), y!]]), me).get(KEY('a'))).toBe(lo);
    }
  });

  it('a tie on files goes by signature and then chain, whoever merges whom', () => {
    const a = entry(2, [FILE('a')], { sig: `A${'A'.repeat(85)}` });
    const b = entry(2, [FILE('a')], { sig: `B${'A'.repeat(85)}` });
    expect(mergeHoldings(new Map([[KEY('a'), b]]), new Map([[KEY('a'), a]]), me).get(KEY('a'))).toBe(a);
    const c = entry(2, [FILE('a')], { chain: chainOf('p1') });
    const d = entry(2, [FILE('a')], { chain: chainOf('p2') });
    expect(mergeHoldings(new Map([[KEY('a'), d]]), new Map([[KEY('a'), c]]), me).get(KEY('a'))).toBe(c);
    expect(mergeHoldings(new Map([[KEY('a'), c]]), new Map([[KEY('a'), d]]), me).get(KEY('a'))).toBe(c);
  });

  it('leaves what it was given alone', () => {
    const start: Holdings = new Map([[KEY('a'), entry(1, [])]]);
    mergeHoldings(start, new Map([[KEY('b'), entry(1, [])]]), me);
    expect(start.size).toBe(1);
  });

  describe('merging is commutative, associative and idempotent', () => {
    const anEntry = fc.record({
      counter: fc.integer({ min: 0, max: 3 }),
      files: fc.uniqueArray(fc.constantFrom(FILE('a'), FILE('b'), FILE('c')), { maxLength: 3 }).map((f) => f.sort()),
      sig: fc.constantFrom(SIG, `B${SIG.slice(1)}`),
      chain: fc.constantFrom('p1', 'p2').map(chainOf)
    });
    const holdings = fc.array(fc.tuple(fc.constantFrom(KEY('a'), KEY('b'), KEY('c')), anEntry), { maxLength: 6 }).map((rows) => new Map(rows) as Holdings);
    const same = (x: Holdings, y: Holdings) => {
      expect(new Map([...x].sort(([a], [b]) => (a < b ? -1 : 1)))).toEqual(new Map([...y].sort(([a], [b]) => (a < b ? -1 : 1))));
    };
    const merge = (x: Holdings, y: Holdings) => mergeHoldings(x, y, me);

    it('commutative', () => fc.assert(fc.property(holdings, holdings, (a, b) => { same(merge(a, b), merge(b, a)); })));
    it('associative', () => fc.assert(fc.property(holdings, holdings, holdings, (a, b, c) => { same(merge(merge(a, b), c), merge(a, merge(b, c))); })));
    it('idempotent', () => fc.assert(fc.property(holdings, holdings, (a, b) => {
      same(merge(a, a), a);
      same(merge(merge(a, b), b), merge(a, b));
    })));
  });
});

describe('withMyHolding', () => {
  const me = (signed: Uint8Array[] = []) => ({
    key: PUBLIC_KEY, orgId: 'org1', streamId: 'lang1', chain: chainOf('p'), sha256,
    sign: async (message: Uint8Array) => { signed.push(message); return SIG; }
  });

  it('starts at one, sorted and with no repeats, and signs the text the receiver will work out', async () => {
    const signed: Uint8Array[] = [];
    const out = await withMyHolding(new Map(), [FILE('b'), FILE('a'), FILE('b')], me(signed));
    expect(out.get(PUBLIC_KEY)).toEqual({ counter: 1, files: [FILE('a'), FILE('b')], sig: SIG, chain: chainOf('p') });
    const filesHash = await holdingsFilesHash([FILE('a'), FILE('b')], sha256);
    expect(signed).toEqual([nearbyBytes('holdings', holdingsText({ orgId: 'org1', streamId: 'lang1', key: PUBLIC_KEY, counter: 1, filesHash }))]);
  });

  it('bumps only when the set changed, whatever order it comes in', async () => {
    const signed: Uint8Array[] = [];
    const first = await withMyHolding(new Map(), HOLDINGS_FILES, me());
    const again = await withMyHolding(first, [...HOLDINGS_FILES].reverse(), me(signed));
    expect(again).toBe(first);
    expect(signed).toEqual([]);
    const fewer = await withMyHolding(first, [HOLDINGS_FILES[0]!], me());
    expect(fewer.get(PUBLIC_KEY)?.counter).toBe(2);
    expect(fewer.get(PUBLIC_KEY)?.files).toEqual([HOLDINGS_FILES[0]]);
  });

  it('with no entry and no files there is nothing to say', async () => {
    const start: Holdings = new Map();
    expect(await withMyHolding(start, [], me())).toBe(start);
  });

  it('leaves out what is not a hash, and stops short of an unsafe counter', async () => {
    const out = await withMyHolding(new Map(), ['nope', FILE('a')], me());
    expect(out.get(PUBLIC_KEY)?.files).toEqual([FILE('a')]);
    const top: Holdings = new Map([[PUBLIC_KEY, entry(Number.MAX_SAFE_INTEGER, [])]]);
    expect(await withMyHolding(top, [FILE('a')], me())).toBe(top);
  });

  it('never jumps on a number it heard: merging one in leaves its own alone', async () => {
    const mine = await withMyHolding(new Map(), [FILE('a')], me());
    const heard = mergeHoldings(mine, new Map([[PUBLIC_KEY, entry(2 ** 40, [FILE('b')])]]), PUBLIC_KEY);
    const next = await withMyHolding(heard, [FILE('b')], me());
    expect(next.get(PUBLIC_KEY)?.counter).toBe(2);
  });
});

describe('copiesOf', () => {
  it('counts people, not keys, so inventing devices cannot make a last copy look safe', () => {
    const copies = copiesOf(new Map([
      [KEY('a'), entry(1, [FILE('a'), FILE('b')], { chain: chainOf('sam') })],
      [KEY('b'), entry(1, [FILE('a')], { chain: chainOf('sam') })],
      [KEY('c'), entry(1, [FILE('a')], { chain: chainOf('carla') })]
    ]));
    expect(copies.get(FILE('a'))).toBe(2);
    expect(copies.get(FILE('b'))).toBe(1);
    expect(copies.get(FILE('c'))).toBeUndefined();
  });

  it('a two-link chain counts as its first link\'s person, which errs the safe way', () => {
    const inviter = chainOf('sam');
    const twoLinks = [...inviter, { kind: 'invite@1', body: { profileId: 'newcomer' }, sig: SIG }] as unknown as ChainLink[];
    expect(copiesOf(new Map([[KEY('a'), entry(1, [FILE('a')], { chain: inviter })], [KEY('b'), entry(1, [FILE('a')], { chain: twoLinks })]])).get(FILE('a'))).toBe(1);
  });

  it('an entry with no certified person adds no copy', () => {
    expect(copiesOf(new Map([[KEY('a'), entry(1, [FILE('a')], { chain: [] })]])).size).toBe(0);
    const invite = [{ kind: 'invite@1', body: {}, sig: SIG }] as unknown as ChainLink[];
    expect(copiesOf(new Map([[KEY('a'), entry(1, [FILE('a')], { chain: invite })]])).size).toBe(0);
  });
});

describe('parseHoldings', () => {
  const good = { counter: 1, files: [FILE('a'), FILE('b')], sig: SIG, chain: chainOf('p') };

  it('reads a row into a Map', () => {
    expect(parseHoldings({})).toEqual(new Map());
    expect(parseHoldings({ [KEY('a')]: good })?.get(KEY('a'))).toEqual(good);
    expect(parseHoldings({ [KEY('a')]: { ...good, later: 1 } })?.get(KEY('a'))).toEqual(good);
  });

  it('refuses member names, as a key or in a chain, and the parse changes no prototype', () => {
    for (const name of ['__proto__', 'constructor', 'toString']) expect(parseHoldings(JSON.parse(`{"${name}":${JSON.stringify(good)}}`))).toBeNull();
    expect(parseHoldings({ [KEY('a')]: { ...good, chain: JSON.parse('[{"__proto__":{"a":1}}]') } })).toBeNull();
    expect(({} as Record<string, unknown>)['counter']).toBeUndefined();
  });

  it('refuses anything else, as a whole', () => {
    for (const bad of [null, 5, 'x', []]) expect(parseHoldings(bad)).toBeNull();
    expect(parseHoldings({ short: good })).toBeNull();
    for (const value of [null, 5, [], {}, { ...good, counter: -1 }, { ...good, counter: 1.5 }, { ...good, counter: 2 ** 53 }, { ...good, counter: '1' }, { ...good, files: 'x' },
      { ...good, files: ['nope'] }, { ...good, files: [FILE('b'), FILE('a')] }, { ...good, files: [FILE('a'), FILE('a')] }, { ...good, sig: 'short' }, { ...good, chain: 'x' }, { ...good, chain: [5] },
      { ...good, chain: [[]] }, { ...good, chain: [null] }, { ...good, chain: Array.from({ length: 5 }, () => ({})) }]) {
      expect(parseHoldings({ [KEY('a')]: value }), JSON.stringify(value)).toBeNull();
    }
  });

  it('refuses a chain nested too deep to check, since checking one recurses', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { deep };
    expect(parseHoldings({ [KEY('a')]: { ...good, chain: [{ deep }] } })).toBeNull();
  });

  it('caps sizes', () => {
    expect(parseHoldings({ [KEY('a')]: good }, { maxFiles: 2 })).not.toBeNull();
    expect(parseHoldings({ [KEY('a')]: good }, { maxFiles: 1 })).toBeNull();
    expect(parseHoldings({ [KEY('a')]: good, [KEY('b')]: good }, { maxKeys: 2 })?.size).toBe(2);
    expect(parseHoldings({ [KEY('a')]: good, [KEY('b')]: good }, { maxKeys: 1 })).toBeNull();
    expect(NEARBY_HOLDINGS_MAX_FILES).toBeGreaterThan(61_000);
    const many = Array.from({ length: NEARBY_HOLDINGS_MAX_FILES + 1 }, (_, i) => i.toString(16).padStart(64, '0'));
    expect(parseHoldings({ [KEY('a')]: { ...good, files: many } })).toBeNull();
    expect(parseHoldings({ [KEY('a')]: { ...good, files: many.slice(1) } })).not.toBeNull();
  });

  it('never throws', () => {
    fc.assert(fc.property(fc.jsonValue(), (raw) => {
      const out = parseHoldings(raw);
      expect(out === null || out instanceof Map).toBe(true);
    }));
  });
});

describe('summaryText', () => {
  it('matches the golden vector', () => {
    expect(summaryText(9, new Map([[PUBLIC_KEY, { mark: 2, ahead: [[5, 6]] }]]), new Map([[PUBLIC_KEY, { counter: 3 }]]), 1)).toBe(SUMMARY_TEXT);
  });

  it('an absent entry and an empty one compare equal, and an entry with only ranges counts', () => {
    const empty = summaryText(1, new Map(), new Map(), 0);
    expect(summaryText(1, new Map([[KEY('a'), { mark: 0, ahead: [] }]]), new Map(), 0)).toBe(empty);
    expect(summaryText(1, new Map([[KEY('a'), { mark: 0, ahead: [[2, 2]] }]]), new Map(), 0)).not.toBe(empty);
    expect(summaryText(1, new Map([[KEY('a'), { mark: 1, ahead: [] }]]), new Map(), 0)).not.toBe(empty);
  });

  it('holds what would give a phone something to offer: its seq, its counters, a newer list', () => {
    const base = summaryText(1, new Map(), new Map(), 0);
    expect(summaryText(2, new Map(), new Map(), 0)).not.toBe(base);
    expect(summaryText(1, new Map(), new Map([[KEY('a'), { counter: 1 }]]), 0)).not.toBe(base);
    expect(summaryText(1, new Map(), new Map(), 1)).not.toBe(base);
  });

  it('does not depend on the order of the maps', () => {
    const v = (a: boolean) => new Map([[KEY('a'), { mark: 1, ahead: [] }], [KEY('b'), { mark: 2, ahead: [] }]].sort(() => (a ? 1 : -1)) as [string, { mark: number; ahead: [] }][]);
    expect(summaryText(1, v(true), new Map(), 0)).toBe(summaryText(1, v(false), new Map(), 0));
  });
});
