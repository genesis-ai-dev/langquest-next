// A part's sound as bars (audio/barsModel.ts): even slices up to the part's
// loudest, fitted to a row, and kept as short text.
import { describe, expect, it } from 'vitest';
import { barsFromWindows, barsFromChannels, barsFromLevels, barsFromPcm, fitBars, packBars, unpackBars } from '../src/audio/barsModel';

const tone = (n: number, amp: number) => Int16Array.from({ length: n }, (_, k) => Math.round(Math.sin(k / 5) * amp * 32767));

describe('a part\'s bars', () => {
  it('silence is the lowest bar, a steady voice the highest, and a part quiet all through stays low', () => {
    expect(barsFromPcm(new Int16Array(4410), 1, 8)).toEqual(Array(8).fill(0));
    for (const b of barsFromPcm(tone(4410, 0.7), 1, 8)) expect(b).toBeGreaterThan(0.95);
    for (const b of barsFromPcm(tone(4410, 0.01), 1, 8)) expect(b).toBeLessThan(0.4);
  });
  it('speech rising and falling shows as taller and shorter bars', () => {
    const pcm = new Int16Array(6000);
    pcm.set(tone(2000, 0.5), 0);
    pcm.set(tone(2000, 0.15), 2000);
    pcm.set(tone(2000, 0.5), 4000);
    const [a, b, c] = barsFromPcm(pcm, 1, 3);
    expect(a).toBeCloseTo(1, 1);
    expect(c).toBeCloseTo(1, 1);
    expect(b!).toBeLessThan(0.5);
    expect(b!).toBeGreaterThan(0.3);
  });
  it('shows where a part is loud and where it is quiet, in order', () => {
    const pcm = new Int16Array(8000);
    pcm.set(tone(4000, 0.5), 4000);
    const bars = barsFromPcm(pcm, 1, 4);
    expect(bars[0]).toBe(0);
    expect(bars[1]).toBe(0);
    expect(bars[2]).toBeGreaterThan(0.5);
    expect(bars[3]).toBeGreaterThan(0.5);
  });
  it('mixes channels to one, and reads the web decoder\'s floats the same as PCM', () => {
    const left = Float32Array.from(tone(2000, 0.4), (v) => v / 32768);
    const fromFloats = barsFromChannels([left, left], 4);
    const stereo = new Int16Array(4000);
    tone(2000, 0.4).forEach((v, k) => { stereo[2 * k] = v; stereo[2 * k + 1] = v; });
    const fromPcm = barsFromPcm(stereo, 2, 4);
    fromFloats.forEach((b, k) => expect(b).toBeCloseTo(fromPcm[k]!, 2));
  });
  it('fits to the room a row has: the loudest of each group, or repeated when there is more room than bars', () => {
    expect(fitBars([0.1, 0.9, 0.2, 0.4], 2)).toEqual([0.9, 0.4]);
    expect(fitBars([0.1, 0.9], 4)).toEqual([0.1, 0.1, 0.9, 0.9]);
    expect(fitBars([0.5], 0)).toEqual([]);
    expect(fitBars([], 3)).toEqual([]);
  });
  it('keeps as one character a bar, and refuses text that is not that', () => {
    const bars = [0, 0.5, 1];
    const text = packBars(bars);
    expect(text).toHaveLength(3);
    unpackBars(text)!.forEach((b, k) => expect(b).toBeCloseTo(bars[k]!, 1));
    expect(unpackBars('')).toBeNull();
    expect(unpackBars('xyz!')).toBeNull();
    expect(unpackBars(null)).toBeNull();
  });

  it('comes from the levels the recording screen showed, without the file', () => {
    // 128 frames (about 6 s): loud, then soft, then loud again.
    const db = [...Array(43).fill(-12), ...Array(42).fill(-30), ...Array(43).fill(-12)];
    const bars = barsFromLevels(db)!;
    expect(bars).toHaveLength(64);
    expect(bars[0]).toBeCloseTo(1, 2);
    expect(bars[32]!).toBeLessThan(0.3);
    expect(bars[63]).toBeCloseTo(1, 2);
    // A part quiet all through stays low, as one read from its file does.
    for (const b of barsFromLevels(Array(100).fill(-45))!) expect(b).toBeLessThan(0.4);
  });

  it('gives a short part a bar a frame, and a part with no frames none', () => {
    const bars = barsFromLevels([-20, -40, -20])!;
    expect(bars).toHaveLength(3);
    expect(bars[1]!).toBeLessThan(bars[0]!);
    expect(fitBars(bars, 6)).toHaveLength(6);
    expect(barsFromLevels([])).toBeNull();
  });
});

describe('bars sampled from windows of a file', () => {
  // Speech-like: a voiced stretch that swells and falls, with a gap, 30 s at 16 kHz, stereo.
  const frames = 16000 * 30;
  const channels = 2;
  const pcm = new Int16Array(frames * channels);
  for (let f = 0; f < frames; f++) {
    const t = f / 16000;
    const env = Math.max(0, Math.sin(t * 2.1)) * (0.3 + 0.5 * Math.abs(Math.sin(t * 0.7)));
    const v = Math.round(env * 32767 * Math.sin(f / 7) * (0.7 + 0.3 * Math.sin(f / 311)));
    pcm[f * 2] = v;
    pcm[f * 2 + 1] = v;
  }
  const bytes = new Uint8Array(pcm.buffer);
  const frameBytes = channels * 2;

  it('matches reading every sample, to a small tolerance, from a few thousand samples', async () => {
    let read = 0, pauses = 0;
    const got = await barsFromWindows(frames, channels, (first, n) => { read += n; return bytes.subarray(first * frameBytes, (first + n) * frameBytes); }, async () => { pauses++; }, 64);
    const want = barsFromPcm(pcm, channels, 64);
    expect(got).toHaveLength(64);
    got.forEach((b, k) => expect(Math.abs(b - want[k]!)).toBeLessThan(0.08));
    expect(read).toBeLessThan(64 * 600);
    expect(pauses).toBeGreaterThanOrEqual(8);
  });

  it('reads a short file whole, so it is exact, and never past the end', async () => {
    const short = pcm.subarray(0, 1000 * channels);
    const b = new Uint8Array(short.buffer, short.byteOffset, short.byteLength);
    const got = await barsFromWindows(1000, channels, (first, n) => {
      expect((first + n) * frameBytes).toBeLessThanOrEqual(b.length);
      return b.subarray(first * frameBytes, (first + n) * frameBytes);
    }, async () => undefined, 64);
    const want = barsFromPcm(short, channels, 64);
    got.forEach((x, k) => expect(x).toBeCloseTo(want[k]!, 6));
  });
});
