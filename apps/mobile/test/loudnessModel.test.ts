import { gatedLoudness, isNoisy, kWeighting, loudnessMeter, mono16, NOISY_DB, packSound, roomAtTarget, roomDb, TARGET_LUFS, unpackSound } from '../src/audio/loudnessModel';

const RATE = 44100;

/** A seeded stream of numbers, so the noise is the same every run. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** White noise with an RMS of `db` dBFS (uniform, so its peak stays inside −1..1). */
function noise(seconds: number, db: number, seed = 1): Float32Array {
  const next = random(seed), a = 10 ** (db / 20) * Math.sqrt(3);
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => (next() * 2 - 1) * a);
}

function tone(seconds: number, peak: number, hz = 997): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => peak * Math.sin((2 * Math.PI * hz * i) / RATE));
}

const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const plus = (a: Float32Array, b: Float32Array) => Float32Array.from(a, (v, i) => v + (b[i] ?? 0));

function measure(x: Float32Array, block = 4096) {
  const m = loudnessMeter(RATE, x.length);
  for (let i = 0; i < x.length; i += block) m.add(x.subarray(i, i + block));
  return m.result();
}

/** Words: a second of voice-like tone, then a short pause, four times, with a breath before and after. */
function speech(peak: number) {
  const word = () => join(tone(0.8, peak, 220), tone(0.2, peak * 0.5, 440));
  const gap = () => new Float32Array(Math.round(0.25 * RATE));
  return join(gap(), word(), gap(), word(), gap(), word(), gap(), word(), gap());
}

describe('loudness (BS.1770, decision 180)', () => {
  it('K-weights with the standard filters at 48 kHz', () => {
    const [shelf, cut] = kWeighting(48000);
    const near = (got: number[], want: number[]) => got.forEach((g, i) => expect(g).toBeCloseTo(want[i]!, 6));
    near(shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
    near(shelf.a, [1, -1.69065929318241, 0.73248077421585]);
    near(cut.b, [1, -2, 1]);
    near(cut.a, [1, -1.99004745483398, 0.99007225036621]);
  });

  it('reads a 997 Hz tone at its own level, 3 dB under its peak', () => {
    const r = measure(tone(3, 0.1));
    expect(r.lufs!).toBeCloseTo(-23.01, 1);
    expect(r.peakDb).toBeCloseTo(-20, 1);
  });

  it('leaves silence out of the loudness, so pauses do not lower it', () => {
    // Half silence would read 3 dB lower as a plain average; the gates leave out all but the blocks where the tone stops.
    const alone = measure(tone(3, 0.1)).lufs!;
    expect(Math.abs(measure(join(tone(3, 0.1), new Float32Array(RATE * 3))).lufs! - alone)).toBeLessThan(0.3);
  });

  it('gives no loudness for silence, and one block for a part shorter than a block', () => {
    expect(measure(new Float32Array(RATE)).lufs).toBeNull();
    expect(gatedLoudness([])).toBeNull();
    expect(measure(tone(0.3, 0.1)).lufs!).toBeCloseTo(-23, 0);
  });

  it('comes out the same however the samples are handed over', () => {
    const x = plus(speech(0.3), noise(5, -50));
    expect(measure(x, 1000)).toEqual(measure(x, 7777));
  });
});

describe('the room between words (decision 180)', () => {
  it('hears the noise under the voice, not the voice', () => {
    const x = speech(0.3);
    const r = measure(plus(x, noise(x.length / RATE, -50)));
    expect(r.noiseDb!).toBeGreaterThan(-52);
    expect(r.noiseDb!).toBeLessThan(-48);
  });

  it('does not take an offset for noise', () => {
    const x = speech(0.3).map((v) => v + 0.01);
    expect(measure(x).noiseDb!).toBeLessThan(-100);
  });

  it('needs half a second to tell', () => {
    expect(measure(noise(0.4, -40)).noiseDb).toBeNull();
    expect(roomDb([1, 2, 3])).toBeNull();
    expect(measure(noise(0.6, -40)).noiseDb).not.toBeNull();
  });

  it('draws each bar with the room taken out of its voice', () => {
    const x = speech(0.3);
    const r = measure(plus(x, noise(x.length / RATE, -35)));
    r.bars.forEach((b, k) => expect(r.voice[k]!).toBeLessThanOrEqual(b + 1e-9));
    // The first bar is the breath before the first word: room only.
    expect(r.voice[0]!).toBeLessThan(0.2 * r.bars[0]!);
    expect(Math.max(...r.voice)).toBeGreaterThan(0.9);
  });
});

describe('the noise warning (decision 180)', () => {
  it('weighs the room as it would sound with the part at −16 LUFS', () => {
    expect(roomAtTarget({ lufs: -26, peakDb: -6, noiseDb: -60 })).toBe(-60 + (TARGET_LUFS + 26));
    expect(roomAtTarget({ lufs: null, peakDb: -90, noiseDb: -95 })).toBeNull();
    expect(roomAtTarget({ lufs: -20, peakDb: -3, noiseDb: null })).toBeNull();
  });

  it('marks a part in a noisy room, and not one in a quiet room, however loud it was said', () => {
    for (const peak of [0.05, 0.3, 0.9]) {
      const x = speech(peak);
      const level = 20 * Math.log10(peak);
      const quiet = measure(plus(x, noise(x.length / RATE, level - 45)));
      const noisy = measure(plus(x, noise(x.length / RATE, level - 15)));
      expect(isNoisy(quiet)).toBe(false);
      expect(isNoisy(noisy)).toBe(true);
    }
  });

  it('marks at the line', () => {
    expect(isNoisy({ lufs: TARGET_LUFS, peakDb: -1, noiseDb: NOISY_DB + 0.1 })).toBe(true);
    expect(isNoisy({ lufs: TARGET_LUFS, peakDb: -1, noiseDb: NOISY_DB })).toBe(false);
    expect(isNoisy({ lufs: null, peakDb: -1, noiseDb: -20 })).toBe(false);
  });
});

describe('keeping a measure (decision 180)', () => {
  it('reads back what it kept, to a tenth of a decibel', () => {
    const x = speech(0.3);
    const r = measure(plus(x, noise(x.length / RATE, -40)));
    const back = unpackSound(packSound(r))!;
    expect(back.lufs!).toBeCloseTo(r.lufs!, 1);
    expect(back.noiseDb!).toBeCloseTo(r.noiseDb!, 1);
    expect(back.peakDb).toBeCloseTo(r.peakDb, 1);
    expect(back.bars).toHaveLength(r.bars.length);
    expect(isNoisy(back)).toBe(isNoisy(r));
    expect(unpackSound(packSound({ ...r, lufs: null, noiseDb: null }))).toMatchObject({ lufs: null, noiseDb: null });
  });

  it('reads nothing from text that is not a measure', () => {
    for (const text of [null, '', 'x', '{}', '{"p":"loud","b":"00","v":"00"}', '{"p":-3,"b":"zz","v":"00"}']) expect(unpackSound(text)).toBeNull();
  });

  it('takes one channel from 16-bit PCM, averaging two', () => {
    const bytes = new Uint8Array(new Int16Array([1000, 3000, -2000, -4000]).buffer);
    expect(Array.from(mono16(bytes, 1))).toEqual([1000, 3000, -2000, -4000]);
    expect(Array.from(mono16(bytes, 2))).toEqual([2000, -3000]);
    // From any byte, whole frames only.
    expect(Array.from(mono16(bytes.subarray(1), 1))).toHaveLength(3);
  });
});
