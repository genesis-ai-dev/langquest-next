// How loud a part is, and how loud the room is between its words (decision
// 181). Pure, so the web decoding any part measures as this file says; the
// phones' Level.kt and Level.swift follow `loudnessMeter` line for line
// (decision 182), as a phone's JavaScript is too slow for every sample of a
// part. Loudness is ITU-R BS.1770's (K-weighted, gated), the measure of
// Apple Podcasts' −16 LUFS that every part is played at (Caleb, 2026-10-27;
// levelModel.ts); the room is what the quietest of the part's 25 ms slices
// hold. A part whose room, once the part is turned to −16 LUFS, is louder
// than NOISY_DB shows the noise warning.
import { BAR_COUNT, barsFromAmps, packBars, unpackBars } from './barsModel';

/** Every part is played at this loudness (Caleb, 2026-10-27: Apple Podcasts' level). */
export const TARGET_LUFS = -16;
/** A part is turned up by at most this much (decision 182), so a whisper or an empty room is not made as loud as a voice. */
export const MAX_BOOST_DB = 24;
/**
 * A room louder than this, once its part is at TARGET_LUFS, puts the noise
 * warning on the part. A first line from read recordings (decision 181):
 * −45 marked over half of them, too many for "lots of background noise".
 */
export const NOISY_DB = -40;
/**
 * A part whose loudness stands less than this over its room holds no voice
 * to bring up (decision 193): a silence kept as a part, or a voice lost in
 * the room. It plays as recorded, so its hiss is never turned up. Room alone
 * measured 3.5 dB at most (white, pink and brown noise, mains hum, a fan);
 * speech 6 dB over its room, 5.6 dB at least.
 */
export const VOICELESS_DB = 5;

/** The room is read in slices this long: short enough to fall between words. */
const SLICE_S = 0.025;
/** The room is the slice this far up from the quietest: between words, under the voice, and not one odd quiet moment. */
const ROOM_AT = 0.05;
/** A part shorter than this many slices (half a second) has too little room between words to tell. */
const MIN_SLICES = 20;
/** BS.1770's blocks: 400 ms, a new one every 100 ms. */
const STEP_S = 0.1;
const STEPS_PER_BLOCK = 4;
/** BS.1770's gates: blocks quieter than −70 LUFS, then than 10 LU under the rest, are left out. */
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
/** Quieter than anything a 16-bit recording holds. */
const SILENT_DB = -120;

export interface Loudness {
  /** BS.1770's integrated loudness, LUFS; null when nothing in the part reaches −70 LUFS. */
  lufs: number | null;
  /** The loudest sample, dBFS. */
  peakDb: number;
  /** The room between words, dBFS RMS; null for a part too short to tell. */
  noiseDb: number | null;
}

/** A part's measure, and each of its bars' spread (RMS about its own middle), as the phones' modules hand it over. */
export interface Measured extends Loudness { amps: number[] }

/** A part's measure, and its bars drawn with the room in them: `voice` is each bar with the room's share taken out. */
export interface PartSound extends Loudness { bars: number[]; voice: number[] }

type Biquad = { b: [number, number, number]; a: [number, number, number] };

/** The K-weighting's two filters for `rate` (BS.1770, as libebur128 derives them for any rate): a shelf up by 4 dB over about 1.7 kHz, then a cut under about 38 Hz. */
export function kWeighting(rate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const cut: Biquad = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, cut];
}

const dB = (meanSquare: number) => (meanSquare > 0 ? Math.max(SILENT_DB, 10 * Math.log10(meanSquare)) : SILENT_DB);

/**
 * Measures a part as its samples arrive, a block at a time (one channel at
 * `rate`, each sample times `scale` from −1 to 1), so a long part is never
 * held whole. `frames` is how many samples the part has, for its bars.
 */
export function loudnessMeter(rate: number, frames: number, count = BAR_COUNT) {
  const [shelf, cut] = kWeighting(rate);
  const [sb0, sb1, sb2] = shelf.b, [, sa1, sa2] = shelf.a, [, ca1, ca2] = cut.a;
  // The filters' last two inputs and outputs (the cut's inputs are the shelf's outputs).
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
  const step = Math.max(1, Math.round(rate * STEP_S));
  const steps: number[] = [];
  let stepSum = 0, stepN = 0;
  const slice = Math.max(1, Math.round(rate * SLICE_S));
  const rooms: number[] = [];
  let sliceSum = 0, sliceSq = 0, sliceN = 0;
  let peak = 0;
  const per = Math.max(1, frames / count);
  const barSum = new Float64Array(count), barSq = new Float64Array(count), barN = new Float64Array(count);
  // The bar being filled, and the sample it ends before (barsBuilder's slices).
  let bar = 0, barEnd = Math.ceil(per), at = 0;
  let bSum = 0, bSq = 0, bN = 0;
  const closeBar = () => {
    barSum[bar]! += bSum; barSq[bar]! += bSq; barN[bar]! += bN;
    bSum = 0; bSq = 0; bN = 0;
  };
  return {
    add(chunk: ArrayLike<number>, scale = 1) {
      const n = chunk.length;
      for (let i = 0; i < n; i++) {
        const x = chunk[i]! * scale;
        // K-weighted, for the loudness: the shelf, then the cut (whose b is 1, −2, 1).
        const y = sb0 * x + sb1 * x1 + sb2 * x2 - sa1 * y1 - sa2 * y2;
        const z = y - 2 * y1 + y2 - ca1 * z1 - ca2 * z2;
        x2 = x1; x1 = x; y2 = y1; y1 = y; z2 = z1; z1 = z;
        stepSum += z * z;
        if (++stepN === step) { steps.push(stepSum / step); stepSum = 0; stepN = 0; }
        // As recorded, for the room and the bars: each slice's spread about its own middle, so an offset is not taken for noise.
        const xx = x * x;
        sliceSum += x; sliceSq += xx;
        if (++sliceN === slice) { rooms.push(Math.max(0, sliceSq / slice - (sliceSum / slice) ** 2)); sliceSum = 0; sliceSq = 0; sliceN = 0; }
        if (at === barEnd && bar < count - 1) { closeBar(); bar++; barEnd = Math.ceil((bar + 1) * per); }
        bSum += x; bSq += xx; bN++;
        at++;
        const m = x < 0 ? -x : x;
        if (m > peak) peak = m;
      }
    },
    /** What was heard, once every sample has been added. */
    measured(): Measured {
      closeBar();
      const blocks: number[] = [];
      for (let j = 0; j + STEPS_PER_BLOCK <= steps.length; j++) {
        let sum = 0;
        for (let i = j; i < j + STEPS_PER_BLOCK; i++) sum += steps[i]!;
        blocks.push(sum / STEPS_PER_BLOCK);
      }
      // A part shorter than a block is one block.
      if (blocks.length === 0 && at > 0) blocks.push((steps.reduce((s, v) => s + v * step, 0) + stepSum) / at);
      return {
        lufs: gatedLoudness(blocks),
        peakDb: peak > 0 ? Math.max(SILENT_DB, 20 * Math.log10(peak)) : SILENT_DB,
        noiseDb: roomDb(rooms),
        amps: Array.from(barSq, (sq, k) => (barN[k]! > 0 ? Math.sqrt(Math.max(0, sq / barN[k]! - (barSum[k]! / barN[k]!) ** 2)) : 0))
      };
    },
    result(): PartSound {
      return soundOf(this.measured());
    }
  };
}

