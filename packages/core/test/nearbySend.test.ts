import fc from 'fast-check';
import { NEARBY_VECTOR_MAX_KEYS, NEARBY_VECTOR_MAX_RANGES, parseVector } from '../src/nearbySend';
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
