import { crc32 } from 'node:zlib';

/**
 * A zip written front to back, with no compression (recordings are already
 * compressed, and the sheets are small) and no file on disk: each entry is
 * handed whole, its header written with the size and checksum, and the
 * central directory at the end. Over 4 GB or 65,535 files it writes the zip64
 * records, which every unzip tool of this decade reads. The organization
 * export's archive (decisions.md 205, docs/org-export.md).
 */

const U32 = 0xffffffff;
const U16 = 0xffff;

interface Entry { name: Uint8Array; crc: number; size: number; offset: number; dos: { time: number; date: number } }

const dosOf = (ms: number) => {
  const d = new Date(Math.max(ms, Date.UTC(1980, 0, 1)));
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()
  };
};

class Bytes {
  private parts: number[] = [];
  u16(v: number) { this.parts.push(v & 0xff, (v >>> 8) & 0xff); return this; }
  u32(v: number) { this.u16(v & U16); this.u16(Math.floor(v / 0x10000) & U16); return this; }
  u64(v: number) { this.u32(v % 0x100000000); this.u32(Math.floor(v / 0x100000000)); return this; }
  raw(b: Uint8Array) { for (const x of b) this.parts.push(x); return this; }
  done() { return Uint8Array.from(this.parts); }
}

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private names = new Set<string>();

  constructor(private readonly write: (chunk: Uint8Array) => Promise<void>, private readonly now: () => number = Date.now) {}

  get bytesWritten(): number { return this.offset; }
  get count(): number { return this.entries.length; }

  private async out(chunk: Uint8Array): Promise<void> {
    await this.write(chunk);
    this.offset += chunk.length;
  }

  /** Add one file. A name used twice is refused: two files must never overwrite each other when unzipped. */
  async add(path: string, bytes: Uint8Array, mtime: number = this.now()): Promise<void> {
    if (path.startsWith('/') || path.split('/').some((p) => p === '..' || p === '')) throw new Error(`zip path not allowed: ${path}`);
    if (this.names.has(path.toLowerCase())) throw new Error(`zip path used twice: ${path}`);
    if (bytes.length >= U32) throw new Error(`a single file over 4 GB cannot go in the zip: ${path}`);
    this.names.add(path.toLowerCase());
    const name = new TextEncoder().encode(path);
    const entry: Entry = { name, crc: crc32(bytes), size: bytes.length, offset: this.offset, dos: dosOf(mtime) };
    const h = new Bytes()
      .u32(0x04034b50).u16(20).u16(0x0800).u16(0).u16(entry.dos.time).u16(entry.dos.date)
      .u32(entry.crc).u32(entry.size).u32(entry.size).u16(name.length).u16(0).raw(name);
    this.entries.push(entry);
    await this.out(h.done());
    await this.out(bytes);
  }

  /** Write the directory. Nothing may be added after. */
  async finish(): Promise<void> {
    const dirStart = this.offset;
    for (const e of this.entries) {
      const big = e.offset >= U32;
      const extra = big ? new Bytes().u16(0x0001).u16(8).u64(e.offset).done() : new Uint8Array(0);
      await this.out(new Bytes()
        .u32(0x02014b50).u16(big ? 45 : 20).u16(big ? 45 : 20).u16(0x0800).u16(0).u16(e.dos.time).u16(e.dos.date)
        .u32(e.crc).u32(e.size).u32(e.size).u16(e.name.length).u16(extra.length).u16(0).u16(0).u16(0).u32(0).u32(big ? U32 : e.offset)
        .raw(e.name).raw(extra).done());
    }
    const dirSize = this.offset - dirStart;
    const n = this.entries.length;
    const zip64 = n >= U16 || dirStart >= U32 || dirSize >= U32;
    if (zip64) {
      const at = this.offset;
      await this.out(new Bytes().u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(n).u64(n).u64(dirSize).u64(dirStart).done());
      await this.out(new Bytes().u32(0x07064b50).u32(0).u64(at).u32(1).done());
    }
    await this.out(new Bytes().u32(0x06054b50).u16(0).u16(0).u16(zip64 ? U16 : n).u16(zip64 ? U16 : n)
      .u32(zip64 ? U32 : dirSize).u32(zip64 ? U32 : dirStart).u16(0).done());
  }
}

/**
 * Cuts a stream of chunks into parts of at least `size` bytes (the last may
 * be shorter), which R2's multipart upload needs: every part but the last at
 * least 5 MiB.
 */
export class Parts {
  private held: Uint8Array[] = [];
  private length = 0;
  private n = 0;

  constructor(private readonly size: number, private readonly send: (n: number, bytes: Uint8Array) => Promise<void>) {}

  get sent(): number { return this.n; }

  async push(chunk: Uint8Array): Promise<void> {
    this.held.push(chunk);
    this.length += chunk.length;
    while (this.length >= this.size) await this.flush(this.size);
  }

  async end(): Promise<void> {
    if (this.length > 0 || this.n === 0) await this.flush(this.length);
  }

  private async flush(take: number): Promise<void> {
    const buf = new Uint8Array(take);
    let at = 0;
    while (at < take) {
      const head = this.held[0]!;
      const use = Math.min(head.length, take - at);
      buf.set(head.subarray(0, use), at);
      at += use;
      if (use === head.length) this.held.shift(); else this.held[0] = head.subarray(use);
    }
    this.length -= take;
    this.n += 1;
    await this.send(this.n, buf);
  }
}
