// Reading a zip of USFM files in the browser (LAN-229): the list of files in
// the zip's own table, each stored or deflated. The inflate step is given by
// the caller (the browser's DecompressionStream), so this stays pure and a
// test can run it in Node.

export interface ZipFile { name: string; bytes: Uint8Array }
export type Inflate = (raw: Uint8Array) => Promise<Uint8Array>;

/** Most files and bytes one zip may open to: a whole Bible is 66 files and a few MB. */
export const ZIP_MAX_FILES = 300;
export const ZIP_MAX_BYTES = 60 * 1024 * 1024;

export class ZipError extends Error {
  constructor(readonly reason: 'notZip' | 'tooMany' | 'tooBig' | 'unsupported') { super(reason); }
}

const u16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** Every file in a zip, in the order its table lists them. Folders, hidden Mac files and `__MACOSX` are left out. */
export async function readZip(bytes: Uint8Array, inflate: Inflate): Promise<ZipFile[]> {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new ZipError('notZip');
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const out: ZipFile[] = [];
  let total = 0;
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) throw new ZipError('notZip');
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    const size = u32(bytes, at + 20);
    const rawSize = u32(bytes, at + 24);
    const nameLen = u16(bytes, at + 28);
    const extraLen = u16(bytes, at + 30);
    const commentLen = u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').pop()!.startsWith('.')) continue;
    if (flags & 1) throw new ZipError('unsupported');
    if (out.length >= ZIP_MAX_FILES) throw new ZipError('tooMany');
    total += rawSize;
    if (total > ZIP_MAX_BYTES) throw new ZipError('tooBig');
    if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) throw new ZipError('notZip');
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) out.push({ name, bytes: raw });
    else if (method === 8) out.push({ name, bytes: await inflate(raw) });
    else throw new ZipError('unsupported');
  }
  return out;
}
