/**
 * Incremental SHA-256 (FIPS 180-4) in plain TypeScript, so a file can be
 * hashed a chunk at a time and never held whole in the JS heap. expo-crypto
 * only digests a complete buffer, and no runtime dependency offers an
 * incremental hash. Pure: no I/O, no platform imports, so it is tested in
 * Node against node:crypto (test/sha256.test.ts).
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

export class Sha256 {
  private readonly h = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  private readonly w = new Int32Array(64);
  /** Bytes of a partial block carried between `update` calls. */
  private readonly pending = new Uint8Array(64);
  private pendingLength = 0;
  private total = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: update after digest');
    let i = 0;
    const n = data.length;
    this.total += n;
    if (this.pendingLength > 0) {
      const take = Math.min(64 - this.pendingLength, n);
      this.pending.set(data.subarray(0, take), this.pendingLength);
      this.pendingLength += take;
      i = take;
      if (this.pendingLength < 64) return this;
      this.block(this.pending, 0);
      this.pendingLength = 0;
    }
    // Whole blocks straight from the input, without copying.
    for (; i + 64 <= n; i += 64) this.block(data, i);
    if (i < n) {
      this.pending.set(data.subarray(i), 0);
      this.pendingLength = n - i;
    }
    return this;
  }

  /** Lowercase hex digest. The hash cannot be updated afterwards. */
  digestHex(): string {
    if (this.finished) throw new Error('Sha256: digest called twice');
    const bits = this.total * 8;
    const tail = new Uint8Array(this.pendingLength < 56 ? 64 : 128);
    tail.set(this.pending.subarray(0, this.pendingLength));
    tail[this.pendingLength] = 0x80;
    const end = tail.length;
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits >>> 0;
    tail[end - 8] = hi >>> 24; tail[end - 7] = hi >>> 16; tail[end - 6] = hi >>> 8; tail[end - 5] = hi;
    tail[end - 4] = lo >>> 24; tail[end - 3] = lo >>> 16; tail[end - 2] = lo >>> 8; tail[end - 1] = lo;
    for (let off = 0; off < end; off += 64) this.block(tail, off);
    this.finished = true;
    let hex = '';
    for (let j = 0; j < 8; j++) hex += (this.h[j]! >>> 0).toString(16).padStart(8, '0');
    return hex;
  }

  private block(d: Uint8Array, off: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const p = off + t * 4;
      w[t] = (d[p]! << 24) | (d[p + 1]! << 16) | (d[p + 2]! << 8) | d[p + 3]!;
    }
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15]!;
      const b = w[t - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
    }
    const h = this.h;
    let a = h[0]!, b = h[1]!, c = h[2]!, dd = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t]! + w[t]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (dd + t1) | 0;
      dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0; h[1] = (h[1]! + b) | 0; h[2] = (h[2]! + c) | 0; h[3] = (h[3]! + dd) | 0;
    h[4] = (h[4]! + e) | 0; h[5] = (h[5]! + f) | 0; h[6] = (h[6]! + g) | 0; h[7] = (h[7]! + hh) | 0;
  }
}

/**
 * Bytes read per call when hashing a file. Peak JS memory for a hash is one
 * chunk whatever the file's size. 64 KiB keeps each step short on a slow
 * phone (the hash runs in the JS interpreter) while native read calls stay
 * few: a 5 MB file is about 80 of them.
 */
export const HASH_CHUNK_BYTES = 64 * 1024;

/** Longest the hash runs before giving the JS thread back, so taps still land. */
export const HASH_SLICE_MS = 16;

export interface HashChunksOptions {
  chunkBytes?: number;
  /** Hand the thread back; defaults to a zero-delay timer. */
  pause?: () => Promise<void>;
  sliceMs?: number;
  now?: () => number;
}

/**
 * Hash everything `read` returns, one bounded chunk at a time, until it
 * returns an empty chunk. Gives the event loop a turn whenever a slice of
 * work has run for `sliceMs`, so a long file does not freeze the screen,
 * without paying a timer per chunk on a fast phone. Returns the hex digest
 * and the byte count.
 */
export async function hashChunks(read: (maxBytes: number) => Uint8Array, opts: HashChunksOptions = {}): Promise<{ hash: string; size: number }> {
  const chunkBytes = opts.chunkBytes ?? HASH_CHUNK_BYTES;
  const pause = opts.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const sliceMs = opts.sliceMs ?? HASH_SLICE_MS;
  const now = opts.now ?? Date.now;
  const sha = new Sha256();
  let size = 0;
  let sliceStart = now();
  for (;;) {
    const chunk = read(chunkBytes);
    if (chunk.length === 0) break;
    sha.update(chunk);
    size += chunk.length;
    if (now() - sliceStart >= sliceMs) {
      await pause();
      sliceStart = now();
    }
  }
  return { hash: sha.digestHex(), size };
}
