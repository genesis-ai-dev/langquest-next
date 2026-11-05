// A recording decoded whole in the browser, as one channel: a 16-bit WAV
// read as it is, anything else (a phone's AAC) through the browser's own
// decoder. The web's measure (loudnessOfFile.web.ts) and its copies at even
// loudness (levelCopy.web.ts) start here.
import { readWavHeader } from './wavModel';
import { mono16 } from './loudnessModel';

/** The recording at `uri` as samples from −1 to 1 at `rate`; null where the browser has no decoder. */
export async function decodeWhole(uri: string): Promise<{ rate: number; samples: Float32Array } | null> {
  const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  const f = readWavHeader(bytes.subarray(0, 44));
  if (f) return { rate: f.rate, samples: Float32Array.from(mono16(bytes.subarray(44), f.channels), (v) => v / 32768) };
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    const samples = channels.length === 1 ? channels[0]! : Float32Array.from(channels[0]!, (_, i) => channels.reduce((s, c) => s + c[i]!, 0) / channels.length);
    return { rate: audio.sampleRate, samples };
  } finally { void ctx.close(); }
}
