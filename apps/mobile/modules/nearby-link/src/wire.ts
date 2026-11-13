import { gcm } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';

/**
 * The nearby link's byte formats (docs/nearby-sync-plan.md 5.12, "The link and the radio" and
 * "Find"), written once in TypeScript so that vitest and the module's JUnit tests hold the
 * Kotlin to the same bytes through `test-vectors.json`. Nothing on a phone imports this: the
 * radio's bytes are made natively, and the session's in `packages/sync`. Pure, with no keys
 * kept, logged or sent.
 *
 * - A Find id is one 128-bit service UUID in canonical (string) byte order, with byte 6's top
 *   four bits set to 0100 and byte 8's top two to 10, so every UUID is a valid version 4.
 * - A frame, after `secure`, is a sealed header (`u32be len || u8 type`, AES-256-GCM, 21 bytes)
 *   and a sealed body (`len` + 16 bytes). Each seal takes the next nonce of its direction,
 *   `0^4 || u64be counter` from 0, header first; there is no associated data. `len` is checked
 *   against 1 MiB once the header opens and before anything is allocated.
 * - A Bluetooth pipe is the same byte stream cut into GATT values of `min(mtu - 3, 512)` bytes,
 *   in order, with nothing added: the opening's 80 raw bytes, then sealed frames.
 */

/** The native frame ceiling (`NEARBY_MESSAGE_MAX` in packages/sync/src/nearbyLink.ts). */
export const FRAME_MAX = 1024 * 1024;
export const SEALED_HEADER_BYTES = 21;
export const TAG_BYTES = 16;
/** A GATT attribute holds at most 512 bytes, whatever the MTU. */
export const GATT_VALUE_MAX = 512;
/** The largest file chunk a sender cuts by default; an argument from JavaScript. */
export const FILE_CHUNK_DEFAULT = 64 * 1024;

export const FRAME = {
  message: 1,
  fileStart: 2,
  fileData: 3,
  fileEnd: 4,
  fileCancel: 5,
  bye: 6
} as const;

/** Why a file stopped, in a `fileCancel` frame's last byte. */
export const CANCEL_REASON = { cancelled: 0, tooBig: 1, noSpace: 2, unreadable: 3, unwanted: 4 } as const;

const enc = new TextEncoder();
const utf8 = (s: string) => enc.encode(s);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Base64url with no padding, as every other byte string in a native callback (5.12). */
export function b64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (left > 1 ? B64[(n >> 6) & 63]! : '') + (left > 2 ? B64[n & 63]! : '');
  }
  return out;
}

const xor = (a: Uint8Array, b: Uint8Array) => a.map((x, i) => x ^ b[i]!);
const mac = (key: Uint8Array, ...parts: Uint8Array[]) => hmac(sha256, key, concat(...parts));

// ---- Find -----------------------------------------------------------------------

/** `v4(x)`: the version and variant bits that every UUID here carries. */
export function v4(x: Uint8Array): Uint8Array {
  if (x.length !== 16) throw new RangeError('a UUID is 16 bytes');
  const out = new Uint8Array(x);
  out[6] = (out[6]! & 0x0f) | 0x40;
  out[8] = (out[8]! & 0x3f) | 0x80;
  return out;
}

