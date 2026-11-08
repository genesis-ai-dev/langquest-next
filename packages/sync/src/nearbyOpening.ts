import {
  base64urlDecode, base64urlEncode, bytesToHex, concatBytes, NEARBY_OPENING_BYTES, openingMaskInput, openingTagInputI, openingTagInputR, transcriptInput, utf8Encode
} from '@langquest-next/core/nearby';
import type { NearbyCrypto } from './nearbyLink';

/**
 * The keys and first bytes of a channel (docs/nearby-sync-plan.md 5.12, Session keys).
 * Nothing readable goes out until the other side proves it holds `kSess`, so each opening
 * is exactly 80 raw bytes with no type or version, and every byte looks random. Its form is
 * frozen for the life of the app: a phone that cannot open it never reaches Hello.
 */

export type NearbyCryptoLike = Pick<NearbyCrypto, 'sha256' | 'hmacSha256' | 'hkdfSha256' | 'x25519Pair' | 'x25519' | 'randomBytes'>;

const NONE = new Uint8Array(0);
const NONCE_BYTES = 32;
const EPH_BYTES = 32;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const xor = (a: Uint8Array, b: Uint8Array) => a.map((x, i) => x ^ b[i]!);
/** The whole length, whatever differs first, so that a stranger cannot read a tag off how long a check took. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** What one generation of a language's discovery key gives. */
export interface NearbyChannelKeys {
  kFind: Uint8Array;
  kSess: Uint8Array;
}

export function channelKeysOf(crypto: Pick<NearbyCrypto, 'hkdfSha256'>, discoveryKey: Uint8Array): NearbyChannelKeys {
  return {
    kFind: crypto.hkdfSha256(discoveryKey, NONE, 'lq-nearby-find-v1', KEY_BYTES),
    kSess: crypto.hkdfSha256(discoveryKey, NONE, 'lq-nearby-sess-v1', KEY_BYTES)
  };
}

/** On a QR link the salt is the fixed bytes `qr`, and `kSess` comes from the code's secret (phase 6). */
export const QR_SALT = utf8Encode('qr');

/** `kOpen`, which keys the opening's masks and tags. */
export const openingKeyOf = (crypto: Pick<NearbyCrypto, 'hkdfSha256'>, kSess: Uint8Array): Uint8Array => crypto.hkdfSha256(kSess, NONE, 'lq-nearby-open-v1', KEY_BYTES);
const tag = (crypto: NearbyCryptoLike, kOpen: Uint8Array, input: Uint8Array) => crypto.hmacSha256(kOpen, input).slice(0, TAG_BYTES);

export interface NearbyOpeningMade {
  bytes: Uint8Array;
  nonce: Uint8Array;
  secret: Uint8Array;
  eph: Uint8Array;
}

/** `i`'s opening. The ephemeral key and nonce are drawn here, and passed in only by the golden vectors. */
export function makeOpeningI(crypto: NearbyCryptoLike, kOpen: Uint8Array, salt: Uint8Array, drawn?: { nonce: Uint8Array; eph: { secret: Uint8Array; public: Uint8Array } }): NearbyOpeningMade {
  const nonce = drawn?.nonce ?? crypto.randomBytes(NONCE_BYTES);
  const eph = drawn?.eph ?? crypto.x25519Pair();
  const masked = xor(eph.public, crypto.hmacSha256(kOpen, openingMaskInput('i', salt, nonce)));
  return { bytes: concatBytes(nonce, masked, tag(crypto, kOpen, openingTagInputI(salt, nonce, masked))), nonce, secret: eph.secret, eph: eph.public };
}

/** `i`'s opening as `r` reads it: the HMAC before anything else. Null with no difference between a wrong key and random bytes. */
export function checkOpeningI(crypto: NearbyCryptoLike, kOpen: Uint8Array, salt: Uint8Array, bytes: Uint8Array): { nonce: Uint8Array; eph: Uint8Array } | null {
  if (bytes.length !== NEARBY_OPENING_BYTES) return null;
  const nonce = bytes.slice(0, NONCE_BYTES);
  const masked = bytes.slice(NONCE_BYTES, NONCE_BYTES + EPH_BYTES);
  if (!sameBytes(bytes.slice(NONCE_BYTES + EPH_BYTES), tag(crypto, kOpen, openingTagInputI(salt, nonce, masked)))) return null;
  return { nonce, eph: xor(masked, crypto.hmacSha256(kOpen, openingMaskInput('i', salt, nonce))) };
}

/** `r`'s reply, bound to `i`'s whole opening so that a recorded reply cannot be reused. */
export function makeOpeningR(crypto: NearbyCryptoLike, kOpen: Uint8Array, salt: Uint8Array, openingI: Uint8Array, drawn?: { nonce: Uint8Array; eph: { secret: Uint8Array; public: Uint8Array } }): NearbyOpeningMade {
  const nonceI = openingI.slice(0, NONCE_BYTES);
  const nonce = drawn?.nonce ?? crypto.randomBytes(NONCE_BYTES);
  const eph = drawn?.eph ?? crypto.x25519Pair();
  const masked = xor(eph.public, crypto.hmacSha256(kOpen, openingMaskInput('r', salt, nonceI, nonce)));
  return { bytes: concatBytes(nonce, masked, tag(crypto, kOpen, openingTagInputR(salt, openingI, nonce, masked))), nonce, secret: eph.secret, eph: eph.public };
}

