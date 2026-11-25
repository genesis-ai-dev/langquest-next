/**
 * The library documents this build cannot read (2026-11-24, review item 28), as the phone keeps
 * them: each came from a teammate whole, hashing to its name and in canonical form, in a format a
 * newer build added. They are remembered under the build that found them, so no session asks a
 * teammate for them again, and forgotten once the app updates, when it may read them. Pure: what
 * is stored comes in as text and goes out as text.
 */

/** Where the list is kept (`AsyncStorage`): one row for the phone, since a document is the same document in every organization. */
export const UNREADABLE_DOCS_KEY = 'library-unreadable';

/** Far more than a library adds formats for: a hostile list cannot grow the row past this. */
export const UNREADABLE_DOCS_MAX = 1_000;

const HASH = /^[0-9a-f]{64}$/;

/** The hashes kept for this build, or none: another build's list, or a row that cannot be read, reads as nothing. */
export function unreadableOf(raw: string | null, build: string): Set<string> {
  if (!raw) return new Set();
  try {
    const v = JSON.parse(raw) as { build?: unknown; hashes?: unknown };
    if (v.build !== build || !Array.isArray(v.hashes)) return new Set();
    return new Set(v.hashes.filter((h): h is string => typeof h === 'string' && HASH.test(h)).slice(-UNREADABLE_DOCS_MAX));
  } catch {
    return new Set();
  }
}

/** The row with one more hash, for this build; the oldest go past `UNREADABLE_DOCS_MAX`. Null when nothing changes. */
export function withUnreadable(raw: string | null, build: string, hash: string): string | null {
  if (!HASH.test(hash)) return null;
  const held = unreadableOf(raw, build);
  if (held.has(hash)) return null;
  return JSON.stringify({ build, hashes: [...held, hash].slice(-UNREADABLE_DOCS_MAX) });
}