/** A part's measure with its bars drawn (barsModel.ts), the room's share taken out of each for `voice`. */
export function soundOf(m: Measured): PartSound {
  // The room is read at the quiet end of its slices: a bar of room alone runs up to about 3 dB over it, so a bar takes out twice its power.
  const room = m.noiseDb === null ? 0 : 10 ** (m.noiseDb / 20) * Math.SQRT2;
  return {
    lufs: m.lufs,
    peakDb: m.peakDb,
    noiseDb: m.noiseDb,
    bars: barsFromAmps(m.amps),
    voice: barsFromAmps(m.amps.map((a) => Math.sqrt(Math.max(0, a * a - room * room))), m.amps)
  };
}

/** BS.1770's integrated loudness of blocks' K-weighted mean squares: null when none reaches the absolute gate. */
export function gatedLoudness(blocks: readonly number[]): number | null {
  const loud = (ms: number) => -0.691 + 10 * Math.log10(ms);
  const above = blocks.filter((ms) => ms > 0 && loud(ms) > ABSOLUTE_GATE);
  if (above.length === 0) return null;
  const line = loud(above.reduce((s, v) => s + v, 0) / above.length) + RELATIVE_GATE;
  const kept = above.filter((ms) => loud(ms) > line);
  return loud(kept.reduce((s, v) => s + v, 0) / kept.length);
}

/** The room between words, dBFS: the slice ROOM_AT up from the quietest of the slices' mean squares; null with too few. */
export function roomDb(slices: readonly number[]): number | null {
  if (slices.length < MIN_SLICES) return null;
  const sorted = [...slices].sort((a, b) => a - b);
  return dB(sorted[Math.floor(ROOM_AT * (sorted.length - 1))]!);
}

/**
 * How much a part is turned up (or down) to play at TARGET_LUFS (decision
 * 182): never up by more than MAX_BOOST_DB, and not at all when nothing in
 * it is loud enough to measure or it holds only the room (VOICELESS_DB).
 */
export function playGainDb(m: Pick<Loudness, 'lufs' | 'noiseDb'>): number {
  if (m.lufs === null || (m.noiseDb !== null && m.lufs - m.noiseDb < VOICELESS_DB)) return 0;
  return Math.min(MAX_BOOST_DB, TARGET_LUFS - m.lufs);
}

/** How loud the room between words is as the part plays (playGainDb); null when either is unknown. */
export function roomAsPlayed(m: Loudness): number | null {
  return m.lufs === null || m.noiseDb === null ? null : m.noiseDb + playGainDb(m);
}

/** Whether a part shows the noise warning: its room, as it plays, over NOISY_DB. */
export function isNoisy(m: Loudness): boolean {
  const room = roomAsPlayed(m);
  return room !== null && room > NOISY_DB;
}

/** One channel of 16-bit PCM bytes (`channels` interleaved, averaged), for loudnessMeter with a scale of 1/32768. */
export function mono16(bytes: Uint8Array, channels: number): Int16Array {
  const frames = Math.floor(bytes.length / (2 * channels));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Int16Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += view.getInt16((f * channels + c) * 2, true);
    out[f] = Math.round(sum / channels);
  }
  return out;
}

const tenth = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** A part's measure as text to keep on this device. */
export function packSound(s: PartSound): string {
  return JSON.stringify({ l: tenth(s.lufs), p: tenth(s.peakDb), n: tenth(s.noiseDb), b: packBars(s.bars), v: packBars(s.voice) });
}

/** A measure kept by `packSound`, or null when the text is not one. */
export function unpackSound(text: string | null | undefined): PartSound | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as { l?: unknown; p?: unknown; n?: unknown; b?: unknown; v?: unknown };
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const bars = unpackBars(typeof o.b === 'string' ? o.b : null), voice = unpackBars(typeof o.v === 'string' ? o.v : null);
    const peakDb = num(o.p);
    if (!bars || !voice || peakDb === null) return null;
    return { lufs: num(o.l), peakDb, noiseDb: num(o.n), bars, voice };
  } catch { return null; }
}
