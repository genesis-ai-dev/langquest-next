import { describe, expect, it } from 'vitest';
import { CEILING_DB, LEVEL, levelPart, limiter, LOOKAHEAD_S, needsCopy, nextGain, PASSES } from '../src/audio/levelModel';
import { loudnessMeter, MAX_BOOST_DB, playGainDb, TARGET_LUFS, VOICELESS_DB } from '../src/audio/loudnessModel';

const RATE = 48000;
const CEILING = 10 ** (CEILING_DB / 20);

/** A seeded stream of numbers, so the noise is the same every run. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function tone(seconds: number, peak: number, hz = 220): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => peak * Math.sin((2 * Math.PI * hz * i) / RATE));
}

/** A tone said as words: on for a quarter of a second, off for a quarter, over a little room noise. A steady tone is only room (VOICELESS_DB). */
function words(seconds: number, peak: number, hz = 220): Float32Array {
  const next = random(3);
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    (Math.floor((i / RATE) * 4) % 2 === 0 ? peak * Math.sin((2 * Math.PI * hz * i) / RATE) : 0) + peak * 0.003 * (next() * 2 - 1));
}

/** Speech-like: words that swell and fade, each with a short syllable seven times as loud, over a little room noise. */
function speech(seconds: number, peak: number, seed = 1): Float32Array {
  const next = random(seed);
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const t = i / RATE;
    const word = Math.max(0, Math.sin(Math.PI * t * 1.7)) ** 2;
    const syllable = 1 + 6 * Math.max(0, Math.sin(Math.PI * t * 7)) ** 64;
    return peak * 0.15 * word * syllable * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 540 * t)) + peak * 0.003 * (next() * 2 - 1);
  });
}

/** Through the limiter in blocks of `block`. */
function level(x: Float32Array, gainDb: number, block = 4096): Float32Array {
  const l = limiter(RATE, gainDb);
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length; i += block) parts.push(l.push(x.subarray(i, i + block)));
  parts.push(l.end());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function measure(x: Float32Array) {
  const m = loudnessMeter(RATE, x.length);
  m.add(x);
  return m.measured();
}
const lufs = (x: Float32Array) => measure(x).lufs!;

const peakOf = (x: Float32Array) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);

describe('which parts play from a copy (decision 182)', () => {
  it('copies a part half a decibel or more from −16 LUFS, and plays the rest as they are', () => {
    expect(needsCopy({ lufs: TARGET_LUFS - 0.4, noiseDb: -60 })).toBe(false);
    expect(needsCopy({ lufs: TARGET_LUFS + 0.4, noiseDb: -60 })).toBe(false);
    expect(needsCopy({ lufs: TARGET_LUFS - 0.5, noiseDb: -60 })).toBe(true);
    expect(needsCopy({ lufs: -9, noiseDb: null })).toBe(true);
    expect(needsCopy({ lufs: null, noiseDb: null })).toBe(false);
  });

  it('plays a part that holds only the room as it is (decision 194)', () => {
    expect(needsCopy({ lufs: -50, noiseDb: -52 })).toBe(false);
    expect(needsCopy({ lufs: -50, noiseDb: -60 })).toBe(true);
    // A silence kept as a part: room recorded quietly, far under −16 LUFS, is not turned up.
    const next = random(5);
    expect(levelPart(Float32Array.from({ length: RATE * 2 }, () => 0.002 * (next() * 2 - 1)), RATE).copy).toBeNull();
  });

  it('hands the phones every number they need', () => {
    expect(LEVEL).toMatchObject({ targetLufs: TARGET_LUFS, maxBoostDb: MAX_BOOST_DB, voicelessDb: VOICELESS_DB, ceilingDb: CEILING_DB });
  });
});

