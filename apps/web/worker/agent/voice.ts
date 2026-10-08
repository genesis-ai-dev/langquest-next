import type { VoiceNote } from './view';

/**
 * Voice notes from outside the app (a listening app, a review link). Phones
 * play AAC in MP4 or WAV and nothing else, and read only what a file's
 * label says (decision 58), so the bytes are checked here before a name is
 * given to them. A browser that cannot record MP4 sends WAV.
 */

/** A voice note is seconds to a few minutes; WAV is larger than AAC, so the cap allows for it. */
export const MAX_VOICE_NOTE_BYTES = 20 * 1024 * 1024;

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));

/** The format of the bytes and, for WAV, how long it plays; null for anything phones cannot play. */
export function sniffVoiceNote(bytes: Uint8Array): Omit<VoiceNote, 'hash'> | null {
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') return { format: 'm4a', durationMs: 0 };
  if (bytes.length >= 44 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let byteRate = 0;
    // Walk the chunks: "fmt " carries the byte rate, "data" the samples.
    for (let at = 12; at + 8 <= bytes.length;) {
      const id = ascii(bytes, at, 4);
      const size = view.getUint32(at + 4, true);
      if (id === 'fmt ' && at + 20 <= bytes.length) byteRate = view.getUint32(at + 16, true);
      if (id === 'data') return byteRate > 0 ? { format: 'wav', durationMs: Math.round((Math.min(size, bytes.length - at - 8) / byteRate) * 1000) } : null;
      at += 8 + size + (size % 2);
    }
  }
  return null;
}

/** Read a request's body as a voice note, or the reason it is not one. */
export async function readVoiceNote(request: Request): Promise<{ bytes: Uint8Array<ArrayBuffer>; note: Omit<VoiceNote, 'hash'> } | { status: number; error: string }> {
  const length = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isFinite(length)) return { status: 411, error: 'Send Content-Length with the voice note.' };
  if (length > MAX_VOICE_NOTE_BYTES) return { status: 413, error: 'A voice note can be at most 20 MB.' };
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_VOICE_NOTE_BYTES) return { status: 400, error: 'Send the voice note as the body.' };
  const note = sniffVoiceNote(bytes);
  if (!note) return { status: 415, error: 'A voice note must be AAC in MP4 (.m4a) or WAV.' };
  return { bytes, note };
}
