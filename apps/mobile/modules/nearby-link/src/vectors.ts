import { gcm } from '@noble/ciphers/aes';
import {
  advertId, b64url, CANCEL_REASON, fileCancelBody, fileDataBody, fileEndBody, fileStartBody, FRAME, FRAME_MAX, gattChunks, gattUuid, hex, nonceOf, Sealer,
  scanResponse, sha256Hex, unhex, unmaskResponse, uuidText, v4
} from './wire';

/**
 * The golden vectors, made from `wire.ts` (docs/nearby-sync-plan.md 5.12). `test-vectors.json`
 * holds what this returns; vitest fails when they differ, and the module's JUnit tests read the
 * same file, so the Kotlin makes these bytes or the `android-native` job fails. To change a
 * format, change `wire.ts`, then write the file again:
 * `npx tsx apps/mobile/modules/nearby-link/src/vectors.ts > apps/mobile/modules/nearby-link/test-vectors.json`.
 */

const repeat = (byte: number, n: number) => new Uint8Array(n).fill(byte);
/** Bytes `i % 251`, so a misplaced chunk shows. */
export const pattern = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => i % 251);

export function makeVectors() {
  const scanKeys = [repeat(0x0a, 32), repeat(0x0b, 32), repeat(0x0c, 32)];
  const salt = unhex('a1a2a3a4a5a6');
  const r = unhex('5a5b');
  // A tag and summary as sync makes them, top bits already clear, and an echo.
  const payload = unhex('0102030405060708' + '090a0b0c0d0e');
  const response = scanResponse(scanKeys[1]!, salt, r, payload);
  const unmasked = unmaskResponse(scanKeys[1]!, salt, response);
  // A payload whose cleared bits were set: a receiver reads them cleared.
  const dirty = unhex('0102030415f6c708' + '090a0b0c0d0e');
  const dirtyRead = unmaskResponse(scanKeys[0]!, salt, scanResponse(scanKeys[0]!, salt, r, dirty));
  const stranger = repeat(0x0f, 32);
  const strangerSalt = unhex('b1b2b3b4b5b6');

  const key = unhex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const sealer = new Sealer(key);
  const frames = [
    { type: FRAME.message, body: '' },
    { type: FRAME.message, body: hex(new TextEncoder().encode('{"t":"have"}')) },
    { type: FRAME.fileStart, body: hex(fileStartBody('t1', 300)) },
    { type: FRAME.fileData, body: hex(fileDataBody('t1', pattern(300))) },
    { type: FRAME.fileEnd, body: hex(fileEndBody('t1')) },
    { type: FRAME.fileCancel, body: hex(fileCancelBody('t2', CANCEL_REASON.noSpace)) },
    { type: FRAME.bye, body: '' }
  ].map((f) => ({ ...f, sealed: hex(sealer.seal(f.type, unhex(f.body))) }));
  const headerOf = (len: number, type: number) => {
    const h = new Uint8Array(5);
    new DataView(h.buffer).setUint32(0, len);
    h[4] = type;
    return hex(gcm(key, nonceOf(0)).encrypt(h));
  };
  const stream = pattern(1200);

  return {
    about: 'Made by src/vectors.ts from src/wire.ts; read by apps/mobile/test/nearbyWire.test.ts and the JUnit tests (docs/nearby-sync-plan.md 5.12).',
    base64url: [new Uint8Array(0), unhex('ff'), unhex('fffe'), unhex('fffefd'), unhex('000102030405'), pattern(40)].map((b) => ({ hex: hex(b), b64: b64url(b) })),
    v4: [repeat(0xff, 16), repeat(0x00, 16), pattern(16)].map((b) => ({ in: hex(b), out: hex(v4(b)), text: uuidText(v4(b)) })),
    find: {
      scanKeys: scanKeys.map(hex),
      salt: hex(salt),
      adverts: scanKeys.map((k, scan) => ({ scan, id: hex(advertId(k, salt)) })),
      r: hex(r),
      payload: hex(payload),
      responseKey: 1,
      response: hex(response),
      unmasked: { r: hex(unmasked.r), tag: hex(unmasked.tag), summary: hex(unmasked.summary), echo: hex(unmasked.echo) },
      dirty: { key: 0, payload: hex(dirty), tag: hex(dirtyRead.tag), summary: hex(dirtyRead.summary) },
      stranger: { key: hex(stranger), salt: hex(strangerSalt), id: hex(advertId(stranger, strangerSalt)), response: hex(scanResponse(stranger, strangerSalt, r, payload)) },
      notForm: [hex(repeat(0xff, 16)), hex(pattern(16))],
      gatt: { key: 0, service: hex(gattUuid(scanKeys[0]!, salt, 0)), write: hex(gattUuid(scanKeys[0]!, salt, 1)), notify: hex(gattUuid(scanKeys[0]!, salt, 2)) }
    },
    nonces: [0, 1, 255, 256, 2 ** 32, Number.MAX_SAFE_INTEGER].map((counter) => ({ counter, hex: hex(nonceOf(counter)) })),
    frames: {
      key: hex(key),
      max: FRAME_MAX,
      frames,
      /** The first header under `key`, saying one byte past the ceiling: it opens, then is refused. */
      overHeader: headerOf(FRAME_MAX + 1, FRAME.message),
      /** Exactly the ceiling: allowed. */
      maxHeader: headerOf(FRAME_MAX, FRAME.message)
    },
    pipe: {
      streamBytes: stream.length,
      chunks: Object.fromEntries([23, 100, 517].map((mtu) => [String(mtu), gattChunks(stream, mtu).map((c) => c.length)]))
    },
    files: {
      bytes: 100_000,
      sha256: sha256Hex(pattern(100_000)),
      empty: sha256Hex(new Uint8Array(0))
    }
  };
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('vectors.ts')) process.stdout.write(`${JSON.stringify(makeVectors(), null, 2)}\n`);
