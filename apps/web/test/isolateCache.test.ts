import { describe, expect, it } from 'vitest';
import { AUTH_TTL_MS, cachedBlobAccess, cachedIdentityOf, cachedProfileOf, DENIAL_TTL_MS, MAX_ENTRIES, TtlCache } from '../worker/isolateCache';

describe('TtlCache', () => {
  it('forgets an entry once its time has come', () => {
    let t = 1000;
    const c = new TtlCache<string>(10, () => t);
    c.set('a', 'x', 2000);
    expect(c.get('a')).toBe('x');
    t = 2000;
    expect(c.get('a')).toBeUndefined();
  });

  it('stores nothing for a time already past', () => {
    const c = new TtlCache<string>(10, () => 5000);
    c.set('a', 'x', 5000);
    expect(c.size).toBe(0);
  });

  it('evicts lapsed entries first, then the oldest, when full', () => {
    let t = 0;
    const c = new TtlCache<number>(3, () => t);
    c.set('a', 1, 100);
    c.set('b', 2, 1000);
    c.set('c', 3, 1000);
    t = 200;
    c.set('d', 4, 1000); // 'a' has lapsed, so nothing live is dropped
    expect([c.get('b'), c.get('c'), c.get('d')]).toEqual([2, 3, 4]);
    c.set('e', 5, 1000); // full of live entries: the oldest ('b') goes
    expect(c.size).toBe(3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('e')).toBe(5);
  });

  it('stays within its bound', () => {
    const c = new TtlCache<number>(MAX_ENTRIES, () => 0);
    for (let i = 0; i < MAX_ENTRIES + 50; i++) c.set(String(i), i, 10);
    expect(c.size).toBe(MAX_ENTRIES);
  });
});

describe('cachedProfileOf', () => {
  it('verifies a token once within a minute, and again after', async () => {
    let t = 0;
    let calls = 0;
    const profileOf = cachedProfileOf(async () => { calls++; return { sub: 'p1' }; }, () => t);
    expect(await profileOf('tok')).toBe('p1');
    t = AUTH_TTL_MS - 1;
    expect(await profileOf('tok')).toBe('p1');
    expect(calls).toBe(1);
    t = AUTH_TTL_MS;
    await profileOf('tok');
    expect(calls).toBe(2);
  });

  it('never keeps a token past its own expiry', async () => {
    let t = 0;
    let calls = 0;
    const profileOf = cachedProfileOf(async () => { calls++; return { sub: 'p1', exp: 5 }; }, () => t);
    await profileOf('tok');
    t = 4999;
    await profileOf('tok');
    expect(calls).toBe(1);
    t = 5000;
    await profileOf('tok');
    expect(calls).toBe(2);
  });

  it('does not cache a failure, and tells tokens apart', async () => {
    let calls = 0;
    const profileOf = cachedProfileOf(async (tok) => { calls++; return tok === 'good' ? { sub: 'p1' } : null; });
    expect(await profileOf('bad')).toBeNull();
    expect(await profileOf('bad')).toBeNull();
    expect(calls).toBe(2);
    expect(await profileOf('good')).toBe('p1');
    expect(await profileOf('other-bad')).toBeNull();
  });

  it('asks whether the session is live on every call, cached token or not (decisions.md 118)', async () => {
    let calls = 0;
    let live = true;
    const profileOf = cachedProfileOf(async () => { calls++; return { sub: 'p1', sessionId: 's1' }; }, () => 0, async () => live);
    expect(await profileOf('tok')).toBe('p1');
    live = false;
    expect(await profileOf('tok')).toBeNull();
    expect(calls).toBe(1);
  });
});

describe('cachedIdentityOf', () => {
  it('gives the session level with the person, from the cache too (decisions.md 158)', async () => {
    let calls = 0;
    const identityOf = cachedIdentityOf(async () => { calls++; return { sub: 'p1', aal: 'aal2' }; }, () => 0);
    expect(await identityOf('tok')).toEqual({ profileId: 'p1', aal: 'aal2' });
    expect(await identityOf('tok')).toEqual({ profileId: 'p1', aal: 'aal2' });
    expect(calls).toBe(1);
  });
});

describe('cachedBlobAccess', () => {
  it('asks again for another session level, so an aal1 refusal never answers for aal2', async () => {
    const asked: (string | undefined)[] = [];
    const may = cachedBlobAccess(async (_k, _p, _w, aal) => { asked.push(aal); return aal === 'aal2'; }, () => 0);
    expect(await may('o/l1/a.m4a', 'gv', false, 'aal1')).toBe(false);
    expect(await may('o/l1/a.m4a', 'gv', false, 'aal2')).toBe(true);
    expect(await may('o/l1/b.m4a', 'gv', false, 'aal2')).toBe(true);
    expect(asked).toEqual(['aal1', 'aal2']);
  });

  it('asks once per person, stream and mode', async () => {
    const asked: string[] = [];
    const may = cachedBlobAccess(async (key, p, w) => { asked.push(`${key}|${p}|${w}`); return true; }, () => 0);
    expect(await may('o/l1/a.m4a', 'p', false)).toBe(true);
    expect(await may('o/l1/b.m4a', 'p', false)).toBe(true);
    expect(asked).toHaveLength(1);
    await may('o/l1/a.m4a', 'p', true);
    await may('o/l2/a.m4a', 'p', false);
    await may('o/l1/a.m4a', 'q', false);
    expect(asked).toHaveLength(4);
  });

  it('asks per file for library media in the organization stream', async () => {
    let calls = 0;
    const may = cachedBlobAccess(async () => { calls++; return true; });
    await may('o/_org/h1.m4a', 'p', false);
    await may('o/_org/h2.m4a', 'p', false);
    expect(calls).toBe(2);
  });

  it('keeps a yes for 60 s and a no for 10 s, and never an error', async () => {
    let t = 0;
    let answer: boolean | Error = true;
    let calls = 0;
    const may = cachedBlobAccess(async () => { calls++; if (answer instanceof Error) throw answer; return answer; }, () => t);
    await may('o/l/a.m4a', 'p', false);
    t = AUTH_TTL_MS - 1;
    await may('o/l/a.m4a', 'p', false);
    expect(calls).toBe(1);
    t = AUTH_TTL_MS;
    answer = false;
    expect(await may('o/l/a.m4a', 'p', false)).toBe(false);
    t += DENIAL_TTL_MS - 1;
    expect(await may('o/l/a.m4a', 'p', false)).toBe(false);
    expect(calls).toBe(2);
    t += 1;
    answer = new Error('db down');
    await expect(may('o/l/a.m4a', 'p', false)).rejects.toThrow('db down');
    answer = true;
    expect(await may('o/l/a.m4a', 'p', false)).toBe(true);
  });
});
