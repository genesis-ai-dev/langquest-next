import type { BlobRef } from '@langquest-next/core';
import { encodeWav } from '../modules/microphone-energy/src/vadCore';
import { storedFormatOf, toMono16 } from './audioFormat';

/**
 * Web only: a finished recording (a blob: URL) as something every device
 * plays (audioFormat.ts). MP4 or WAV pass through; anything else is decoded
 * by the browser and written as 16-bit mono WAV at its own sample rate.
 */
export async function storableRecording(uri: string): Promise<{ uri: string; format: BlobRef['format'] }> {
  const blob = await (await fetch(uri)).blob();
  const kept = storedFormatOf(blob.type);
  if (kept) return { uri, format: kept };
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const wav = encodeWav(toMono16(channels), audio.sampleRate);
    URL.revokeObjectURL(uri);
    return { uri: URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' })), format: 'wav' };
  } finally {
    void context.close();
  }
}
