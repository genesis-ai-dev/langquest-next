// A recording's loudness and the room between its words, read in the
// browser (loudnessModel.ts): a WAV directly, an MP4 or anything else
// through the browser's own decoder.
import { readWavHeader } from './wavModel';
import { loudnessMeter, mono16, type PartSound } from './loudnessModel';

export async function loudnessOfFile(uri: string, _format: 'wav' | 'm4a'): Promise<PartSound | null> {
  const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  const f = readWavHeader(bytes.subarray(0, 44));
  if (f) {
    const samples = mono16(bytes.subarray(44), f.channels);
    const meter = loudnessMeter(f.rate, samples.length);
    meter.add(samples, 1 / 32768);
    return meter.result();
  }
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    const mono = channels.length === 1 ? channels[0]! : Float32Array.from(channels[0]!, (_, i) => channels.reduce((s, c) => s + c[i]!, 0) / channels.length);
    const meter = loudnessMeter(audio.sampleRate, mono.length);
    meter.add(mono);
    return meter.result();
  } finally { void ctx.close(); }
}
