import type { BlobRef } from '@langquest-next/core';

/**
 * What a recording is stored as (decisions.md 58). Every device must play
 * what any other recorded, and a phone's player reads only what the label
 * says, so the label must match the bytes. Phones record AAC in MP4
 * (`m4a`) or WAV. A browser records what its MediaRecorder can: Safari
 * gives MP4, Chrome and Firefox give WebM with Opus, which iPhones do not
 * play. So a browser asks for MP4 when it can, and anything else is decoded
 * and stored as WAV. `BlobRef['format']` stays `wav | m4a`.
 */

/** The MediaRecorder type to ask for, best first; undefined lets the browser choose. */
export const WEB_RECORDING_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'] as const;

export function preferredRecordingType(isTypeSupported: (type: string) => boolean): string | undefined {
  return WEB_RECORDING_TYPES.find((t) => isTypeSupported(t));
}

/** The stored format for a recording's MIME type, or null when it must be converted first. */
export function storedFormatOf(mime: string): BlobRef['format'] | null {
  const type = mime.toLowerCase().split(';')[0]!.trim();
  if (type === 'audio/mp4' || type === 'audio/x-m4a' || type === 'audio/aac') return 'm4a';
  if (type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') return 'wav';
  return null;
}

/** Mix channels down to one and quantize to 16-bit, as the voice-detection recorder writes WAV. */
export function toMono16(channels: Float32Array[]): Int16Array {
  const length = channels[0]?.length ?? 0;
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const c of channels) sum += c[i] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / channels.length));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}
