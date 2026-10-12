import { randomBytes } from 'node:crypto';
import {
  addDot, addressHash, afterMiss, between, dotAt, isPattern, MIN_DOTS, newDataKey, openWrap, parseLocks, patternSecret, seal, unseal, waitLeft, withWrap,
  type Lock, type Misses
} from '../src/lockCore';

// Decision 88: signing out of a phone locks the sign-in on it, and the
// person's password or a pattern on nine dots opens it again with no connection.

const random = (n: number) => new Uint8Array(randomBytes(n));
const NOW = Date.parse('2026-10-12T12:00:00Z');
const session = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'akol' } });
const fast = 1_000; // iterations for the tests; the phone uses ITERATIONS

describe('a pattern', () => {
  it('joins at least five dots, none twice', () => {
    expect(MIN_DOTS).toBe(5);
    expect(isPattern([0, 1, 2, 5, 8])).toBe(true);
    expect(isPattern([0, 1, 2, 5])).toBe(false);
    expect(isPattern([0, 1, 2, 1, 8])).toBe(false);
    expect(isPattern([0, 1, 2, 5, 9])).toBe(false);
  });

  it('takes the dot a line passes over, as the Android lock screen does', () => {
    expect(between(0, 2)).toBe(1);
    expect(between(0, 8)).toBe(4);
    expect(between(2, 6)).toBe(4);
    expect(between(0, 5)).toBeNull();
    expect(addDot([0], 2)).toEqual([0, 1, 2]);
    expect(addDot([1, 0], 2)).toEqual([1, 0, 2]);
    expect(addDot([0, 1], 1)).toEqual([0, 1]);
  });

  it('finds the dot under a finger, and none between dots', () => {
    expect(dotAt(50, 50, 300)).toBe(0);
    expect(dotAt(150, 150, 300)).toBe(4);
    expect(dotAt(250, 250, 300)).toBe(8);
    expect(dotAt(100, 100, 300)).toBeNull();
    expect(dotAt(-5, 50, 300)).toBeNull();
  });
});

describe('locking a sign-in', () => {
  it('the password or the pattern opens the data key, and nothing else does', async () => {
    const key = newDataKey(random);
    const z = patternSecret([0, 1, 2, 4, 6, 7, 8]);
    let lock: Lock = { actorId: 'akol', wraps: [] };
    lock = await withWrap(lock, 'password', 'correct horse battery', key, random, fast);
    lock = await withWrap(lock, 'pattern', z, key, random, fast);
    expect(await openWrap(lock, 'password', 'correct horse battery')).toBe(key);
    expect(await openWrap(lock, 'pattern', z)).toBe(key);
    expect(await openWrap(lock, 'pattern', patternSecret([0, 1, 2, 4, 6, 7]))).toBeNull();
    expect(await openWrap(lock, 'password', 'wrong')).toBeNull();
    // A password is not a pattern, nor the other way round.
    expect(await openWrap(lock, 'password', z)).toBeNull();
  });

  it('keeps neither the password, the pattern nor the key', async () => {
    const key = newDataKey(random);
    const z = patternSecret([0, 1, 2, 4, 6, 7, 8]);
    const lock = await withWrap(await withWrap({ actorId: 'akol', wraps: [] }, 'password', 'correct horse battery', key, random, fast), 'pattern', z, key, random, fast);
    const stored = JSON.stringify(lock);
    for (const secret of ['correct horse battery', z, '0-1-2-4-6-7-8', key]) expect(stored).not.toContain(secret);
    expect(lock.wraps.every((w) => w.iterations === fast)).toBe(true);
  });

  it('a new pattern replaces the old one', async () => {
    const key = newDataKey(random);
    const [a, b] = [patternSecret([0, 3, 6, 7, 8]), patternSecret([2, 5, 8, 7, 6])];
    let lock = await withWrap({ actorId: 'akol', wraps: [] }, 'pattern', a, key, random, fast);
    lock = await withWrap(lock, 'pattern', b, key, random, fast);
    expect(lock.wraps).toHaveLength(1);
    expect(await openWrap(lock, 'pattern', a)).toBeNull();
    expect(await openWrap(lock, 'pattern', b)).toBe(key);
  });

  it('the session sealed with the key opens only with that key', () => {
    const key = newDataKey(random);
    const sealed = seal(key, session, random);
    expect(JSON.stringify(sealed)).not.toContain('refresh_token');
    expect(unseal(key, sealed)).toBe(session);
    expect(unseal(newDataKey(random), sealed)).toBeNull();
  });

  it('matches an email or sign-in name without keeping it', () => {
    expect(addressHash('salt', 'Akol@Example.org ')).toBe(addressHash('salt', 'akol@example.org'));
    expect(addressHash('salt', 'akol@example.org')).not.toBe(addressHash('other', 'akol@example.org'));
    expect(addressHash('salt', 'akol@example.org')).not.toContain('akol');
  });

  it('a torn record reads as no locks', () => {
    expect(parseLocks(null)).toEqual([]);
    expect(parseLocks('{not json')).toEqual([]);
    expect(parseLocks('[{"actorId":1}]')).toEqual([]);
  });
});

describe('wrong guesses', () => {
  it('four are free; from the fifth each try waits twice as long, up to an hour', () => {
    let m: Misses = { count: 0 };
    for (let i = 0; i < 4; i++) m = afterMiss(m, NOW);
    expect(waitLeft(m, NOW)).toBe(0);
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) { m = afterMiss(m, NOW); waits.push(waitLeft(m, NOW) / 60_000); }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });
});
