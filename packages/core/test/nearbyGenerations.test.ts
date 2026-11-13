import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { discoveryKeyAt, handedKeyHolds, olderDiscoveryKey } from '../src/nearbyGenerations';
import { base64urlDecode, base64urlEncode } from '../src/nearbySigning';
import { GENERATIONS } from './nearbyVectors';

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());
const at = (gen: number, i: number) => ({ gen, key: GENERATIONS[i]! });

describe('generations of a discovery key', () => {
  it('hashes down to the golden vector', async () => {
    let key = base64urlDecode(GENERATIONS[0]!)!;
    for (const expected of GENERATIONS.slice(1)) {
      key = await olderDiscoveryKey(key, sha256);
      expect(base64urlEncode(key)).toBe(expected);
    }
  });

  it('works out any generation at or below what it holds', async () => {
    const held = at(10, 0);
    for (let i = 0; i < GENERATIONS.length; i++) {
      expect(base64urlEncode((await discoveryKeyAt(held, 10 - i, sha256))!)).toBe(GENERATIONS[i]);
    }
  });

  it('works out nothing above what it holds, or below generation 1, or from a bad key', async () => {
    const held = at(10, 0);
    for (const gen of [11, 0, -1, 1.5, NaN, Infinity]) expect(await discoveryKeyAt(held, gen, sha256)).toBeNull();
    expect(await discoveryKeyAt({ gen: 10, key: 'short' }, 9, sha256)).toBeNull();
    expect(await discoveryKeyAt({ gen: 10, key: 'not base64url!' }, 9, sha256)).toBeNull();
  });

  it('sha256 may answer with a promise', async () => {
    expect(base64urlEncode(await olderDiscoveryKey(base64urlDecode(GENERATIONS[0]!)!, (b) => Promise.resolve(sha256(b))))).toBe(GENERATIONS[1]);
  });
});

describe('handedKeyHolds', () => {
  const holds = (mine: { gen: number; key: string }, handed: { gen: number; key: string }, max = 1000) => handedKeyHolds(mine, handed, sha256, max);

  it('takes a key that hashes down to mine', async () => {
    expect(await holds(at(9, 1), at(10, 0))).toBe(true);
    expect(await holds(at(7, 3), at(10, 0))).toBe(true);
    expect(await holds(at(8, 2), at(9, 1))).toBe(true);
  });

  it('refuses a key at or below mine, more than the limit above, or claiming the wrong distance', async () => {
    expect(await holds(at(10, 0), at(10, 0))).toBe(false);
    expect(await holds(at(10, 0), at(9, 1))).toBe(false);
    expect(await holds(at(7, 3), at(10, 0), 2)).toBe(false);
    expect(await holds(at(7, 3), at(10, 0), 3)).toBe(true);
    expect(await holds(at(9, 1), at(11, 0))).toBe(false);
  });

  it('refuses a key that is not 32 bytes of canonical base64url', async () => {
    const mine = at(9, 1);
    for (const key of ['', 'short', `${GENERATIONS[0]}A`, `${GENERATIONS[0]!.slice(0, -1)}x`, '__proto__']) expect(await holds(mine, { gen: 10, key }), key).toBe(false);
    expect(await holds({ gen: 9, key: 'short' }, at(10, 0))).toBe(false);
  });

  it('asks no work of this phone for a number that makes no sense', async () => {
    let calls = 0;
    const counted = (b: Uint8Array) => { calls++; return sha256(b); };
    for (const gen of [NaN, Infinity, 2 ** 53, 1e308, 1.5, -1]) expect(await handedKeyHolds(at(9, 1), { gen, key: GENERATIONS[0]! }, counted, 1000)).toBe(false);
    expect(calls).toBe(0);
  });

  it('holds for any distance within reach, and a random key does not', async () => {
    await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.integer({ min: 1, max: 20 }), fc.uint8Array({ minLength: 32, maxLength: 32 }), async (top, steps, other) => {
      const handed = { gen: 100, key: base64urlEncode(top) };
      const mine = { gen: 100 - steps, key: base64urlEncode((await discoveryKeyAt(handed, 100 - steps, sha256))!) };
      expect(await handedKeyHolds(mine, handed, sha256, 1000)).toBe(true);
      expect(await handedKeyHolds(mine, { gen: 100, key: base64urlEncode(other) }, sha256, 1000)).toBe(false);
    }), { numRuns: 30 });
  });
});
