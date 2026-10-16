// The microphone's frames as the native modules see them, for the web
// module: their size, their level, a take's head start, and the WAV a part is
// written as. Where parts split is splitter.ts (LAN-82).

export const SAMPLE_RATE = 44100;
/** Samples per frame: iOS taps 2048 frames; Android's read size is close to it. */
export const FRAME_SAMPLES = 2048;
const FRAME_MS = FRAME_SAMPLES / (SAMPLE_RATE / 1000);
/** Manual startSegment without prerollMs. */
export const DEFAULT_PREROLL_MS = 200;

/** Peak amplitude, clamped to -60..0 dB and returned as a linear 0..1 value. */
export function peakEnergy(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const db = Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(peak, 1e-10))));
  return 10 ** (db / 20);
}

/** How many ring frames a preroll of `ms` covers (native truncates). */
export function prerollFrames(ms: number): number {
  return Math.trunc(ms / FRAME_MS);
}

/** One segment's PCM: preroll plus captured frames, minus the trimmed tail. */
export function assemble(frames: readonly Float32Array[], trimSamples: number): Int16Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Int16Array(Math.max(0, total - trimSamples));
  let i = 0;
  for (const frame of frames) {
    for (const s of frame) {
      if (i >= out.length) return out;
      // iOS float32 conversion: clamp, scale by 32767.
      out[i++] = Math.round(Math.max(-1, Math.min(1, s)) * 32767);
    }
  }
  return out;
}

/** 44-byte RIFF header, mono PCM 16-bit little-endian, as the native writer produces. */
export function encodeWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let k = 0; k < text.length; k++) view.setUint8(at + k, text.charCodeAt(k)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, k) => view.setInt16(44 + k * 2, s, true));
  return bytes;
}
