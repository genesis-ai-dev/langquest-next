import { readWavHeader, wavHeader, wavRange } from './wavModel';

/**
 * The chunk cut last, as the browser holds it. A session's parts are cut
 * from their chunk one after another when the session is left, and each cut
 * read the whole chunk into memory: thirty parts of a five-minute session
 * read its 26 MB thirty times (LAN-156). The chunk is asked for once, and
 * forgotten when it is deleted (`deleteRecorderFile`).
 */
let last: { uri: string; chunk: Blob } | null = null;

/**
 * A new WAV (a blob: URL) holding `fromMs` to `toMs` of the WAV at `uri`
 * (LAN-82: a part cut from its session chunk). As on the phones, the source
 * is left as it is. The part is a slice of the chunk, which the browser
 * keeps for as long as a part of it is held: only the header is read here,
 * and the part's own bytes when the part is (its loudness, its hash).
 */
export async function cutWav(uri: string, fromMs: number, toMs: number): Promise<string> {
  const chunk = last?.uri === uri ? last.chunk : await (await fetch(uri)).blob();
  last = { uri, chunk };
  const format = readWavHeader(new Uint8Array(await chunk.slice(0, 44).arrayBuffer()));
  if (!format) throw new Error('not a recorder WAV');
  const { start, length } = wavRange(format, Math.max(0, chunk.size - 44), fromMs, toMs);
  const blob = new Blob([wavHeader(length, format) as Uint8Array<ArrayBuffer>, chunk.slice(44 + start, 44 + start + length)], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/** A blob the recorder made and no longer needs. */
export function deleteRecorderFile(uri: string): void {
  if (last?.uri === uri) last = null;
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
