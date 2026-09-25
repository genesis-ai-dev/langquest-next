// Chrome replays this file as the microphone, looping it. A voiced burst
// long enough to be a real take (above minActiveAudioDuration), then a pause
// longer than the app's default (1000 ms) so each loop ends one take.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWav, SAMPLE_RATE } from '../../apps/mobile/modules/microphone-energy/src/vadCore';

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
