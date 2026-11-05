// i18n-ignore-file: pattern geometry, pictures and storage records; no words shown to people.
/**
 * Signing out of a phone locks the person's sign-in on it (decisions.md
 * 168), so they can sign back in with no connection, and nobody else can:
 * what a lock holds, the pattern drawn on nine dots, the picture a person
 * finds themselves by on Sign In, and how wrong guesses are counted. The
 * cryptography is sealModel.ts. Pure, so the tests run it as the phone does.
 */

/** A key wrapped under a secret. `iterations` is stored, so it can rise later without breaking old locks. */
export interface Wrap {
  kind: 'password' | 'pattern';
  salt: string;
  iterations: number;
  nonce: string;
  sealed: string;
}

/**
 * One person's lock on this phone. `address` is a salted hash of their email
 * or sign-in name, never the name itself; `picture` is what they tap on Sign
 * In before drawing their pattern (PICTURES), never their name.
 */
export interface Lock {
  actorId: string;
  address?: string;
  picture?: number;
  wraps: Wrap[];
}

/** A session sealed with the person's data key. */
export interface Sealed { nonce: string; sealed: string }

// ---- pictures (decisions.md 168) ----

/**
 * What a person taps on Sign In to find themselves on a shared phone before
 * drawing their pattern: things people know in any language and culture,
 * drawn by the phone's own emoji font, all old enough to show on phones from
 * 2016 on. Stored by position, so the order never changes; add new ones at
 * the end. Each has a spoken label in the catalogs (shell.pattern.picture).
 */
export const PICTURES = ['🐘', '🐟', '🐦', '🐢', '🐝', '🦋', '🌳', '🌻', '🌙', '⭐', '☀️', '🍌', '🍉', '⚽', '🏠', '🚲'] as const;

export function isPicture(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < PICTURES.length;
}

// ---- patterns on a 3×3 grid, dots numbered 0..8 row by row ----

/** Fewer dots are refused: five or more leave about 390,000 patterns. */
export const MIN_DOTS = 5;

/** A pattern to lock with: at least five dots of the grid, none twice. */
export function isPattern(dots: readonly number[]): boolean {
  return dots.length >= MIN_DOTS && new Set(dots).size === dots.length && dots.every((d) => Number.isInteger(d) && d >= 0 && d <= 8);
}

/**
 * The dot a line passes over on its way from `a` to `b`, if any: as on the
 * Android lock screen, a line from one corner to the next takes the dot
 * between them, so nobody draws a pattern they cannot see.
 */
export function between(a: number, b: number): number | null {
  const [ar, ac, br, bc] = [Math.floor(a / 3), a % 3, Math.floor(b / 3), b % 3];
  if ((ar + br) % 2 !== 0 || (ac + bc) % 2 !== 0) return null;
  const mid = ((ar + br) / 2) * 3 + (ac + bc) / 2;
  return mid === a || mid === b ? null : mid;
}

/** The pattern after the finger reaches `dot`. */
export function addDot(dots: readonly number[], dot: number): number[] {
  if (dots.includes(dot)) return [...dots];
  const last = dots[dots.length - 1];
  const mid = last === undefined ? null : between(last, dot);
  return mid !== null && !dots.includes(mid) ? [...dots, mid, dot] : [...dots, dot];
}

/**
 * The pattern once a finger starts to drag. A drag always starts a new one
 * from the dot it began on, as on the Android lock screen: dots tapped before
 * it (a thumb that landed and lifted) are let go, so a stray tap never makes
 * a correct drawing fail (UI audit, finding 31). Tapping alone never drags,
 * so tap, tap, Done still works.
 */
export function dotsAtDrag(dots: readonly number[], tapped: boolean, from: number | null): number[] {
  if (!tapped) return [...dots];
  return from === null ? [] : [from];
}

/** The dot under a point of a square pad `size` wide, or null between dots. */
export function dotAt(x: number, y: number, size: number): number | null {
  const cell = size / 3;
  const col = Math.floor(x / cell);
  const row = Math.floor(y / cell);
  if (col < 0 || col > 2 || row < 0 || row > 2) return null;
  const dx = x - (col + 0.5) * cell;
  const dy = y - (row + 0.5) * cell;
  return dx * dx + dy * dy <= (cell * 0.38) ** 2 ? row * 3 + col : null;
}

/** What a pattern is turned into before it is stretched into a key. */
export function patternSecret(dots: readonly number[]): string {
  return `pattern:v1:${dots.join('-')}`;
}

/** A torn write or garbage reads as no locks, never a crash on Sign In. */
export function parseLocks(raw: string | null | undefined): Lock[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((l): l is Lock => typeof l === 'object' && l !== null && typeof (l as Lock).actorId === 'string' && Array.isArray((l as Lock).wraps));
  } catch {
    return [];
  }
}

/**
 * The lock a secret is tried against: for a pattern, the person whose
 * picture was tapped; for a password, the one whose address hash matches
 * what was typed.
 */
export function lockFor(locks: readonly Lock[], kind: Wrap['kind'], who: { actorId?: string; addressHash?: string | null }): Lock | null {
  return locks.find((l) => l.wraps.some((w) => w.kind === kind)
    && (kind === 'pattern' ? l.actorId === who.actorId : !!l.address && l.address === who.addressHash)) ?? null;
}

/** Pictures other people on this phone have: nobody may choose one of those. */
export function takenPictures(locks: readonly Lock[], actorId: string): number[] {
  return locks.filter((l) => l.actorId !== actorId && isPicture(l.picture)).map((l) => l.picture!);
}

// ---- wrong guesses, counted for each person's lock ----

export interface Misses { count: number; waitUntil?: string }

const FREE_MISSES = 4;
const FIRST_WAIT_MS = 60_000;
const LONGEST_WAIT_MS = 60 * 60_000;

/** Milliseconds before another try; 0 when one may be made now. */
export function waitLeft(m: Misses, now: number): number {
  return m.waitUntil ? Math.max(0, Date.parse(m.waitUntil) - now) : 0;
}

/** A wrong pattern or password: four are free, then each try waits twice as long as the last, up to an hour. */
export function afterMiss(m: Misses, now: number): Misses {
  const count = m.count + 1;
  if (count <= FREE_MISSES) return { count };
  return { count, waitUntil: new Date(now + Math.min(LONGEST_WAIT_MS, FIRST_WAIT_MS * 2 ** (count - FREE_MISSES - 1))).toISOString() };
}

export function parseMisses(raw: string | null | undefined): Misses {
  try {
    const m = raw ? (JSON.parse(raw) as Misses) : null;
    return m && typeof m.count === 'number' ? m : { count: 0 };
  } catch {
    return { count: 0 };
  }
}
