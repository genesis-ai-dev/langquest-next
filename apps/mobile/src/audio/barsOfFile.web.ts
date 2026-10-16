// A recording's bars read in the browser (barsModel.ts): a WAV directly, an
// MP4 or anything else through the browser's own decoder.
import { readWavHeader } from './wavModel';
import { BAR_COUNT, barsFromChannels, barsFromPcm } from './barsModel';

export async function barsOfFile(uri: string, _format: 'wav' | 'm4a'): Promise<number[] | null> {
  const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  const f = readWavHeader(bytes.subarray(0, 44));
  if (f) {
    const frames = Math.floor((bytes.length - 44) / (f.channels * 2));
    return barsFromPcm(new Int16Array(bytes.slice(44, 44 + frames * f.channels * 2).buffer), f.channels, BAR_COUNT);
  }
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
    return barsFromChannels(Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c)), BAR_COUNT);
  } finally { void ctx.close(); }
}
