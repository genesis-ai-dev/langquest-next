import { PART_SIZE, encodeKey, secureKeyValue, splitParts } from '../src/server/secureStorageModel';

function fakes(secure = new Map<string, string>(), legacy = new Map<string, string>(), reads = { n: 0 }) {
  const store = secureKeyValue(
    {
      get: async (k) => { reads.n++; return secure.get(k) ?? null; },
      set: async (k, v) => { secure.set(k, v); },
      delete: async (k) => { secure.delete(k); }
    },
    { getItem: async (k) => legacy.get(k) ?? null, removeItem: async (k) => { legacy.delete(k); } }
  );
  return { secure, legacy, store, reads };
}

describe('encodeKey', () => {
  it('leaves only characters SecureStore accepts', () => {
    for (const key of ['sb-abc-auth-token', 'hand-over-session:7f1c2d3e-0000-4000-8000-000000000000', 'a b/é😀']) {
      expect(encodeKey(key)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it('never gives two keys the same name', () => {
    const keys = ['a:b', 'a_3a_b', 'a.b', 'a-b', 'a_b', 'a b'];
    expect(new Set(keys.map(encodeKey)).size).toBe(keys.length);
  });
});

describe('splitParts', () => {
  it('joins back to the value and keeps each part within the size', () => {
    const value = 'x'.repeat(PART_SIZE * 2 + 5);
    const parts = splitParts(value);
    expect(parts.join('')).toBe(value);
    expect(parts.every((p) => p.length <= PART_SIZE)).toBe(true);
  });

  it('does not cut an emoji in two', () => {
    const value = 'a'.repeat(PART_SIZE - 1) + '😀' + 'b'.repeat(10);
    const parts = splitParts(value);
    expect(parts.join('')).toBe(value);
    expect(parts.every((p) => p === p.toWellFormed())).toBe(true);
  });
});

describe('secureKeyValue', () => {
  it('keeps a value over 2 KB in parts and reads it back whole', async () => {
    const { secure, store } = fakes();
    const value = JSON.stringify({ refresh_token: 'r'.repeat(5000), user: { name: 'Akol é' } });
    await store.setItem('sb-x-auth-token', value);
    expect(await store.getItem('sb-x-auth-token')).toBe(value);
    expect(secure.size).toBeGreaterThan(2);
    for (const v of secure.values()) expect(v.length).toBeLessThanOrEqual(PART_SIZE);
  });

  it('an empty value is kept as an empty value, not as nothing', async () => {
    const { store } = fakes();
    await store.setItem('k', '');
    expect(await store.getItem('k')).toBe('');
  });

  it('overwriting with a shorter value leaves no stale parts', async () => {
    const { secure, store } = fakes();
    await store.setItem('k', 'x'.repeat(PART_SIZE * 4));
    await store.setItem('k', 'short');
    expect(await store.getItem('k')).toBe('short');
    expect([...secure.keys()].sort()).toEqual([`${encodeKey('k')}.0`, `${encodeKey('k')}.n`]);
  });

  it('removing clears the count and every part', async () => {
    const { secure, store } = fakes();
    await store.setItem('k', 'x'.repeat(PART_SIZE * 3));
    await store.setItem('other', 'keep');
    await store.removeItem('k');
    expect(await store.getItem('k')).toBeNull();
    expect([...secure.keys()].filter((k) => k.startsWith(encodeKey('k') + '.'))).toEqual([]);
    expect(await store.getItem('other')).toBe('keep');
  });

  it('a value with a missing part reads as nothing, not as a cut-off session', async () => {
    const { secure, store } = fakes();
    await store.setItem('k', 'x'.repeat(PART_SIZE * 2));
    secure.delete(`${encodeKey('k')}.1`);
    // The next launch reads the Keychain afresh.
    expect(await fakes(secure).store.getItem('k')).toBeNull();
  });

  it('reads the Keychain once per key, not at every request', async () => {
    const secure = new Map<string, string>();
    await fakes(secure).store.setItem('k', 'x'.repeat(PART_SIZE * 3));
    const { store, reads } = fakes(secure);
    expect(await store.getItem('k')).toBe('x'.repeat(PART_SIZE * 3));
    const first = reads.n;
    for (let i = 0; i < 5; i++) await store.getItem('k');
    expect(reads.n).toBe(first);
    await store.setItem('k', 'new');
    expect(await store.getItem('k')).toBe('new');
    await store.removeItem('k');
    expect(await store.getItem('k')).toBeNull();
  });

  it('an entry the Keystore cannot read counts as signed out, not as an error at every request', async () => {
    const store = secureKeyValue(
      { get: async () => { throw new Error('Could not decrypt'); }, set: async () => {}, delete: async () => {} },
      { getItem: async () => null, removeItem: async () => {} }
    );
    expect(await store.getItem('sb-x-auth-token')).toBeNull();
  });

  it('moves a value found only in the old storage over on first read, and deletes the old copy', async () => {
    const { secure, legacy, store } = fakes();
    const old = 'y'.repeat(PART_SIZE + 10);
    legacy.set('hand-over-session:akol', old);
    expect(await store.getItem('hand-over-session:akol')).toBe(old);
    expect(legacy.size).toBe(0);
    expect(secure.size).toBeGreaterThan(0);
    expect(await store.getItem('hand-over-session:akol')).toBe(old);
  });

  it('answers null when neither place has the key', async () => {
    const { store } = fakes();
    expect(await store.getItem('nothing')).toBeNull();
  });

  it('setItem and removeItem also clear an old plaintext copy', async () => {
    const { legacy, store } = fakes();
    legacy.set('a', 'old');
    await store.setItem('a', 'new');
    expect(legacy.has('a')).toBe(false);
    legacy.set('b', 'old');
    await store.removeItem('b');
    expect(legacy.has('b')).toBe(false);
    expect(await store.getItem('b')).toBeNull();
  });
});
