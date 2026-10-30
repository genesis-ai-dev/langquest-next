// Every recording plays at even loudness (decision 182): turned up or down
// to TARGET_LUFS by playGainDb (loudnessModel.ts), its peaks held at
// CEILING_DB by a limiter that looks a few milliseconds ahead. The recording
// itself never changes: the phone or the browser plays a copy made from it
// (levelStore.ts). Pure, so the web runs this file; the phones' Level.kt and
// Level.swift follow `limiter` line for line, as a phone's JavaScript is too
// slow for every sample of a part. test/levelModel.test.ts holds this one,
// and the Kotlin is checked against it.
//
// The limiter: each sample asks for the most gain that keeps it under the
// ceiling. The gain used at a sample is the least asked for over the next
// LOOKAHEAD_S, then eased back up over RELEASE_S, then averaged over the
// last LOOKAHEAD_S. A peak's ask is in every average that reaches it, so no
// sample goes over the ceiling, and the gain bends down over 5 ms instead
// of stepping, which would click.
//
// Holding the peaks down takes some loudness with them: a reading whose
// syllables stand 20 dB over its loudness came out 2.7 dB short of −16 LUFS.
// So the copy is measured as it is made, and made again turned up by what
// it fell short (nextGain), at most PASSES times in all; that reading ends
// within 1 dB of it (Apple Podcasts asks for ±1 dB), and one with ordinary
// peaks needs a single pass.
import { loudnessMeter, MAX_BOOST_DB, playGainDb, TARGET_LUFS, VOICELESS_DB, type Loudness, type Measured } from './loudnessModel';

/** No sample plays louder than this, dBFS (Apple Podcasts' and the options doc's −1 dB). */
export const CEILING_DB = -1;
/** A part this close to TARGET_LUFS plays as it is, with no copy: half a decibel is too little to hear. */
export const MIN_CHANGE_DB = 0.5;
/** How far the limiter looks ahead, and how long it takes to bend the gain down. */
export const LOOKAHEAD_S = 0.005;
/** How long the gain takes to come most of the way back after a peak. */
export const RELEASE_S = 0.1;
/** A copy is made at most this many times over, each turned up by what the last fell short. */
export const PASSES = 3;

/** What the phones' modules are told (MicrophoneEnergy.level), so this file keeps every number. */
export const LEVEL = {
  targetLufs: TARGET_LUFS,
  maxBoostDb: MAX_BOOST_DB,
  voicelessDb: VOICELESS_DB,
  minChangeDb: MIN_CHANGE_DB,
  ceilingDb: CEILING_DB,
  lookaheadS: LOOKAHEAD_S,
  releaseS: RELEASE_S,
  passes: PASSES
};

/** Whether a part plays from a copy: turned by MIN_CHANGE_DB or more. */
export function needsCopy(m: Pick<Loudness, 'lufs' | 'noiseDb'>): boolean {
  return Math.abs(playGainDb(m)) >= MIN_CHANGE_DB;
}

/**
 * After pass `pass` (from 1) turned a copy by `gainDb` and it came out at
 * `outLufs`: the gain to make it again with, or null to keep it. Only a
 * copy that fell MIN_CHANGE_DB or more short is made again, never turned
 * up past MAX_BOOST_DB.
 */
export function nextGain(gainDb: number, outLufs: number | null, pass: number): number | null {
  if (outLufs === null || pass >= PASSES) return null;
  const next = Math.min(MAX_BOOST_DB, gainDb + (TARGET_LUFS - outLufs));
  return TARGET_LUFS - outLufs >= MIN_CHANGE_DB && next > gainDb ? next : null;
}

/** A part's measure and, when it needs one, its copy: the samples to play and the gain they were made with. */
export interface Levelled { measured: Measured; copy: { samples: Float32Array; gainDb: number } | null }

/**
 * A part held whole (the web decodes it whole), measured and, when it
 * needs one, its copy made, `block` samples at a time: the steps yield
 * between blocks, so a caller can let the screen draw (levelPart runs them
 * straight through).
 */
