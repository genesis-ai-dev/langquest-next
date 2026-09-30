import { createHash } from 'node:crypto';
import { HASH_CHUNK_BYTES, Sha256, hashChunks } from '../src/sha256';

const reference = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Deterministic pseudo-random bytes, so failures reproduce. */
function bytesOf(length: number, seed = length): Uint8Array {
  const out = new Uint8Array(length);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

/** A reader over `bytes` like a file handle: at most `max` per call, empty at the end. */
function readerOver(bytes: Uint8Array) {
  let offset = 0;
  const calls: number[] = [];
  const read = (max: number) => {
    const chunk = bytes.slice(offset, offset + max);
    offset += chunk.length;
    calls.push(chunk.length);
    return chunk;
  };
  return { read, calls };
}

const noYield = { pause: async () => {} };

describe('Sha256', () => {
  it('matches the known digests of the FIPS 180-4 examples', () => {
    const enc = new TextEncoder();
    expect(new Sha256().digestHex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(new Sha256().update(enc.encode('abc')).digestHex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(new Sha256().update(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).digestHex())
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('matches node:crypto one-shot for every length around the padding boundaries', () => {
    for (let n = 0; n <= 200; n++) {
      const bytes = bytesOf(n);
      expect(new Sha256().update(bytes).digestHex(), `length ${n}`).toBe(reference(bytes));
    }
  });

  it('gives the same digest however the input is split', () => {
    const bytes = bytesOf(1000, 7);
    const want = reference(bytes);
    for (const step of [1, 3, 55, 56, 63, 64, 65, 127, 999]) {
      const sha = new Sha256();
      for (let i = 0; i < bytes.length; i += step) sha.update(bytes.subarray(i, i + step));
      expect(sha.digestHex(), `step ${step}`).toBe(want);
    }
  });

  it('refuses to be reused after the digest', () => {
    const sha = new Sha256();
    sha.digestHex();
    expect(() => sha.update(new Uint8Array(1))).toThrow();
    expect(() => sha.digestHex()).toThrow();
  });
});

describe('hashChunks', () => {
  it('hashes an empty file without reading past the end', async () => {
    const { read, calls } = readerOver(new Uint8Array(0));
    expect(await hashChunks(read, noYield)).toEqual({ hash: reference(new Uint8Array(0)), size: 0 });
    expect(calls).toEqual([0]);
  });

  it('matches a one-shot hash for sizes on, under and over chunk multiples', async () => {
    const chunk = 1024;
    for (const n of [1, chunk - 1, chunk, chunk + 1, 3 * chunk, 3 * chunk + 17, 10_000]) {
      const bytes = bytesOf(n);
      const { read, calls } = readerOver(bytes);
      expect(await hashChunks(read, { ...noYield, chunkBytes: chunk }), `size ${n}`).toEqual({ hash: reference(bytes), size: n });
      // Never asks for more than one chunk at a time.
      expect(Math.max(...calls)).toBeLessThanOrEqual(chunk);
    }
  });

  it('reads a large file in default-sized chunks', async () => {
    const bytes = bytesOf(HASH_CHUNK_BYTES * 2 + 5, 42);
    const { read, calls } = readerOver(bytes);
    const result = await hashChunks(read, noYield);
    expect(result).toEqual({ hash: reference(bytes), size: bytes.length });
    expect(calls).toEqual([HASH_CHUNK_BYTES, HASH_CHUNK_BYTES, 5, 0]);
  });

  it('gives the thread back only once a slice of work has run long enough', async () => {
    const bytes = bytesOf(10 * 100, 3);
    let clock = 0;
    let pauses = 0;
    const { read } = readerOver(bytes);
    // Each chunk "takes" 5 ms; a 12 ms slice pauses after every third chunk.
    const timed = (max: number) => { clock += 5; return read(max); };
    const result = await hashChunks(timed, { chunkBytes: 100, sliceMs: 12, now: () => clock, pause: async () => { pauses++; } });
    expect(result).toEqual({ hash: reference(bytes), size: bytes.length });
    expect(pauses).toBe(3);
  });

  it('pauses on its own timer by default', async () => {
    const bytes = bytesOf(300, 5);
    const { read } = readerOver(bytes);
    let clock = 0;
    const result = await hashChunks((max) => { clock += 100; return read(max); }, { chunkBytes: 100, now: () => clock });
    expect(result).toEqual({ hash: reference(bytes), size: 300 });
  });

  it('copes with a reader that returns short chunks before the end', async () => {
    const bytes = bytesOf(5000, 9);
    let offset = 0;
    const read = (max: number) => {
      const chunk = bytes.slice(offset, offset + Math.min(max, 333));
      offset += chunk.length;
      return chunk;
    };
    expect(await hashChunks(read, noYield)).toEqual({ hash: reference(bytes), size: 5000 });
  });
});
