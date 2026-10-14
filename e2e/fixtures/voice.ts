// Chrome replays this file as the microphone, looping it. A voiced burst
// long enough to be a real take (above minActiveAudioDuration), then a pause
// longer than the app's default (1000 ms) so each loop ends one take.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;

/** 16-bit mono PCM as a WAV file. */
function encodeWav(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let k = 0; k < text.length; k++) view.setUint8(at + k, text.charCodeAt(k)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, k) => view.setInt16(44 + k * 2, s, true));
  return bytes;
}

export const VOICE_WAV = path.join(path.dirname(fileURLToPath(import.meta.url)), 'voice.wav');

export function writeVoice(): string {
  const segments: [seconds: number, voiced: boolean][] = [[1.5, true], [2.5, false]];
  const total = segments.reduce((n, [s]) => n + Math.round(s * SAMPLE_RATE), 0);
  const pcm = new Int16Array(total);
  let i = 0;
  for (const [seconds, voiced] of segments) {
    for (let k = 0; k < Math.round(seconds * SAMPLE_RATE); k++, i++) {
      if (!voiced) continue;
      const t = k / SAMPLE_RATE;
      // 180 Hz carrier, syllable-rate (4 Hz) envelope between 0.3 and 0.6: always above the 0.1 cutoff.
      const envelope = 0.45 + 0.15 * Math.sin(2 * Math.PI * 4 * t);
      pcm[i] = Math.round(envelope * Math.sin(2 * Math.PI * 180 * t) * 32767);
    }
  }
  mkdirSync(path.dirname(VOICE_WAV), { recursive: true });
  writeFileSync(VOICE_WAV, encodeWav(pcm));
  return VOICE_WAV;
}
