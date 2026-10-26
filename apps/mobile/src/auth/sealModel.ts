// i18n-ignore-file: cryptography; no words shown to people.
import { gcm } from '@noble/ciphers/aes';
import { bytesToUtf8 } from '@noble/ciphers/utils';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import type { Lock, Sealed, Wrap } from './lockModel';

/**
 * The cryptography of the lock on a phone (decisions.md 167). While someone
 * is signed in, the phone keeps a random data key for them. On sign-out
 * their session is sealed with that key (AES-256-GCM) and the key is kept
 * only wrapped: once under their password (when they signed in with one)
 * and once under a pattern drawn on nine dots (when they chose one), each
 * through PBKDF2-SHA256. Either one opens the key, the key opens the
 * session, and the session goes back where supabase-js keeps it. Nothing
 * here is sent anywhere, and neither the password nor the pattern is stored.
 *
 * What it guards against: the next person on a shared phone, and someone who
 * takes the phone and tries patterns in the app (wrong ones make each try
 * wait longer). Someone who gets past the Keychain or Keystore and copies
 * the lock can try every pattern (about 390,000 of five dots or more) as
 * fast as their computer allows; a pattern then holds for hours, a long
 * password much longer. A helper marking the phone lost ends the session on
 * the server (decisions.md 59).
 *
 * Pure, with randomness passed in, so the tests run it as the phone does.
 * Phones only: the web never locks (server/lock.web.ts), so none of this is
 * in its bundle.
 */

export type Random = (n: number) => Uint8Array;

export const ITERATIONS = 50_000;

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

/** The sealed text, or null if the key does not open it or the record is torn. */
export function unseal(dataKey: string, raw: string | null | undefined): string | null {
  try {
    const s = JSON.parse(raw ?? 'null') as Sealed | null;
    if (!s || typeof s.nonce !== 'string' || typeof s.sealed !== 'string') return null;
    return bytesToUtf8(gcm(hexToBytes(dataKey), hexToBytes(s.nonce)).decrypt(hexToBytes(s.sealed)));
  } catch {
    return null;
  }
}

/** How an email or sign-in name is matched without keeping it: a hash salted per phone. */
export function addressHash(phoneSalt: string, address: string): string {
  return bytesToHex(sha256(utf8ToBytes(`langquest-lock-address:v1:${phoneSalt}:${address.trim().toLowerCase()}`)));
}