export function* levelSteps(x: Float32Array, rate: number, block = rate): Generator<void, Levelled> {
  const meter = loudnessMeter(rate, x.length);
  for (let at = 0; at < x.length; at += block) { meter.add(x.subarray(at, at + block)); yield; }
  const measured = meter.measured();
  if (!needsCopy(measured)) return { measured, copy: null };
  let gainDb: number | null = playGainDb(measured);
  let copy = { samples: x, gainDb };
  for (let pass = 1; gainDb !== null; pass++) {
    const l = limiter(rate, gainDb);
    const out = loudnessMeter(rate, x.length);
    const samples = new Float32Array(x.length);
    let made = 0;
    const put = (y: Float32Array) => { out.add(y); samples.set(y, made); made += y.length; };
    for (let at = 0; at < x.length; at += block) { put(l.push(x.subarray(at, at + block))); yield; }
    put(l.end());
    copy = { samples, gainDb };
    gainDb = nextGain(gainDb, out.measured().lufs, pass);
  }
  return { measured, copy };
}

/** levelSteps straight through. */
export function levelPart(x: Float32Array, rate: number): Levelled {
  const steps = levelSteps(x, rate);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * Turns one channel at `rate` by `gainDb`, holding every sample at or under
 * `ceilingDb`, as its samples arrive a block at a time (`push`, each sample
 * times `scale`), so a long part is never held whole. What comes out runs
 * LOOKAHEAD_S behind what goes in; `end` gives the rest, so the samples out
 * are as many as the samples in.
 */
export function limiter(rate: number, gainDb: number, ceilingDb = CEILING_DB, lookaheadS = LOOKAHEAD_S, releaseS = RELEASE_S) {
  const gain = 10 ** (gainDb / 20), ceiling = 10 ** (ceilingDb / 20);
  const look = Math.max(1, Math.round(rate * lookaheadS));
  const ease = 1 - Math.exp(-1 / Math.max(1, rate * releaseS));
  // The last `look` samples in, by their place modulo `look`.
  const held = new Float64Array(look);
  // The least gain asked for over the window: places and asks, rising from the front (a ring of `look`).
  const places = new Float64Array(look), asks = new Float64Array(look);
  let front = 0, count = 0;
  // The last `look` eased gains, and their sum.
  const eased = new Float64Array(look);
  let sum = 0;
  let last = gain;
  // Samples taken in, the `look - 1` silent ones before the first included.
  let taken = 0;
  let out: number[] = [];

  const take = (x: number) => {
    const i = taken++;
    held[i % look] = x;
    const m = x < 0 ? -x : x;
    const ask = m * gain > ceiling ? ceiling / m : gain;
    if (count > 0 && places[front]! <= i - look) { front = (front + 1) % look; count--; }
    while (count > 0 && asks[(front + count - 1) % look]! >= ask) count--;
    places[(front + count) % look] = i;
    asks[(front + count) % look] = ask;
    count++;
    const j = i - look + 1;
    if (j < 0) return;
    const r = Math.min(asks[front]!, last + (gain - last) * ease);
    last = r;
    sum += r - eased[j % look]!;
    eased[j % look] = r;
    // The first `look - 1` are the silence before the part.
    if (j < look - 1) return;
    const y = held[j % look]! * (sum / look);
    out.push(y > ceiling ? ceiling : y < -ceiling ? -ceiling : y);
  };
  for (let k = 0; k < look - 1; k++) take(0);

  const flush = () => { const done = Float32Array.from(out); out = []; return done; };
  return {
    push(chunk: ArrayLike<number>, scale = 1): Float32Array {
      for (let k = 0; k < chunk.length; k++) take(chunk[k]! * scale);
      return flush();
    },
    end(): Float32Array {
      for (let k = 0; k < look - 1; k++) take(0);
      return flush();
    }
  };
}
