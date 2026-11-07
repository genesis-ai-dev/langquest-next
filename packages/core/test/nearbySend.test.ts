import fc from 'fast-check';
import type { AnyEvent, LocalEventStatus } from '../src/events';
import {
  NEARBY_VECTOR_MAX_KEYS, NEARBY_VECTOR_MAX_RANGES, applyFloor, batchRowsToSend, countBatch, isCounted, parseVector, shouldClaim, type NearbyRow, type NearbyVector
} from '../src/nearbySend';
import { base64urlEncode } from '../src/nearbySigning';

const KEY_A = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w';
const keyOf = (n: number) => base64urlEncode(new Uint8Array(32).fill(n % 256).map((b, i) => (i === 0 ? n >> 8 : b)));
const parse = (raw: unknown) => parseVector(raw, { maxRanges: NEARBY_VECTOR_MAX_RANGES });

describe('parseVector', () => {
  it('reads a vector into a Map', () => {
    expect(parse({})).toEqual(new Map());
    expect(parse({ [KEY_A]: { mark: 2, ahead: [[4, 5], [7, 7]] } })).toEqual(new Map([[KEY_A, { mark: 2, ahead: [[4, 5], [7, 7]] }]]));
  });

  it('keeps only what it knows of an entry', () => {
    expect(parse({ [KEY_A]: { mark: 0, ahead: [], later: 1 } })?.get(KEY_A)).toEqual({ mark: 0, ahead: [] });
  });

  it('refuses anything else, as a whole', () => {
    const good = { mark: 2, ahead: [] };
    for (const bad of [null, 5, 'x', [], [good]]) expect(parse(bad)).toBeNull();
    for (const key of ['short', `${KEY_A}A`, '__proto__', 'constructor', KEY_A.replace('i', '+')]) {
      expect(parse(JSON.parse(`{"${KEY_A}":${JSON.stringify(good)},"${key}":${JSON.stringify(good)}}`))).toBeNull();
    }
    for (const entry of [null, 5, [], {}, { mark: 1 }, { ahead: [] }, { mark: -1, ahead: [] }, { mark: 1.5, ahead: [] }, { mark: 2 ** 53, ahead: [] }, { mark: '1', ahead: [] }, { mark: 1, ahead: 'x' }]) {
      expect(parse({ [KEY_A]: entry }), JSON.stringify(entry)).toBeNull();
    }
    for (const ahead of [[5], [[5]], [[5, 6, 7]], [[6, 5]], [[1, 2]], [[2, 3]], [[5, 6], [6, 7]], [[7, 8], [4, 5]], [[5, 2 ** 53]], [['5', 6]], [[5, 6.5]]]) {
      expect(parse({ [KEY_A]: { mark: 2, ahead } }), JSON.stringify(ahead)).toBeNull();
    }
  });

  it('caps ranges by the argument, and keys', () => {
    const ranges = (n: number) => Array.from({ length: n }, (_, i) => [2 * i + 2, 2 * i + 2]);
    expect(parseVector({ [KEY_A]: { mark: 0, ahead: ranges(3) } }, { maxRanges: 3 })).not.toBeNull();
    expect(parseVector({ [KEY_A]: { mark: 0, ahead: ranges(4) } }, { maxRanges: 3 })).toBeNull();
    const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [keyOf(i), { mark: 0, ahead: [] }]));
    expect(parseVector(keys(3), { maxRanges: 1, maxKeys: 3 })?.size).toBe(3);
    expect(parseVector(keys(4), { maxRanges: 1, maxKeys: 3 })).toBeNull();
    expect(parse(keys(NEARBY_VECTOR_MAX_KEYS))?.size).toBe(NEARBY_VECTOR_MAX_KEYS);
    expect(parse(keys(NEARBY_VECTOR_MAX_KEYS + 1))).toBeNull();
  });

  it('never throws, and a __proto__ key changes no prototype', () => {
    expect(parse(JSON.parse('{"__proto__":{"mark":1,"ahead":[]}}'))).toBeNull();
    expect(({} as Record<string, unknown>)['mark']).toBeUndefined();
    fc.assert(fc.property(fc.jsonValue(), (raw) => {
      const out = parse(raw);
      expect(out === null || out instanceof Map).toBe(true);
    }));
  });
});

