/**
 * Where session secrets are kept on a phone: the Keychain (iOS) or Keystore
 * (Android) through expo-secure-store, instead of plain AsyncStorage
 * (decisions.md 60, amended 2026-10-15). This file is the logic, with the
 * platform handed in, so it is tested without a phone; secureStorage.ts binds it
 * to expo-secure-store and AsyncStorage.
 *
 * Two things SecureStore needs that AsyncStorage did not:
 *  - a key may hold only [A-Za-z0-9._-], so a key is encoded;
 *  - a value should stay under about 2 KB, and a session is more than that
 *    with its user record, so a value is cut into parts: `<key>.n` holds how
 *    many, `<key>.0` to `<key>.n-1` hold the pieces.
 *
 * Moving over: a key missing here but present in the old AsyncStorage is
 * copied in and deleted there, so people already signed in, and hand-overs
 * already waiting, survive the upgrade.
 */

/** Characters of a value in one SecureStore entry; a part may be up to 4 UTF-8 bytes per character, so this stays well under 2 KB for text that is mostly ASCII. */
export const PART_SIZE = 1000;

/** Prefix for every entry this module writes, so it cannot meet another module's keys. */
const PREFIX = 'lq.';

/**
 * A key SecureStore accepts. Anything outside [A-Za-z0-9-] becomes `_<hex>_`
 * (an underscore and a dot too), so two different keys never meet.
 */
export function encodeKey(key: string): string {
  let out = '';
  for (const ch of key) {
    out += /[A-Za-z0-9-]/.test(ch) ? ch : `_${ch.codePointAt(0)!.toString(16)}_`;
  }
  return PREFIX + out;
}

/** The pieces of a value, never cutting a surrogate pair in two. */
export function splitParts(value: string, size = PART_SIZE): string[] {
  if (value === '') return [''];
  const parts: string[] = [];
  let at = 0;
  while (at < value.length) {
    let end = Math.min(at + size, value.length);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(value.slice(at, end));
    at = end;
  }
  return parts;
}

/** What the secure store offers (expo-secure-store's async calls). */
export interface SecureBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The storage supabase-js takes (`auth.storage`), and what the old AsyncStorage offers. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * supabase-js reads its session from storage on every request, and one read
 * here is several Keychain reads, so values are remembered in memory once
 * read or written. This module is the only writer of its keys, so the copy
 * cannot go stale.
 *
 * A Keystore entry that cannot be read (Android drops the key behind it, for
 * one, after some restores) reads as absent: the person signs in again, and
 * a hand-over waits for their next sign-in (decisions.md 60), rather than the
 * app failing at every request.
 */
export function secureKeyValue(secure: SecureBackend, legacy: Pick<KeyValueStore, 'getItem' | 'removeItem'>): KeyValueStore {
  const countKey = (key: string) => `${encodeKey(key)}.n`;
  const partKey = (key: string, i: number) => `${encodeKey(key)}.${i}`;
  const known = new Map<string, string | null>();
  const read = (key: string) => secure.get(key).catch(() => null);

  async function count(key: string): Promise<number | null> {
    const raw = await read(countKey(key));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  async function dropParts(key: string, from: number, to: number): Promise<void> {
    for (let i = from; i < to; i++) await secure.delete(partKey(key, i));
  }

  async function write(key: string, value: string): Promise<void> {
    const before = (await count(key)) ?? 0;
    const parts = splitParts(value);
    // Parts first, the count last: a reader sees the old value or the new one.
    for (let i = 0; i < parts.length; i++) await secure.set(partKey(key, i), parts[i]!);
    await secure.set(countKey(key), String(parts.length));
    await dropParts(key, parts.length, before);
  }

  async function load(key: string): Promise<string | null> {
    const n = await count(key);
    if (n === null) {
      const old = await legacy.getItem(key);
      if (old === null) return null;
      await write(key, old);
      await legacy.removeItem(key);
      return old;
    }
    let value = '';
    for (let i = 0; i < n; i++) {
      const part = await read(partKey(key, i));
      if (part === null) return null;
      value += part;
    }
    return value;
  }

  return {
    async getItem(key) {
      if (known.has(key)) return known.get(key)!;
      const value = await load(key);
      known.set(key, value);
      return value;
    },
    async setItem(key, value) {
      known.delete(key);
      await write(key, value);
      // A copy left in the old place would be read as the session again.
      await legacy.removeItem(key);
      known.set(key, value);
    },
    async removeItem(key) {
      known.delete(key);
      const n = (await count(key)) ?? 0;
      await secure.delete(countKey(key));
      await dropParts(key, 0, n);
      await legacy.removeItem(key);
      known.set(key, null);
    }
  };
}