export function checkOpeningR(crypto: NearbyCryptoLike, kOpen: Uint8Array, salt: Uint8Array, openingI: Uint8Array, bytes: Uint8Array): { nonce: Uint8Array; eph: Uint8Array } | null {
  if (bytes.length !== NEARBY_OPENING_BYTES) return null;
  const nonceI = openingI.slice(0, NONCE_BYTES);
  const nonce = bytes.slice(0, NONCE_BYTES);
  const masked = bytes.slice(NONCE_BYTES, NONCE_BYTES + EPH_BYTES);
  if (!sameBytes(bytes.slice(NONCE_BYTES + EPH_BYTES), tag(crypto, kOpen, openingTagInputR(salt, openingI, nonce, masked)))) return null;
  return { nonce, eph: xor(masked, crypto.hmacSha256(kOpen, openingMaskInput('r', salt, nonceI, nonce))) };
}

export interface NearbySessionKeys {
  /** Lowercase hex of the transcript hash, which the session proof signs. */
  th: string;
  first: { iToR: Uint8Array; rToI: Uint8Array };
  wifi: { iToR: Uint8Array; rToI: Uint8Array };
}

/** Null on an all-zero result, or a key X25519 will not take. A new session is a new exchange and new keys. */
export function sessionKeysOf(crypto: NearbyCryptoLike, kSess: Uint8Array, mine: { secret: Uint8Array }, theirs: { eph: Uint8Array }, t: { ephI: Uint8Array; ephR: Uint8Array; nonceI: Uint8Array; nonceR: Uint8Array }): NearbySessionKeys | null {
  let ss: Uint8Array;
  try {
    ss = crypto.x25519(mine.secret, theirs.eph);
  } catch {
    return null;
  }
  if (ss.every((b) => b === 0)) return null;
  const th = crypto.sha256(transcriptInput(t.ephI, t.ephR, t.nonceI, t.nonceR));
  const okm = crypto.hkdfSha256(concatBytes(ss, kSess), th, 'lq-nearby-keys-v1', 128);
  return {
    th: bytesToHex(th),
    first: { iToR: okm.slice(0, 32), rToI: okm.slice(32, 64) },
    wifi: { iToR: okm.slice(64, 96), rToI: okm.slice(96, 128) }
  };
}

/**
 * The keys one Wi-Fi attempt's link is secured with (5.12, Session keys): each attempt of the
 * plan has its own, so a link secured for an abandoned attempt, or its sealed goodbye, never
 * reuses a nonce under the winning attempt's keys. `attempt` is the place in the plan, which the
 * host's `host` message names and both sides check against the plan they worked out.
 */
export function attemptKeysOf(crypto: Pick<NearbyCrypto, 'hkdfSha256'>, wifi: { iToR: Uint8Array; rToI: Uint8Array }, attempt: number): { iToR: Uint8Array; rToI: Uint8Array } {
  if (!Number.isSafeInteger(attempt) || attempt < 0) throw new RangeError('an attempt is a place in the plan');
  const okm = crypto.hkdfSha256(concatBytes(wifi.iToR, wifi.rToI), NONE, `lq-nearby-attempt-v1\n${attempt}`, 2 * KEY_BYTES);
  return { iToR: okm.slice(0, KEY_BYTES), rToI: okm.slice(KEY_BYTES, 2 * KEY_BYTES) };
}

// ---- Find -------------------------------------------------------------------------

/** Hex of a tag or summary as bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A phone's tag under one generation: worked out from the install key, because a `deviceId` can name a teammate. */
export function findTagOf(crypto: Pick<NearbyCrypto, 'hmacSha256'>, kFind: Uint8Array, installKey: string): string {
  const key = base64urlDecode(installKey) ?? NONE;
  const tagged = crypto.hmacSha256(kFind, concatBytes(utf8Encode('tag'), key)).slice(0, 6);
  tagged[4] = tagged[4]! & 0x0f;
  return bytesToHex(tagged);
}

/** Base64url, as `SeenPhone.echo` is. */
export function findEchoOf(crypto: Pick<NearbyCrypto, 'hmacSha256'>, kFind: Uint8Array, heardSalt: string, r: string): string {
  const salt = base64urlDecode(heardSalt) ?? NONE;
  const rBytes = base64urlDecode(r) ?? NONE;
  return base64urlEncode(crypto.hmacSha256(kFind, concatBytes(utf8Encode('echo'), salt, rBytes)).slice(0, 4));
}

/** Tag, summary and echo: the 14 bytes of a scan response before native masks them. */
export function findPayload(tagHex: string, summaryHex: string, echo: string): Uint8Array {
  return concatBytes(hexToBytes(tagHex), hexToBytes(summaryHex), base64urlDecode(echo) ?? new Uint8Array(4));
}
