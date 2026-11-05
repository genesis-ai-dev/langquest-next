// The WAV files the microphone module writes (44-byte RIFF header, PCM),
// read and cut by milliseconds: a part is cut from its session chunk where
// its box is when the session is left (LAN-82). Pure: wavCut.ts does the
// reading and writing.

export interface WavFormat { rate: number; channels: number; bits: number }

/** The format a 44-byte header names, or null when it is not a PCM WAV this app writes. */
export function readWavHeader(bytes: Uint8Array): WavFormat | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE' || ascii(12) !== 'fmt ' || ascii(36) !== 'data') return null;
  if (view.getUint16(20, true) !== 1) return null;
  const channels = view.getUint16(22, true), rate = view.getUint32(24, true), bits = view.getUint16(34, true);
  if (channels < 1 || rate < 1 || bits !== 16) return null;
  return { rate, channels, bits };
}

/** A 44-byte header for `dataBytes` of PCM. */
export function wavHeader(dataBytes: number, f: WavFormat): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let k = 0; k < 4; k++) view.setUint8(at + k, text.charCodeAt(k)); };
  const block = f.channels * f.bits / 8;
  ascii(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, f.channels, true);
  view.setUint32(24, f.rate, true); view.setUint32(28, f.rate * block, true);
  view.setUint16(32, block, true); view.setUint16(34, f.bits, true);
  ascii(36, 'data'); view.setUint32(40, dataBytes, true);
  return bytes;
}

/**
 * The bytes of the data (after the header) from `fromMs` to `toMs`, on whole
 * samples, within the `dataBytes` the file holds. The file's own length is
 * what counts, not its header's: a chunk cut short by a crash never had its
 * header finished.
 */
export function wavRange(f: WavFormat, dataBytes: number, fromMs: number, toMs: number): { start: number; length: number } {
  const block = f.channels * f.bits / 8;
  const whole = Math.floor(dataBytes / block);
  const at = (ms: number) => Math.max(0, Math.min(whole, Math.round(ms * f.rate / 1000)));
  const a = at(fromMs), b = Math.max(a, at(toMs));
  return { start: a * block, length: (b - a) * block };
}
