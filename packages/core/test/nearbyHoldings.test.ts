import { createHash } from 'node:crypto';
import fc from 'fast-check';
import type { ChainLink, RevocationList } from '../src/nearbyChain';
import type { OrgState } from '../src/org';
import {
  NEARBY_HOLDINGS_MAX_FILES, backupsConfirmedOf, copiesOf, holdingsInForce, mergeHoldings, nearbyEvictableOf, nearbyShedOf, parseHoldings, summaryText, withMyHolding,
  type HoldingEntry, type Holdings, type NearbyMark
} from '../src/nearbyHoldings';
import { holdingsFilesHash, holdingsText, nearbyBytes } from '../src/nearbySigning';
import { HOLDINGS_FILES, PUBLIC_KEY, SUMMARY_TEXT } from './nearbyVectors';

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());
const SIG = 'A'.repeat(86);
const KEY = (c: string) => `${c.repeat(42)}A`;
const FILE = (c: string) => c.repeat(64);
const chainOf = (profileId: string) => [{ kind: 'worker@1', kid: 'k', body: { profileId }, sig: SIG }] as unknown as ChainLink[];
const entry = (counter: number, files: string[], over: Partial<HoldingEntry> = {}): HoldingEntry => ({ counter, files, hold: false, sig: SIG, chain: chainOf('p'), ...over });

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

  it('a tie on files goes to the row off, so whoever merges whom agrees on whether the owner keeps them', () => {
    const off = entry(2, [FILE('a')]);
    const on = entry(2, [FILE('a')], { hold: true });
    for (const [x, y] of [[off, on], [on, off]]) expect(mergeHoldings(new Map([[KEY('a'), x!]]), new Map([[KEY('a'), y!]]), me).get(KEY('a'))).toBe(off);
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
      hold: fc.boolean(),
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
  const me = (signed: Uint8Array[] = [], hold = false) => ({
    key: PUBLIC_KEY, orgId: 'org1', streamId: 'lang1', chain: chainOf('p'), hold, sha256,
    sign: async (message: Uint8Array) => { signed.push(message); return SIG; }
  });

  it('starts at one, sorted and with no repeats, and signs the text the receiver will work out', async () => {
    const signed: Uint8Array[] = [];
    const out = await withMyHolding(new Map(), [FILE('b'), FILE('a'), FILE('b')], me(signed));
    expect(out.get(PUBLIC_KEY)).toEqual({ counter: 1, files: [FILE('a'), FILE('b')], hold: false, sig: SIG, chain: chainOf('p') });
    const filesHash = await holdingsFilesHash([FILE('a'), FILE('b')], sha256);
    expect(signed).toEqual([nearbyBytes('holdings', holdingsText({ orgId: 'org1', streamId: 'lang1', key: PUBLIC_KEY, counter: 1, filesHash, hold: false }))]);
  });

  it('signs whether the row is on, and bumps when only that changed', async () => {
    const signed: Uint8Array[] = [];
    const on = await withMyHolding(new Map(), [FILE('a')], me(signed, true));
    expect(on.get(PUBLIC_KEY)?.hold).toBe(true);
    const filesHash = await holdingsFilesHash([FILE('a')], sha256);
    expect(signed).toEqual([nearbyBytes('holdings', holdingsText({ orgId: 'org1', streamId: 'lang1', key: PUBLIC_KEY, counter: 1, filesHash, hold: true }))]);
    expect(await withMyHolding(on, [FILE('a')], me([], true))).toBe(on);
    const off = await withMyHolding(on, [FILE('a')], me());
    expect(off.get(PUBLIC_KEY)).toMatchObject({ counter: 2, files: [FILE('a')], hold: false });
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
  const good = { counter: 1, files: [FILE('a'), FILE('b')], hold: true, sig: SIG, chain: chainOf('p') };

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
      { ...good, chain: [[]] }, { ...good, chain: [null] }, { ...good, hold: undefined }, { ...good, hold: 'true' }, { ...good, hold: 1 }, { ...good, chain: Array.from({ length: 5 }, () => ({})) }]) {
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

// ---- what a phone keeps (docs/nearby-sync-plan.md 5.6, section 8's freeing-space and hold rows) ----

const mark = (c: string, group: NearbyMark['group'], copies = 0, languageId = 'lang1'): NearbyMark => ({ hash: FILE(c), format: 'm4a', languageId, group, copies });

describe('nearbyEvictableOf', () => {
  const sizes = new Map([[FILE('a'), 10], [FILE('b'), 30], [FILE('c'), 20], [FILE('d'), 5], [FILE('e'), 40], [FILE('f'), 50]]);
  const all = new Set(sizes.keys());
  const none = () => false;

  it('a marked file no reference names first, then backups, then files open for review; never a needed one', () => {
    const marks = [mark('a', 'review'), mark('b', 'backup'), mark('c', 'unnamed'), mark('d', 'needed')];
    expect(nearbyEvictableOf(marks, all, sizes, none).map((r) => r.hash)).toEqual([FILE('c'), FILE('b'), FILE('a')]);
  });

  it('within a group the most known copies go first, so a last copy goes last, then the largest, then by hash', () => {
    const marks = [mark('a', 'backup', 1), mark('b', 'backup', 0), mark('c', 'backup', 3), mark('e', 'backup', 1), mark('f', 'review', 9)];
    expect(nearbyEvictableOf(marks, all, sizes, none).map((r) => r.hash)).toEqual([FILE('c'), FILE('e'), FILE('a'), FILE('b'), FILE('f')]);
    const tie = [mark('b', 'backup'), mark('a', 'backup')];
    expect(nearbyEvictableOf(tie, all, new Map(), none).map((r) => r.hash)).toEqual([FILE('a'), FILE('b')]);
  });

  it('only files here, and a backup or review file the server has is level 1\'s, not this list\'s', () => {
    const marks = [mark('a', 'backup'), mark('b', 'review'), mark('c', 'unnamed'), mark('d', 'backup')];
    const stored = (h: string) => h !== FILE('d');
    expect(nearbyEvictableOf(marks, new Set([FILE('a'), FILE('b'), FILE('c'), FILE('d')]), sizes, stored).map((r) => r.hash)).toEqual([FILE('c'), FILE('d')]);
    expect(nearbyEvictableOf(marks, new Set([FILE('b')]), sizes, none)).toEqual([{ hash: FILE('b'), format: 'm4a' }]);
  });

  it('an unmarked file is never listed, whatever it is', () => {
    expect(nearbyEvictableOf([], all, sizes, none)).toEqual([]);
  });
});

describe('holdingsInForce', () => {
  const ME = KEY('m');
  const me = { key: ME, signedIn: 'me' };
  const certified = (key: string, profileId: string) => [{ kind: 'worker@1', kid: 'k', body: { installKey: key, profileId }, sig: SIG }] as unknown as ChainLink[];
  const invited = (inviterKey: string, inviter: string, profileId: string) => [...certified(inviterKey, inviter), { kind: 'invite@1', body: { profileId }, sig: SIG }] as unknown as ChainLink[];
  const list = (keys: RevocationList['keys']): RevocationList => ({ v: 1, kid: 'k', orgId: 'o', seq: 1, keys });
  const member = (removed: boolean[]) => Object.fromEntries(removed.map((r, i) => [`scope${i}`, { roleId: { value: 'translator' }, removed: { value: r }, scope: { level: 'org' } }]));
  const org = (members: Record<string, boolean[]>) => ({ members: Object.fromEntries(Object.entries(members).map(([id, r]) => [id, member(r)])) }) as unknown as OrgState;
  const holdings: Holdings = new Map([
    [KEY('a'), entry(1, [FILE('a')], { chain: certified(KEY('a'), 'sam'), hold: true })],
    [KEY('b'), entry(1, [FILE('b')], { chain: invited(KEY('i'), 'ana', 'nyibol'), hold: true })],
    [KEY('c'), entry(1, [FILE('c')], { chain: certified(KEY('c'), 'cy'), hold: true })]
  ]);

  it('keeps every entry with no list and no fold', () => {
    expect(holdingsInForce(holdings, {})).toBe(holdings);
  });

  it('drops an entry whose key and holder, or whose inviter\'s key and inviter, are on the list, and only that pair', () => {
    // Why: a revoked key's entry would count as a copy, so a phone with the row off would shed a file only a taken phone holds.
    expect([...holdingsInForce(holdings, { revoked: list([[KEY('a'), 'sam', 0]]) }).keys()]).toEqual([KEY('b'), KEY('c')]);
    expect([...holdingsInForce(holdings, { revoked: list([[KEY('a'), 'someone else', 0]]) }).keys()]).toEqual([KEY('a'), KEY('b'), KEY('c')]);
    expect([...holdingsInForce(holdings, { revoked: list([[KEY('b'), 'nyibol', 0]]) }).keys()]).toEqual([KEY('a'), KEY('c')]);
    expect([...holdingsInForce(holdings, { revoked: list([[KEY('i'), 'ana', 0]]) }).keys()]).toEqual([KEY('a'), KEY('c')]);
  });

  it('drops an entry whose holder or inviter has an entry in the fold and none of it live', () => {
    expect([...holdingsInForce(holdings, { org: org({ sam: [true], cy: [true, false] }) }).keys()]).toEqual([KEY('b'), KEY('c')]);
    expect([...holdingsInForce(holdings, { org: org({ ana: [true] }) }).keys()]).toEqual([KEY('a'), KEY('c')]);
    expect([...holdingsInForce(holdings, { org: org({ nyibol: [true] }) }).keys()]).toEqual([KEY('a'), KEY('c')]);
    // Someone the fold has never seen still counts: a newcomer, or a member added since.
    expect(holdingsInForce(holdings, { org: org({}) }).size).toBe(3);
  });

  it('so nothing is shed and no copy counted for a dropped entry\'s sake', () => {
    const marks = [mark('a', 'backup'), mark('c', 'backup')];
    const inForce = holdingsInForce(holdings, { revoked: list([[KEY('a'), 'sam', 0]]), org: org({ cy: [true] }) });
    expect(nearbyShedOf(marks, new Set(), holdings, me, () => false)).toEqual([FILE('a'), FILE('c')]);
    expect(nearbyShedOf(marks, new Set(), inForce, me, () => false)).toEqual([]);
    expect(copiesOf(inForce).get(FILE('a'))).toBeUndefined();
  });
});

describe('nearbyShedOf (the row off)', () => {
  const ME = KEY('m');
  const LOWER = KEY('c');
  const HIGHER = KEY('x');
  const me = { key: ME, signedIn: 'me' };
  const none = () => false;
  const held = (key: string, files: string[], profileId: string, hold = false): [string, HoldingEntry] => [key, entry(1, files, { chain: chainOf(profileId), hold })];

  it('sheds a file the server has at the size held here', () => {
    expect(nearbyShedOf([mark('a', 'backup'), mark('b', 'backup')], new Set(), new Map(), me, (h) => h === FILE('a'))).toEqual([FILE('a')]);
  });

  it('sheds one another person holds under a lower key, and keeps the last known copy', () => {
    const holdings = new Map([held(LOWER, [FILE('a')], 'sam')]);
    expect(nearbyShedOf([mark('a', 'backup'), mark('b', 'review')], new Set(), holdings, me, none)).toEqual([FILE('a')]);
  });

  it('a higher key with its row off does not count, so of two such phones only the higher sheds', () => {
    const marks = [mark('a', 'backup')];
    expect(nearbyShedOf(marks, new Set(), new Map([held(HIGHER, [FILE('a')], 'sam')]), me, none)).toEqual([]);
    // The two phones, each seeing the other: exactly one sheds.
    const low = { key: LOWER, signedIn: 'carla' };
    const shedLow = nearbyShedOf(marks, new Set(), new Map([held(ME, [FILE('a')], 'me')]), low, none);
    const shedMe = nearbyShedOf(marks, new Set(), new Map([held(LOWER, [FILE('a')], 'carla')]), me, none);
    expect([shedLow, shedMe]).toEqual([[], [FILE('a')]]);
  });

  it('a teammate whose row is on keeps the file, so a higher key holding it counts (the signed hold field)', () => {
    expect(nearbyShedOf([mark('a', 'backup')], new Set(), new Map([held(HIGHER, [FILE('a')], 'sam', true)]), me, none)).toEqual([FILE('a')]);
  });

  it('another install of whoever is signed in here does not count, nor does an entry with no certified person', () => {
    expect(nearbyShedOf([mark('a', 'backup')], new Set(), new Map([held(LOWER, [FILE('a')], 'me', true)]), me, none)).toEqual([]);
    const uncertified: Holdings = new Map([[LOWER, entry(1, [FILE('a')], { chain: [], hold: true })]]);
    expect(nearbyShedOf([mark('a', 'backup')], new Set(), uncertified, me, none)).toEqual([]);
    // This phone's own entry is never another copy.
    expect(nearbyShedOf([mark('a', 'backup')], new Set(), new Map([held(ME, [FILE('a')], 'sam', true)]), me, none)).toEqual([]);
  });

  it('a file in the wanted set never goes, and an unmarked file is never listed', () => {
    const holdings = new Map([held(LOWER, [FILE('a'), FILE('b')], 'sam', true)]);
    expect(nearbyShedOf([mark('a', 'needed'), mark('b', 'review')], new Set([FILE('a'), FILE('b')]), holdings, me, () => true)).toEqual([]);
    expect(nearbyShedOf([], new Set(), holdings, me, () => true)).toEqual([]);
  });

  it('no two phones with the row off shed the last copy between them, whatever they hold', () => {
    const keys = [KEY('a'), KEY('b'), KEY('c'), KEY('d')];
    fc.assert(fc.property(fc.array(fc.subarray([FILE('1'), FILE('2'), FILE('3')]), { minLength: 4, maxLength: 4 }), (lists) => {
      // Four phones of four people, every row off, each knowing every other's true entry.
      const holdings = new Map(keys.map((k, i) => [k, entry(1, [...lists[i]!].sort(), { chain: chainOf(`p${i}`) })] as [string, HoldingEntry]));
      const left = new Map<string, number>();
      keys.forEach((key, i) => {
        const marks = lists[i]!.map((h) => ({ hash: h, format: 'm4a', languageId: 'l', group: 'backup' as const, copies: 0 }));
        const shed = new Set(nearbyShedOf(marks, new Set(), holdings, { key, signedIn: `p${i}` }, none));
        for (const h of lists[i]!) if (!shed.has(h)) left.set(h, (left.get(h) ?? 0) + 1);
      });
      for (const h of new Set(lists.flat())) expect(left.get(h)).toBe(1);
    }));
  });
});

describe('backupsConfirmedOf', () => {
  it('lists backups the server holds at the size held here, and nothing else', () => {
    const marks = [mark('a', 'backup'), mark('b', 'backup'), mark('c', 'review'), mark('d', 'needed'), mark('e', 'backup'), mark('f', 'unnamed')];
    const verdicts = new Map([[FILE('a'), { stored: true, size: 10 }], [FILE('b'), { stored: true, size: 99 }], [FILE('c'), { stored: true, size: 10 }], [FILE('d'), { stored: true, size: 10 }], [FILE('f'), { stored: true, size: 10 }]]);
    const local = new Map([[FILE('a'), 10], [FILE('b'), 10], [FILE('c'), 10], [FILE('d'), 10], [FILE('e'), 10], [FILE('f'), 10]]);
    expect(backupsConfirmedOf(marks, (h) => verdicts.get(h), local)).toEqual([FILE('a')]);
    // A size not known here is not a confirmation.
    expect(backupsConfirmedOf([mark('a', 'backup')], (h) => verdicts.get(h), new Map())).toEqual([]);
  });
});
