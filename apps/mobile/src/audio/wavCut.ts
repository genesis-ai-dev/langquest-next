import * as Crypto from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { readWavHeader, wavHeader, wavRange } from './wavModel';

/** Where the microphone module stages what it records (both phones), so a cut part survives a restart as a take does. */
const STAGING = new Directory(Paths.document, 'recording-staging');
/** Copied a block at a time, so a long part never sits in memory whole. */
const BLOCK = 1 << 20;

/**
 * A new WAV in staging holding `fromMs` to `toMs` of the WAV at `uri`
 * (LAN-82: a part cut from its session chunk). The source is left as it is.
 */
export async function cutWav(uri: string, fromMs: number, toMs: number): Promise<string> {
  const src = new File(uri);
  const total = src.size ?? 0;
  const read = src.open(FileMode.ReadOnly);
  try {
    const format = readWavHeader(read.readBytes(44));
    if (!format) throw new Error('not a recorder WAV');
    const { start, length } = wavRange(format, Math.max(0, total - 44), fromMs, toMs);
    if (!STAGING.exists) STAGING.create({ intermediates: true, idempotent: true });
    const out = new File(STAGING, `part_${Crypto.randomUUID()}.wav`);
    out.create();
    const write = out.open(FileMode.WriteOnly);
    try {
      write.writeBytes(wavHeader(length, format));
      read.offset = 44 + start;
      for (let left = length; left > 0;) {
        const bytes = read.readBytes(Math.min(left, BLOCK));
        if (bytes.length === 0) break;
        write.writeBytes(bytes);
        left -= bytes.length;
      }
    } finally { write.close(); }
    return out.uri;
  } finally { read.close(); }
}

/** A file the recorder made and no longer needs (a chunk once its parts are cut, a part heard and let go). */
export function deleteRecorderFile(uri: string): void {
  const f = new File(uri);
  if (f.exists) f.delete();
}
