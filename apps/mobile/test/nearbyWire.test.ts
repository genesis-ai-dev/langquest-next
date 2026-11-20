import { createCipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { base64urlEncode } from '@langquest-next/core/nearby';
import { findEchoOf, findPayload, findTagOf } from '../../../packages/sync/src/nearbyOpening';
import { fakeSigner } from '../../../packages/sync/src/testing/memoryNearbyLink';
import { makeVectors, pattern } from '../modules/nearby-link/src/vectors';
import {
  advertId, b64url, FRAME, gattChunks, gattUuid, hex, isForm, matchAdvert, nonceOf, Opener, scanResponse, Sealer, unhex, unmaskResponse
} from '../modules/nearby-link/src/wire';

/**
 * The nearby link's byte formats (modules/nearby-link/src/wire.ts, docs/nearby-sync-plan.md
 * 5.12) against the golden vectors the module's JUnit tests read, against Node's own AES-GCM
 * and SHA-256, and against the Find payload sync makes, so that the Kotlin, the vectors and
 * the session agree on every byte.
 */

const VECTORS = 'apps/mobile/modules/nearby-link/test-vectors.json';
const file = JSON.parse(readFileSync(VECTORS, 'utf8')) as ReturnType<typeof makeVectors>;

describe('the golden vectors', () => {
  it('are what wire.ts makes today', () => {
    // A change to a format writes the file again: npx tsx apps/mobile/modules/nearby-link/src/vectors.ts > test-vectors.json
    expect(file).toEqual(JSON.parse(JSON.stringify(makeVectors())));
  });

  it('spell base64url as core does', () => {
    for (const { hex: h, b64 } of file.base64url) expect(base64urlEncode(unhex(h))).toBe(b64);
  });
});

describe('frames', () => {
  const key = unhex(file.frames.key);

  it('are AES-256-GCM as Node seals it, nonce 0^4 || u64be counter, header then body', () => {
    let counter = 0;
    const seal = (plain: Uint8Array) => {
      const c = createCipheriv('aes-256-gcm', key, nonceOf(counter++));
      return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
    };
    for (const f of file.frames.frames) {
      const body = unhex(f.body);
      const header = Buffer.alloc(5);
      header.writeUInt32BE(body.length, 0);
      header[4] = f.type;
      expect(Buffer.concat([seal(header), seal(body)]).toString('hex')).toBe(f.sealed);
    }
  });

  it('open in order, and refuse a length past 1 MiB before reading its body', () => {
    const opener = new Opener(key);
    for (const f of file.frames.frames) {
      const sealed = unhex(f.sealed);
      const { len, type } = opener.header(sealed.slice(0, 21));
      expect({ len, type }).toEqual({ len: f.body.length / 2, type: f.type });
      expect(hex(opener.body(sealed.slice(21)))).toBe(f.body);
    }
    expect(() => new Opener(key).header(unhex(file.frames.overHeader))).toThrow(/ceiling/);
    expect(new Opener(key).header(unhex(file.frames.maxHeader)).len).toBe(file.frames.max);
  });

  it('close on a changed byte, a frame out of order or a cut one', () => {
    const sealed = unhex(file.frames.frames[1]!.sealed);
    const tampered = new Uint8Array(sealed);
    tampered[25] = tampered[25]! ^ 1;
    const o = new Opener(key);
    o.header(unhex(file.frames.frames[0]!.sealed).slice(0, 21));
    o.body(unhex(file.frames.frames[0]!.sealed).slice(21));
    o.header(tampered.slice(0, 21));
    expect(() => o.body(tampered.slice(21))).toThrow();
    // The second frame's header under the first nonce: out of order.
    expect(() => new Opener(key).header(sealed.slice(0, 21))).toThrow();
    expect(() => new Opener(key).header(unhex(file.frames.frames[0]!.sealed).slice(0, 21))).not.toThrow();
    expect(() => new Opener(key).header(sealed.slice(0, 20))).toThrow();
  });

  it('never seal past the ceiling', () => {
    expect(() => new Sealer(key).seal(FRAME.message, new Uint8Array(file.frames.max + 1))).toThrow();
  });
});

describe('Find', () => {
  const f = file.find;
  const keys = f.scanKeys.map(unhex);
  const salt = unhex(f.salt);

  it('matches an advert to the key it was made under, and gives back its place', () => {
    for (const a of f.adverts) {
      expect(hex(advertId(keys[a.scan]!, salt))).toBe(a.id);
      expect(matchAdvert(keys, unhex(a.id))).toBe(a.scan);
      expect(matchAdvert([keys[2]!, keys[1]!, keys[0]!], unhex(a.id))).toBe(2 - a.scan);
    }
  });

  it('hands up only the salt of an advert of this form that no key matches', () => {
    expect(matchAdvert(keys, unhex(f.stranger.id))).toBe(-1);
    expect(isForm([unhex(f.stranger.id), unhex(f.stranger.response)])).toBe(true);
    expect(unhex(f.stranger.id).slice(0, 6)).toEqual(unhex(f.stranger.salt));
    for (const u of f.notForm) expect(isForm([unhex(u)])).toBe(false);
    expect(isForm([unhex(f.adverts[0]!.id), unhex(f.response), unhex(f.response)])).toBe(false);
  });

  it('unmasks a scan response, the bits v4 overwrote read as cleared', () => {
    const read = unmaskResponse(keys[f.responseKey]!, salt, unhex(f.response));
    expect({ r: hex(read.r), tag: hex(read.tag), summary: hex(read.summary), echo: hex(read.echo) }).toEqual(f.unmasked);
    expect(f.dirty.tag).toBe('0102030405f6');
    // 0x15 and 0xc7 were sent where the cleared bits sit: read as 0x05 and 0x07.
    expect(f.dirty.summary).toBe('0708090a');
  });

  it('reads back the tag, summary and echo that sync puts in a payload', () => {
    const crypto = fakeSigner('wire');
    const kFind = keys[0]!;
    const tag = findTagOf(crypto, kFind, crypto.publicKey);
    const r = b64url(unhex('0102'));
    const echo = findEchoOf(crypto, kFind, b64url(unhex('aabbccddeeff')), r);
    const payload = findPayload(tag, '1f1d85db', echo);
    const read = unmaskResponse(kFind, salt, scanResponse(kFind, salt, unhex('0102'), payload));
    expect(hex(read.tag)).toBe(tag);
    expect(hex(read.summary)).toBe('1f1d85db');
    expect(b64url(read.echo)).toBe(echo);
  });

  it('gives each mask a new r: two responses under one salt and r would show the layout', () => {
    const a = scanResponse(keys[0]!, salt, unhex('0001'), unhex(f.payload));
    const b = scanResponse(keys[0]!, salt, unhex('0002'), unhex(f.payload));
    expect(hex(a.slice(2))).not.toBe(hex(b.slice(2)));
  });

  it('derives the GATT service and characteristics, each a version 4 UUID, none the same', () => {
    const g = f.gatt;
    const made = [0, 1, 2].map((w) => hex(gattUuid(keys[g.key]!, salt, w as 0 | 1 | 2)));
    expect(made).toEqual([g.service, g.write, g.notify]);
    expect(new Set(made).size).toBe(3);
    expect(isForm(made.map(unhex).slice(0, 2))).toBe(true);
  });
});

describe('the pipe', () => {
  it('cuts the stream into GATT values of min(mtu - 3, 512) bytes and adds nothing', () => {
    const stream = pattern(file.pipe.streamBytes);
    for (const [mtu, sizes] of Object.entries(file.pipe.chunks)) {
      const chunks = gattChunks(stream, Number(mtu));
      expect(chunks.map((c) => c.length)).toEqual(sizes);
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(stream));
    }
    expect(file.pipe.chunks['23']![0]).toBe(20);
    expect(file.pipe.chunks['517']![0]).toBe(512);
  });
});

describe('files', () => {
  it('are hashed as Node hashes them', () => {
    expect(createHash('sha256').update(pattern(file.files.bytes)).digest('hex')).toBe(file.files.sha256);
    expect(createHash('sha256').digest('hex')).toBe(file.files.empty);
  });
});
