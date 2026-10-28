// Clean up on the web (decision 177): DeepFilterNet3 through
// onnxruntime-web, around deepFilter.ts, the arithmetic the phones port
// line for line. The model is served beside the speech model
// (scripts/export-web.mjs) and loads when a part is first cleaned; this file
// is its own chunk, so a visit that never cleans pays nothing. A part's
// sound as recorded and its cleaned sound are kept as 48 kHz floats until
// the app forgets the part; mixes are WAVs, as the web keeps its recordings
// (there is no AAC encoder to hand).
import { addSums, BAR_SLICES, DEEP_FILTER, deepFilter, emptySums, mix, mixGain, pcm16, Resampler, type DeepFilterNet } from './deepFilter';
import { runtime } from './speechModel.web';
import { encodeWav } from './vadCore';

const MODEL = '/models/deepfilter.onnx';

interface Part { x: Float32Array; y: Float32Array; previews: string[] }
const parts = new Map<string, Part>();
/** Parts the app still wants, each with the turn it was asked for; a part forgotten mid-way stops at its next run. */
const live = new Map<string, number>();
let turn = 0;
let net: Promise<DeepFilterNet> | null = null;
/** Parts are cleaned one after another, as on the phones. */
let queue: Promise<unknown> = Promise.resolve();

/** Lets the page draw between stretches of arithmetic. */
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function cleanUp(id: string, uri: string, progress: (done: number) => void): Promise<{ durationMs: number; sums: number[][] }> {
  const mine = ++turn;
  live.set(id, mine);
  const check = () => { if (live.get(id) !== mine) throw new Error('Clean up stopped'); };
  const job = queue.then(async () => {
    check();
    const x = await decode(uri);
    progress(0.1);
    const model = await (net ??= load().catch((e: unknown) => { net = null; throw e; }));
    const y = new Float32Array(x.length);
    let written = 0;
    await deepFilter(
      x.length,
      (at, into) => { into.fill(0); into.set(x.subarray(at, Math.min(x.length, at + into.length))); },
      async (erb, spec, frames) => { check(); return model(erb, spec, frames); },
      (part) => { y.set(part, written); written += part.length; },
      (done) => progress(0.1 + 0.85 * done),
      pause
    );
    check();
    forgetPart(id);
    parts.set(id, { x, y, previews: [] });
    const s = emptySums(BAR_SLICES);
    addSums(s, x, y, 0, y.length);
    progress(1);
    return { durationMs: (x.length * 1000) / DEEP_FILTER.rate, sums: [s.n, s.xx, s.xy, s.yy] };
  });
  queue = job.catch(() => undefined);
  return job;
}

export async function cleanUpMix(id: string, limitDb: number | null, keep: boolean): Promise<{ uri: string; format: 'wav' }> {
  const part = parts.get(id);
  if (!part) throw new Error('Nothing cleaned for this part');
  const wav = encodeWav(pcm16(mix(part.x, part.y, mixGain(limitDb))), DEEP_FILTER.rate) as Uint8Array<ArrayBuffer>;
  const uri = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  // The app keeps a kept mix (BlobStore lets its URL go); a preview replaces the one before last, so the one playing still plays.
  if (!keep) {
    part.previews.push(uri);
    while (part.previews.length > 2) URL.revokeObjectURL(part.previews.shift()!);
  }
  return { uri, format: 'wav' };
}

export function cleanUpForget(id: string): void {
  live.delete(id);
  forgetPart(id);
}

function forgetPart(id: string) {
  for (const uri of parts.get(id)?.previews ?? []) URL.revokeObjectURL(uri);
  parts.delete(id);
}

/** The part's file as 48 kHz mono: a recorder's WAV through deepFilter.ts's resampler, as on the phones; anything else through the browser's decoder. */
async function decode(uri: string): Promise<Float32Array> {
  const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.length >= 44 && ascii(0) === 'RIFF' && ascii(8) === 'WAVE' && ascii(36) === 'data' && view.getUint16(20, true) === 1 && view.getUint16(34, true) === 16) {
    const channels = view.getUint16(22, true), rate = view.getUint32(24, true);
    const frames = Math.floor((bytes.length - 44) / (2 * channels));
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let m = 0;
      for (let c = 0; c < channels; c++) m += view.getInt16(44 + (i * channels + c) * 2, true);
      mono[i] = m / channels / 32768;
    }
    const r = new Resampler(rate, DEEP_FILTER.rate);
    const a = r.push(mono), b = r.end();
    const out = new Float32Array(a.length + b.length);
    out.set(a); out.set(b, a.length);
    return out;
  }
  const ctx = new OfflineAudioContext(1, 1, DEEP_FILTER.rate);
  const audio = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i]! / audio.numberOfChannels;
  }
  return out;
}

async function load(): Promise<DeepFilterNet> {
  // A file the build left out is the page itself (the Worker serves a single-page app).
  const res = await fetch(MODEL);
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error(`${MODEL} is not in this build`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ort = await runtime();
  const session = await ort.InferenceSession.create(bytes);
  return async (erb, spec, frames) => {
    const out = await session.run({
      feat_erb: new ort.Tensor('float32', erb, [1, 1, frames, DEEP_FILTER.erb]),
      feat_spec: new ort.Tensor('float32', spec, [1, 2, frames, DEEP_FILTER.df])
    });
    return { mask: out['erb_mask']!.data, coefs: out['df_coefs']!.data };
  };
}
