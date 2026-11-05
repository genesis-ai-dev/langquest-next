import { readWavHeader, wavHeader, wavRange } from './wavModel';

/**
 * A new WAV (a blob: URL) holding `fromMs` to `toMs` of the WAV at `uri`
 * (LAN-82: a part cut from its session chunk). As on the phones, the source
 * is left as it is.
 */
export async function cutWav(uri: string, fromMs: number, toMs: number): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  const format = readWavHeader(bytes.subarray(0, 44));
  if (!format) throw new Error('not a recorder WAV');
  const { start, length } = wavRange(format, Math.max(0, bytes.length - 44), fromMs, toMs);
  const blob = new Blob([wavHeader(length, format) as Uint8Array<ArrayBuffer>, bytes.slice(44 + start, 44 + start + length)], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/** A blob the recorder made and no longer needs. */
export function deleteRecorderFile(uri: string): void {
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