describe('the vector', () => {
  const none: NearbyVector = new Map();
  const big = { maxRanges: 1000 };
  const count = (ns: number[], from: NearbyVector = none, opts = big) => ns.reduce((v, n) => countBatch(v, KEY_A, n, opts), from);

  it('moves the mark while numbers are in order', () => {
    expect(count([1, 2, 3]).get(KEY_A)).toEqual({ mark: 3, ahead: [] });
  });

  it('a gap stays open, at the cost of one range', () => {
    expect(count([1, 3, 4, 7]).get(KEY_A)).toEqual({ mark: 1, ahead: [[3, 4], [7, 7]] });
    expect(count([1, 3, 4, 7, 6]).get(KEY_A)).toEqual({ mark: 1, ahead: [[3, 4], [6, 7]] });
  });

  it('a number that fills a gap joins what is either side of it', () => {
    expect(count([1, 3, 5, 4]).get(KEY_A)).toEqual({ mark: 1, ahead: [[3, 5]] });
    expect(count([3, 2, 5, 1]).get(KEY_A)).toEqual({ mark: 3, ahead: [[5, 5]] });
  });

  it('what is counted says so, and counting it again changes nothing', () => {
    const v = count([1, 2, 5, 6]);
    for (const n of [0, 1, 2, 5, 6]) expect(isCounted(v, KEY_A, n), String(n)).toBe(true);
    for (const n of [3, 4, 7]) expect(isCounted(v, KEY_A, n), String(n)).toBe(false);
    expect(isCounted(v, 'someone else', 1)).toBe(false);
    expect(countBatch(v, KEY_A, 5, big)).toBe(v);
    expect(countBatch(v, KEY_A, 1, big)).toBe(v);
  });

  it('refuses a number that could not be one', () => {
    for (const n of [0, -1, 1.5, NaN, Infinity, 2 ** 53]) expect(countBatch(none, KEY_A, n, big)).toBe(none);
  });

  it('past the cap it records no number that neither fills nor extends a range, so a sender cannot force a gap closed', () => {
    const opts = { maxRanges: 2 };
    const full = count([2, 4], none, opts);
    expect(full.get(KEY_A)).toEqual({ mark: 0, ahead: [[2, 2], [4, 4]] });
    expect(countBatch(full, KEY_A, 9, opts)).toBe(full);
    expect(countBatch(full, KEY_A, 5, opts).get(KEY_A)).toEqual({ mark: 0, ahead: [[2, 2], [4, 5]] });
    expect(countBatch(full, KEY_A, 3, opts).get(KEY_A)).toEqual({ mark: 0, ahead: [[2, 4]] });
    expect(countBatch(full, KEY_A, 1, opts).get(KEY_A)).toEqual({ mark: 2, ahead: [[4, 4]] });
  });

  it('a floor moves only its signer\'s mark, and closes gaps below it', () => {
    const v = count([1, 3, 6]);
    expect(applyFloor(v, KEY_A, 4).get(KEY_A)).toEqual({ mark: 4, ahead: [[6, 6]] });
    expect(applyFloor(v, KEY_A, 5).get(KEY_A)).toEqual({ mark: 6, ahead: [] });
    expect(applyFloor(v, 'other', 5).get('other')).toEqual({ mark: 5, ahead: [] });
    expect(applyFloor(v, 'other', 5).get(KEY_A)).toEqual(v.get(KEY_A));
  });

  it('a floor below the mark, or not a number, changes nothing', () => {
    const v = count([1, 2]);
    for (const floor of [0, 2, -1, 1.5, NaN, Infinity, 2 ** 53]) expect(applyFloor(v, KEY_A, floor)).toBe(v);
    expect(applyFloor(none, KEY_A, 0)).toBe(none);
  });

  it('leaves the vector it was given alone', () => {
    const v = count([1, 3]);
    countBatch(v, KEY_A, 2, big);
    applyFloor(v, KEY_A, 9);
    expect(v.get(KEY_A)).toEqual({ mark: 1, ahead: [[3, 3]] });
  });

  it('the same numbers give one entry in any order, whichever way they came, and parse back', () => {
    // Why: a summary is worked out from this, and two phones holding the same work must say the same.
    const numbers = fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { maxLength: 40 });
    fc.assert(fc.property(numbers, fc.integer({ min: 0, max: 60 }), fc.nat(), (ns, floor, seed) => {
      const shuffled = [...ns].sort((a, b) => ((a * 31 + seed) % 61) - ((b * 31 + seed) % 61));
      const first = applyFloor(count(ns), KEY_A, floor).get(KEY_A);
      const second = count(shuffled, applyFloor(none, KEY_A, floor)).get(KEY_A);
      expect(second).toEqual(first);
      if (!first) return;
      for (let n = 1; n <= 61; n++) expect(n <= first.mark || first.ahead.some(([a, b]) => a <= n && n <= b)).toBe(n <= floor || ns.includes(n));
      expect(parse({ [KEY_A]: first })?.get(KEY_A)).toEqual(first);
    }));
  });
});