describe('a copy at even loudness (decision 182)', () => {
  it('brings a quiet reading to −16 LUFS, its peaks held under −1 dB, however peaky', () => {
    for (const peak of [0.15, 0.4, 0.8]) {
      const x = speech(6, peak, Math.round(peak * 100));
      const { measured, copy } = levelPart(x, RATE);
      expect(measured.lufs!).toBeCloseTo(lufs(x), 6);
      expect(copy!.samples).toHaveLength(x.length);
      expect(peakOf(copy!.samples)).toBeLessThanOrEqual(CEILING + 1e-7);
      expect(Math.abs(lufs(copy!.samples) - TARGET_LUFS)).toBeLessThan(1);
      // Turned up past playGainDb, to make up what the limiter took.
      expect(copy!.gainDb).toBeGreaterThan(playGainDb(measured));
    }
  });

  it('needs one pass for a part with ordinary peaks', () => {
    const x = words(2, 0.04);
    const { measured, copy } = levelPart(x, RATE);
    expect(copy!.gainDb).toBeCloseTo(playGainDb(measured), 9);
    expect(lufs(copy!.samples)).toBeCloseTo(TARGET_LUFS, 1);
  });

  it('makes no copy of a part already at −16 LUFS, or of silence', () => {
    const x = words(2, 0.04);
    const at = level(x, playGainDb(measure(x)) - 0.2);
    expect(levelPart(at, RATE).copy).toBeNull();
    expect(levelPart(new Float32Array(RATE), RATE).copy).toBeNull();
  });

  it('makes a copy again only when it fell short, never past MAX_BOOST_DB, at most PASSES times', () => {
    expect(nextGain(10, TARGET_LUFS - 2, 1)).toBe(12);
    expect(nextGain(10, TARGET_LUFS - 0.4, 1)).toBeNull();
    expect(nextGain(10, TARGET_LUFS + 1, 1)).toBeNull();
    expect(nextGain(MAX_BOOST_DB - 1, TARGET_LUFS - 3, 1)).toBe(MAX_BOOST_DB);
    expect(nextGain(MAX_BOOST_DB, TARGET_LUFS - 3, 1)).toBeNull();
    expect(nextGain(10, TARGET_LUFS - 2, PASSES)).toBeNull();
    expect(nextGain(10, null, 1)).toBeNull();
  });
});

describe('the limiter (decision 182)', () => {
  it('turns a part with room to spare by the gain alone, in step and as long', () => {
    const x = tone(1, 0.05);
    const y = level(x, 12);
    expect(y).toHaveLength(x.length);
    const gain = 10 ** (12 / 20);
    for (let i = 0; i < x.length; i += 997) expect(y[i]!).toBeCloseTo(x[i]! * gain, 5);
  });

  it('turns a loud part down', () => {
    const x = tone(1, 0.9);
    const y = level(x, -6);
    expect(peakOf(y)).toBeCloseTo(0.9 * 10 ** (-6 / 20), 3);
  });

  it('never lets a sample over the ceiling, however far a part is turned up', () => {
    const next = random(7);
    const x = Float32Array.from({ length: RATE * 2 }, () => (next() * 2 - 1) * (next() < 0.01 ? 1 : 0.1));
    for (const gainDb of [6, 12, MAX_BOOST_DB]) expect(peakOf(level(x, gainDb))).toBeLessThanOrEqual(CEILING + 1e-7);
  });

  it('falls short of −16 LUFS where it holds peaks down', () => {
    const x = speech(6, 0.15);
    const gain = playGainDb(measure(x));
    // Turned up whole, its syllables would go over the ceiling.
    expect(peakOf(x) * 10 ** (gain / 20)).toBeGreaterThan(1.4 * CEILING);
    expect(lufs(level(x, gain))).toBeLessThan(TARGET_LUFS - 2);
  });

  it('dips only around a click, and comes back', () => {
    const x = tone(1, 0.02);
    const at = RATE / 2;
    x[at] = 0.9;
    const gainDb = 20, gain = 10 ** (gainDb / 20);
    const y = level(x, gainDb);
    expect(Math.abs(y[at]!)).toBeLessThanOrEqual(CEILING + 1e-7);
    // Well before the click (more than the look ahead) and well after it (several release times), the gain is whole.
    const look = Math.round(RATE * LOOKAHEAD_S);
    for (const i of [at - 2 * look, at - 4 * look, at + RATE * 0.45]) expect(y[i]!).toBeCloseTo(x[i]! * gain, 3);
  });

  it('comes out the same however the samples are handed over', () => {
    const x = speech(2, 0.3);
    const a = level(x, 9, 1000), b = level(x, 9, 7777), c = level(x, 9, x.length);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('gives back as many samples as it took, even fewer than it looks ahead', () => {
    for (const n of [0, 1, 5, 239, 240, 241, 1000]) expect(level(tone(n / RATE, 0.5), 10)).toHaveLength(n);
  });

  it('takes 16-bit samples with a scale', () => {
    const l = limiter(RATE, 0);
    const y = [...l.push(new Int16Array([16384, -16384, 0]), 1 / 32768), ...l.end()];
    expect(y).toEqual([0.5, -0.5, 0]);
  });
});
