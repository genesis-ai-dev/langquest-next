// i18n-ignore-file: cryptography; no words shown to people.
import { ed25519, x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';

/**
 * Nearby sync's cryptography on a phone (docs/nearby-sync-plan.md 5.5, 5.12):
 * sync's `NearbyCrypto`, written here because sync takes a platform's crypto
 * as an argument (decisions.md 104). Ed25519 and X25519 are `@noble/curves`,
 * SHA-256, HMAC and HKDF `@noble/hashes`, all plain JavaScript inside the
 * app: Hermes has no WebCrypto, and `digestStringAsync` would cross the
 * bridge once per event. Pure, with randomness passed in (`expo-crypto` on a
 * phone), so the tests check it against core's golden vectors as the phone
 * runs it. Nothing here keeps, logs or sends a key.
 *
 * Shaped as `NearbyCrypto` without importing it: only `.android` files import
 * the nearby entries, and they type this as that.
 */

export type Random = (size: number) => Uint8Array;

/** Plain bytes on the wire: base64url with no padding (5.12). */
export function base64url(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]! + (left > 1 ? abc[(n >> 6) & 63]! : '') + (left > 2 ? abc[n & 63]! : '');
  }
  return out;
}

/** Exactly `size` bytes written canonically, or null: a key or signature in any other spelling is refused, as core's `isBase64url` refuses it. */
export function fromBase64url(text: unknown, size: number): Uint8Array | null {
  if (typeof text !== 'string' || text.length !== Math.ceil((size * 4) / 3) || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const out = new Uint8Array(size);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const six = code === 95 ? 63 : code === 45 ? 62 : code >= 97 ? code - 71 : code >= 65 ? code - 65 : code + 4;
    value = (value << 6) | six;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (at < size) out[at++] = (value >> bits) & 0xff;
    }
  }
  return base64url(out) === text ? out : null;
}

/** The public half of an install key's 32-byte seed, base64url. */
export function publicKeyOf(seed: Uint8Array): string {
  return base64url(ed25519.getPublicKey(seed));
}

/** Core's `Sha256`. Synchronous, which core takes as well as a promise. */
export const nobleSha256 = (bytes: Uint8Array): Uint8Array => sha256(bytes);

/**
 * Core's `Verify`: plain Ed25519 under RFC 8032's strict rules (no ZIP 215), as the Worker's
 * `crypto.subtle` checks it, so a signature one side takes the other takes too. A key or a
 * signature that cannot be read is a failed check, never a throw.
 */
export function nobleVerify(publicKey: string, message: Uint8Array, signature: string): boolean {
  const key = fromBase64url(publicKey, 32);
  const sig = fromBase64url(signature, 64);
  if (!key || !sig) return false;
  try {
    return ed25519.verify(sig, message, key, { zip215: false });
  } catch {
    return false;
  }
}

/** Plain Ed25519 over these bytes with this seed, base64url. */
export function signWith(seed: Uint8Array, message: Uint8Array): string {
  return base64url(ed25519.sign(message, seed));
}

/** What `NearbyCrypto` asks of a platform, for one install key. */
export interface PhoneCrypto {
  publicKey: string;
  sign(message: Uint8Array): Promise<string>;
  verify(publicKey: string, message: Uint8Array, signature: string): boolean;
  sha256(bytes: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array;
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array;
  x25519Pair(): { secret: Uint8Array; public: Uint8Array };
  /** Throws on a key X25519 will not take or an all-zero result; the session's opening reads either as a stranger. */
  x25519(secret: Uint8Array, theirPublic: Uint8Array): Uint8Array;
  randomBytes(size: number): Uint8Array;
}

/** The crypto of the install whose Ed25519 seed this is. */
export function phoneCryptoOf(seed: Uint8Array, random: Random): PhoneCrypto {
  if (seed.length !== 32) throw new Error('An install key is 32 bytes.');
  return {
    publicKey: publicKeyOf(seed),
    sign: async (message) => signWith(seed, message),
    verify: nobleVerify,
    sha256: nobleSha256,
    hmacSha256: (key, message) => hmac(sha256, key, message),
    hkdfSha256: (ikm, salt, info, length) => hkdf(sha256, ikm, salt, utf8ToBytes(info), length),
    x25519Pair: () => {
      const secret = random(32);
      return { secret, public: x25519.getPublicKey(secret) };
    },
    x25519: (secret, theirPublic) => x25519.getSharedSecret(secret, theirPublic),
    randomBytes: random
  };
}