describe('the rows that go with a batch', () => {
  const event = (id: string, type = 'v1.TakeArchived', extra: object = {}) => ({ id, type, orgId: 'o', streamId: 's', actorId: 'a', deviceId: 'd', hlc: 'h', payload: {}, ...extra }) as unknown as AnyEvent;
  const via = { batch: 3, key: KEY_A };
  const batch = { key: KEY_A, n: 3 };
  const none = () => false;

  it('keeps pending and nearby rows of this batch, in the order given', () => {
    const rows: NearbyRow[] = [{ event: event('a'), status: 'pending', via }, { event: event('b'), status: 'nearby', via }];
    expect(batchRowsToSend(rows, batch, none).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('strips each for the wire', () => {
    const [sent] = batchRowsToSend([{ event: event('a', 'v1.TakeArchived', { serverSeq: 9, junk: 1, parentEventId: 'p' }), status: 'nearby', via }], batch, none);
    expect(sent).toEqual({ ...event('a'), parentEventId: 'p' });
    expect(sent).not.toHaveProperty('serverSeq');
    expect(sent).not.toHaveProperty('junk');
  });

  it('leaves out what is not this batch\'s to carry', () => {
    const out = (row: object) => batchRowsToSend([{ event: event('a'), status: 'nearby', via, ...row }], batch, none);
    expect(out({ status: 'confirmed' })).toEqual([]);
    expect(out({ status: 'rejected' })).toEqual([]);
    expect(out({ via: undefined })).toEqual([]);
    expect(out({ via: { batch: 2, key: KEY_A } })).toEqual([]);
    expect(out({ via: { batch: 3, key: 'other' } })).toEqual([]);
    expect(out({ via: { claim: { key: KEY_A, seq: 3 } } })).toEqual([]);
    expect(out({ event: event('a', 'v1.Redacted') })).toEqual([]);
    expect(out({ event: event('a', 'v1.ExternalValueSet') })).toEqual([]);
    expect(batchRowsToSend([{ event: event('a'), status: 'nearby', via }], batch, (id) => id === 'a')).toEqual([]);
  });
});

describe('shouldClaim', () => {
  const event = (extra: object = {}) => ({ id: 'e1', type: 'v1.TakeArchived', serverSeq: 10, orgId: 'o', streamId: 's', actorId: 'a', deviceId: 'd', hlc: 'h', payload: {}, ...extra }) as unknown as AnyEvent;
  const them = { cursor: 5, claimedSeq: 3 };
  const here = { attestedSeq: 20, isRedacted: () => false };
  const yes = (e: AnyEvent, status: LocalEventStatus = 'confirmed') => shouldClaim({ event: e, status }, them, here);

  it('is true for a confirmed row past what they know, up to what was vouched for', () => {
    expect(yes(event())).toBe(true);
    expect(yes(event({ serverSeq: 6 }))).toBe(true);
    expect(yes(event({ serverSeq: 20 }))).toBe(true);
  });

  it('counts their claims as well as their cursor', () => {
    expect(shouldClaim({ event: event({ serverSeq: 6 }), status: 'confirmed' }, { cursor: 5, claimedSeq: 8 }, here)).toBe(false);
    expect(shouldClaim({ event: event({ serverSeq: 9 }), status: 'confirmed' }, { cursor: 5, claimedSeq: 8 }, here)).toBe(true);
  });

  it('is false at or below what they know, and past what was vouched for', () => {
    expect(yes(event({ serverSeq: 5 }))).toBe(false);
    expect(yes(event({ serverSeq: 21 }))).toBe(false);
    expect(yes(event({ serverSeq: undefined }))).toBe(false);
  });

  it('is false for anything but a confirmed row', () => {
    for (const status of ['pending', 'nearby', 'rejected'] as const) expect(yes(event(), status)).toBe(false);
  });

  it('is false for what no phone may claim', () => {
    expect(yes(event({ id: 'v2:1' }))).toBe(false);
    expect(yes(event({ id: 'api-1' }))).toBe(false);
    expect(yes(event({ type: 'v1.Redacted' }))).toBe(false);
    expect(yes(event({ type: 'v1.ExternalValueSet' }))).toBe(false);
    expect(yes(event({ type: 'v1.MemberAdded' }))).toBe(false);
    expect(yes(event({ type: 'v1.BlobStored' }))).toBe(false);
    expect(shouldClaim({ event: event(), status: 'confirmed' }, them, { attestedSeq: 20, isRedacted: (id) => id === 'e1' })).toBe(false);
  });

  it('is true for a type this build does not know, which it passes on as a pull keeps it', () => {
    expect(yes(event({ type: 'v9.FromTheFuture' }))).toBe(true);
  });
});