export const uuidText = (u: Uint8Array): string => {
  const h = hex(u);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** The advert: `v4(salt || HMAC-SHA256(kFind, 'find' || salt)[0..10])`. */
export function advertId(kFind: Uint8Array, salt: Uint8Array): Uint8Array {
  if (salt.length !== 6) throw new RangeError('a salt is 6 bytes');
  return v4(concat(salt, mac(kFind, utf8('find'), salt).slice(0, 10)));
}

/** The scan response: `v4(r || ((tag || summary || echo) XOR HMAC-SHA256(kFind, 'sum' || salt || r)[0..14]))`. */
export function scanResponse(kFind: Uint8Array, salt: Uint8Array, r: Uint8Array, payload: Uint8Array): Uint8Array {
  if (r.length !== 2) throw new RangeError('r is 2 bytes');
  if (payload.length !== 14) throw new RangeError('a payload is 14 bytes');
  return v4(concat(r, xor(payload, mac(kFind, utf8('sum'), salt, r).slice(0, 14))));
}

/** What a teammate reads off a scan response: the bits `v4` overwrote are cleared, as the sender cleared them. */
export function unmaskResponse(kFind: Uint8Array, salt: Uint8Array, response: Uint8Array): { r: Uint8Array; tag: Uint8Array; summary: Uint8Array; echo: Uint8Array } {
  const r = response.slice(0, 2);
  const payload = xor(response.slice(2, 16), mac(kFind, utf8('sum'), salt, r).slice(0, 14));
  payload[4] = payload[4]! & 0x0f;
  payload[6] = payload[6]! & 0x3f;
  return { r, tag: payload.slice(0, 6), summary: payload.slice(6, 10), echo: payload.slice(10, 14) };
}

/** Which of `scanKeys` an advert id was made under, or -1. */
export function matchAdvert(scanKeys: readonly Uint8Array[], id: Uint8Array): number {
  const salt = id.slice(0, 6);
  return scanKeys.findIndex((k) => hex(advertId(k, salt)) === hex(id));
}

/** An advert of this form: one or two version 4 UUIDs and nothing else, the first the advert's. */
export function isForm(uuids: readonly Uint8Array[]): boolean {
  return uuids.length >= 1 && uuids.length <= 2 && uuids.every((u) => u.length === 16 && (u[6]! & 0xf0) === 0x40 && (u[8]! & 0xc0) === 0x80);
}

/** The GATT service (0), the characteristic written to the advertiser (1) and the one it notifies on (2). */
export function gattUuid(kFind: Uint8Array, salt: Uint8Array, which: 0 | 1 | 2): Uint8Array {
  return v4(mac(kFind, utf8('gatt'), salt, Uint8Array.of(which)).slice(0, 16));
}

// ---- frames ---------------------------------------------------------------------

export function nonceOf(counter: number): Uint8Array {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setBigUint64(4, BigInt(counter));
  return out;
}

/** One direction's sealing: each call takes the next two nonces, header then body. */
export class Sealer {
  private counter = 0;
  constructor(private readonly key: Uint8Array) {
    if (key.length !== 32) throw new RangeError('a frame key is 32 bytes');
  }

  seal(type: number, body: Uint8Array): Uint8Array {
    if (body.length > FRAME_MAX) throw new RangeError('over the frame ceiling');
    const header = new Uint8Array(5);
    new DataView(header.buffer).setUint32(0, body.length);
    header[4] = type;
    const h = gcm(this.key, nonceOf(this.counter++)).encrypt(header);
    const b = gcm(this.key, nonceOf(this.counter++)).encrypt(body);
    return concat(h, b);
  }
}

/** One direction's opening. Any failure is final: a failed tag closes the link. */
export class Opener {
  private counter = 0;
  constructor(private readonly key: Uint8Array) {
    if (key.length !== 32) throw new RangeError('a frame key is 32 bytes');
  }

  /** `len` and `type`; throws past the ceiling, before the body is read or allocated. */
  header(sealed: Uint8Array): { len: number; type: number } {
    if (sealed.length !== SEALED_HEADER_BYTES) throw new RangeError('a sealed header is 21 bytes');
    const plain = gcm(this.key, nonceOf(this.counter++)).decrypt(sealed);
    const len = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
    if (len > FRAME_MAX) throw new RangeError('over the frame ceiling');
    return { len, type: plain[4]! };
  }

  body(sealed: Uint8Array): Uint8Array {
    return gcm(this.key, nonceOf(this.counter++)).decrypt(sealed);
  }
}

const idBytes = (transferId: string) => {
  const id = utf8(transferId);
  if (id.length < 1 || id.length > 64) throw new RangeError('a transfer id is 1 to 64 bytes');
  return concat(Uint8Array.of(id.length), id);
};

export function fileStartBody(transferId: string, size: number): Uint8Array {
  const n = new Uint8Array(8);
  new DataView(n.buffer).setBigUint64(0, BigInt(size));
  return concat(idBytes(transferId), n);
}
export const fileDataBody = (transferId: string, data: Uint8Array): Uint8Array => concat(idBytes(transferId), data);
export const fileEndBody = (transferId: string): Uint8Array => idBytes(transferId);
export const fileCancelBody = (transferId: string, reason: number): Uint8Array => concat(idBytes(transferId), Uint8Array.of(reason));

// ---- the pipe -------------------------------------------------------------------

/** GATT values in order, each at most `min(mtu - 3, 512)` bytes, holding only the stream's bytes. */
export function gattChunks(stream: Uint8Array, mtu: number): Uint8Array[] {
  const size = Math.min(mtu - 3, GATT_VALUE_MAX);
  if (size < 1) throw new RangeError('an MTU leaves no room');
  const out: Uint8Array[] = [];
  for (let at = 0; at < stream.length; at += size) out.push(stream.slice(at, at + size));
  return out;
}

export const sha256Hex = (bytes: Uint8Array): string => hex(sha256(bytes));
