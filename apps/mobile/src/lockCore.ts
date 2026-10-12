// i18n-ignore-file: cryptography and storage records; no words shown to people.
import { gcm } from '@noble/ciphers/aes';
import { bytesToUtf8 } from '@noble/ciphers/utils';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

/**
 * Signing out of a phone locks the person's sign-in on it (decision 88), so
 * they can sign back in with no connection, and nobody else can.
 *
 * While someone is signed in, the phone keeps a random data key for them. On
 * sign-out their session is sealed with that key (AES-256-GCM) and the key
 * is kept only wrapped: once under their password (when they signed in with
 * one) and once under a pattern drawn on nine dots (when they chose one),
 * each through PBKDF2-SHA256. Typing either opens the key, the key opens the session, and
 * the session goes back where supabase-js keeps it. Nothing here is sent
 * anywhere, and neither the password nor the pattern is stored.
 *
 * What it guards against: the next person on a shared phone, and someone who
 * takes the phone and tries patterns in the app (wrong ones make each try
 * wait longer). Someone who copies the phone's storage can try every pattern
 * (about 390,000 of five dots or more) as fast as their computer allows; a
 * pattern then holds for hours, not years, and a long password much longer. Marking the phone lost ends the
 * session on the server (decision 59).
 *
 * Pure, with randomness passed in, so the tests run it as the phone does.
 */

export type Random = (n: number) => Uint8Array;

/** A key wrapped under a secret. `iterations` is stored, so it can rise later without breaking old locks. */
export interface Wrap {
  kind: 'password' | 'pattern';
  salt: string;
  iterations: number;
  nonce: string;
  sealed: string;
}

/** One person's lock on this phone. `address` is a salted hash of their email or sign-in name, never the name itself. */
export interface Lock {
  actorId: string;
  address?: string;
  wraps: Wrap[];
}

/** A session sealed with the person's data key. */
export interface Sealed { nonce: string; sealed: string }

export const ITERATIONS = 50_000;

// ---- patterns on a 3×3 grid, dots numbered 0..8 row by row (decision 88) ----

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

export function newDataKey(random: Random): string {
  return bytesToHex(random(32));
}

async function derive(secret: string, salt: string, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(secret.normalize('NFC')), hexToBytes(salt), { c: iterations, dkLen: 32 });
}

/** Wrap the data key under a password or pattern, replacing any earlier wrap of the same kind. */
export async function withWrap(lock: Lock, kind: Wrap['kind'], secret: string, dataKey: string, random: Random, iterations = ITERATIONS): Promise<Lock> {
  const salt = bytesToHex(random(16));
  const nonce = random(12);
  const key = await derive(secret, salt, iterations);
  const sealed = gcm(key, nonce).encrypt(hexToBytes(dataKey));
  const wrap: Wrap = { kind, salt, iterations, nonce: bytesToHex(nonce), sealed: bytesToHex(sealed) };
  return { ...lock, wraps: [...lock.wraps.filter((w) => w.kind !== kind), wrap] };
}

/** The data key, if the secret opens one of this lock's wraps of that kind; null otherwise. */
export async function openWrap(lock: Lock, kind: Wrap['kind'], secret: string): Promise<string | null> {
  for (const w of lock.wraps.filter((x) => x.kind === kind)) {
    try {
      const key = await derive(secret, w.salt, w.iterations);
      return bytesToHex(gcm(key, hexToBytes(w.nonce)).decrypt(hexToBytes(w.sealed)));
    } catch {
      // A wrong secret fails the GCM tag check.
    }
  }
  return null;
}

export function seal(dataKey: string, text: string, random: Random): Sealed {
  const nonce = random(12);
  return { nonce: bytesToHex(nonce), sealed: bytesToHex(gcm(hexToBytes(dataKey), nonce).encrypt(utf8ToBytes(text))) };
}

/** The sealed text, or null if the key does not open it. */
export function unseal(dataKey: string, s: Sealed): string | null {
  try {
    return bytesToUtf8(gcm(hexToBytes(dataKey), hexToBytes(s.nonce)).decrypt(hexToBytes(s.sealed)));
  } catch {
    return null;
  }
}

/** How an email or sign-in name is matched without keeping it: a hash salted per phone. */
export function addressHash(phoneSalt: string, address: string): string {
  return bytesToHex(sha256(utf8ToBytes(`langquest-lock-address:v1:${phoneSalt}:${address.trim().toLowerCase()}`)));
}

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

// ---- wrong guesses (one count for the phone: with no names shown, a guess is not aimed at anyone) ----

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
