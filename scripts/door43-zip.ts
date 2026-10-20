/**
 * A zip file's entries, read in memory (scripts/door43-seed.ts): Door43's
 * release zipballs, whose file names are UTF-8 whether or not the zip says
 * so, and which `unzip` on a Mac cannot write out. Stored and deflated
 * entries only, which is all git archives use; no zip64.
 */
import { inflateRawSync } from 'node:zlib';

export interface ZipEntries {
  /** File paths in the zip (no directories), in its order. */
  names: string[];
  /** One file's bytes, or undefined when the zip has no such file. */
  bytes(name: string): Buffer | undefined;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function readZip(zip: Buffer): ZipEntries {
  // The end-of-central-directory record is in the last 64 KB (its comment is at most 65535 bytes).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries = new Map<string, { method: number; size: number; local: number }>();
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== CENTRAL) throw new Error('a damaged zip directory');
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (!name.endsWith('/')) {
      entries.set(name, { method, size, local });
      names.push(name);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names,
    bytes(name) {
      const e = entries.get(name);
      if (!e) return undefined;
      if (zip.readUInt32LE(e.local) !== LOCAL) throw new Error(`a damaged zip entry: ${name}`);
      const start = e.local + 30 + zip.readUInt16LE(e.local + 26) + zip.readUInt16LE(e.local + 28);
      const data = zip.subarray(start, start + e.size);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return inflateRawSync(data);
      throw new Error(`zip method ${e.method} is not read: ${name}`);
    }
  };
}
