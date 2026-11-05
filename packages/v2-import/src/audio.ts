/**
 * What a v2 audio file is: its format from its first bytes (v2's bucket
 * holds WAV and M4A under any name), and its length from its header. Pure.
 */

export type AudioFormat = 'wav' | 'm4a';

export function formatOf(bytes: Uint8Array): AudioFormat | null {
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (bytes.length >= 8 && ascii(4, 4) === 'ftyp') return 'm4a';
  return null;
}

export function durationMs(bytes: Uint8Array, format: AudioFormat): number {
  return format === 'wav' ? wavDurationMs(bytes) : mp4DurationMs(bytes);
}

/** From the `fmt ` chunk's byte rate and the `data` chunk's size. */
function wavDurationMs(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ' && at + 16 <= bytes.length) byteRate = view.getUint32(at + 16, true);
    if (id === 'data') {
      // A recorder that never went back to write the size leaves 0 or ~0: the rest of the file is the data.
      const data = size === 0 || size === 0xffffffff || at + 8 + size > bytes.length ? bytes.length - at - 8 : size;
      if (!byteRate) throw new Error('WAV has no fmt chunk before its data');
      return Math.round((data / byteRate) * 1000);
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** From the MP4 movie header (mvhd): timescale and duration, version 0 or 1. */
function mp4DurationMs(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 24 <= bytes.length; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x76 || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue; // 'mvhd'
    const version = bytes[i + 4];
    if (version === 0) {
      const timescale = view.getUint32(i + 16);
      return timescale ? Math.round((view.getUint32(i + 20) / timescale) * 1000) : 0;
    }
    if (version === 1 && i + 36 <= bytes.length) {
      const timescale = view.getUint32(i + 24);
      return timescale ? Math.round((Number(view.getBigUint64(i + 28)) / timescale) * 1000) : 0;
    }
  }
  throw new Error('no mvhd box: not an MP4/M4A file');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
