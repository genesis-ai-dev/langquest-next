import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addSums, BAR_SLICES, ComplexFft, DEEP_FILTER, deepFilter, emptySums, ERB_WIDTHS, frameCount, mix, mixGain, modelRuns,
  passThrough, pcm16, RealFft, resample, Resampler, sliceSums, type DeepFilterNet, type RunCut
} from '../modules/microphone-energy/src/deepFilter';
import { BAR_COUNT } from '../src/audio/barsModel';

// Clean up's arithmetic (decision 178): the web runs deepFilter.ts, and the
// phones' DeepFilter.kt and DeepFilter.swift follow it line for line. The
// model itself is run here through onnxruntime-web's Node build, the web
// module's runtime.

/** The same numbers every run. */
function noise(n: number, seed = 1, level = 1): Float32Array {
  let s = seed;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; out[i] = level * (s / 2147483648 - 0.5); }
  return out;
}

/** A part cleaned with `net`, read from memory and written to memory, as the web does. */
async function clean(x: Float32Array, net: DeepFilterNet, cut?: RunCut): Promise<Float32Array> {
  const y = new Float32Array(x.length);
  let written = 0;
  await deepFilter(
    x.length,
    (at, into) => { into.fill(0); into.set(x.subarray(at, Math.min(x.length, at + into.length))); },
    net,
    (part) => { y.set(part, written); written += part.length; },
    undefined, undefined, cut
  );
  expect(written).toBe(x.length);
  return y;
}

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};
const rms = (a: Float32Array, lo = 0, hi = a.length) => {
  let e = 0;
  for (let i = lo; i < hi; i++) e += a[i]! ** 2;
  return Math.sqrt(e / (hi - lo));
};

describe('the FFT', () => {
  it('is the discrete Fourier transform, for any length made of 2, 3 and 5', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 8, 12, 15, 16, 20, 30, 60, 240, 480]) {
      const re = Float64Array.from(noise(n, n)), im = Float64Array.from(noise(n, n + 7));
      const wantR = new Float64Array(n), wantI = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < n; j++) {
          const a = (-2 * Math.PI * j * k) / n;
          wantR[k] += re[j]! * Math.cos(a) - im[j]! * Math.sin(a);
          wantI[k] += re[j]! * Math.sin(a) + im[j]! * Math.cos(a);
        }
      }
      new ComplexFft(n).forward(re, im);
      expect(maxDiff(re, wantR)).toBeLessThan(1e-9 * n);
      expect(maxDiff(im, wantI)).toBeLessThan(1e-9 * n);
    }
    expect(() => new ComplexFft(14)).toThrow();
  });

  it('gives the bins of a real frame, and the frame back from them', () => {
    const n = DEEP_FILTER.fft, h = n / 2;
    const x = Float64Array.from(noise(n, 3));
    const re = new Float64Array(h + 1), im = new Float64Array(h + 1);
    const fft = new RealFft(n);
    fft.forward(x, re, im);
    for (const k of [0, 1, 17, 96, 240, h]) {
      let r = 0, i = 0;
      for (let j = 0; j < n; j++) { r += x[j]! * Math.cos((2 * Math.PI * j * k) / n); i -= x[j]! * Math.sin((2 * Math.PI * j * k) / n); }
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(i, 9);
    }
    const back = new Float64Array(n);
    fft.inverse(re, im, back);
    expect(maxDiff(back.map((v) => v / n), x)).toBeLessThan(1e-12);
    expect(() => new RealFft(7)).toThrow();
  });
});

describe('the bands the model hears', () => {
  it("are libDF's 32 ERB bands over 481 bins, two bins at least", () => {
    expect(ERB_WIDTHS).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 5, 7, 7, 8, 10, 12, 13, 15, 18, 20, 24, 28, 31, 37, 42, 50, 56, 67]);
    expect(ERB_WIDTHS.reduce((a, b) => a + b, 0)).toBe(DEEP_FILTER.bins);
  });
});

describe('the resampler', () => {
  it('gives the same sound read in pieces as read whole', () => {
    const x = noise(30_000, 5);
    for (const [from, to] of [[44100, 48000], [48000, 16000], [44056, 48000]] as const) {
      const whole = resample(x, from, to);
      expect(whole.length).toBe(Math.floor((x.length * to) / from));
      const r = new Resampler(from, to), pieces: number[] = [];
      for (let at = 0, k = 1; at < x.length; k++) {
        const n = Math.min(x.length - at, 1 + ((k * 7919) % 5000));
        pieces.push(...r.push(x.subarray(at, at + n)));
        at += n;
      }
      pieces.push(...r.end());
      expect(maxDiff(Float32Array.from(pieces), whole)).toBe(0);
    }
  });

  it('keeps a tone it can carry and drops one it cannot', () => {
    const tone = (hz: number, rate: number, n: number) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
    const up = resample(tone(1000, 44100, 44100), 44100, 48000);
    const want = tone(1000, 48000, up.length);
    expect(maxDiff(up.subarray(1000, 47000), want.subarray(1000, 47000))).toBeLessThan(1e-3);
    // Down to 16 kHz: 6 kHz is well under its half, 9 kHz over it.
    expect(rms(resample(tone(6000, 48000, 48000), 48000, 16000), 500, 15500)).toBeGreaterThan(0.7);
    expect(rms(resample(tone(9000, 48000, 48000), 48000, 16000), 500, 15500)).toBeLessThan(1e-3);
    const same = tone(1000, 48000, 100);
    expect(resample(same, 48000, 48000)).toEqual(same);
  });
});

describe('a part cleaned a run at a time', () => {
  const small: RunCut = { frames: 40, settle: 12, cross: 6 };

  it('cuts the part into runs that each start early and cross over', () => {
    expect(modelRuns(2500)).toEqual([
      { from: 0, to: 1100, keep: 0, cross: 0 },
      { from: 700, to: 2100, keep: 1000, cross: 100 },
      { from: 1700, to: 2500, keep: 2000, cross: 100 }
    ]);
    expect(modelRuns(1000)).toEqual([{ from: 0, to: 1000, keep: 0, cross: 0 }]);
    expect(frameCount(48000)).toBe(102);
  });

  it('gives the part back when the model changes nothing', async () => {
    const x = noise(64_000, 9, 0.5);
    const asked: number[] = [];
    const y = await clean(x, async (erb, spec, frames) => {
      asked.push(frames);
      expect(erb.length).toBe(frames * DEEP_FILTER.erb);
      expect(spec.length).toBe(2 * frames * DEEP_FILTER.df);
      return passThrough(frames);
    }, small);
    expect(asked).toEqual(modelRuns(frameCount(x.length), small).map((r) => r.to - r.from));
    expect(maxDiff(y, x)).toBeLessThan(1e-5);
  });

  it('sounds the same cut into runs as whole when the model answers frame by frame', async () => {
    const x = noise(64_000, 11, 0.3);
    const byFrame: DeepFilterNet = async (erb, spec, frames) => {
      const { mask, coefs } = passThrough(frames);
      for (let i = 0; i < mask.length; i++) mask[i] = Math.min(1, Math.max(0, 0.5 + 0.1 * erb[i]!));
      for (let u = 0; u < frames; u++) {
        for (let k = 0; k < DEEP_FILTER.df; k++) coefs[((2 * frames + u) * DEEP_FILTER.df + k) * 2 + 1] = 0.01 * spec[u * DEEP_FILTER.df + k]!;
      }
      return { mask, coefs };
    };
    const runs = await clean(x, byFrame, small);
    const whole = await clean(x, byFrame, { frames: 1e9, settle: 0, cross: 0 });
    expect(maxDiff(runs, whole)).toBe(0);
  });

  it('fades from one run into the next where they cross', async () => {
    const x = noise(64_000, 13, 0.3);
    let call = 0;
    // Every band at a gain of 1 in odd runs and 0 in even ones; the first 96 bins pass as heard.
    const flip: DeepFilterNet = async (_erb, _spec, frames) => {
      const a = passThrough(frames);
      a.mask.fill(call++ % 2);
      return a;
    };
    const y = await clean(x, flip, small);
    const runs = modelRuns(frameCount(x.length), small);
    const H = DEEP_FILTER.hop;
    // The second run (gain 1) takes over from the first (gain 0) over its first `cross` frames: high bands rise across them.
    const level = (frame: number) => rms(y, frame * H - H, (frame + 1) * H - H);
    const second = runs[1]!;
    expect(level(second.keep + small.cross + 4)).toBeGreaterThan(level(second.keep - 6) * 1.5);
  });
});

describe('the slider and the bars', () => {
  it('mixes the part as recorded back in by the limit', () => {
    expect(mixGain(null)).toBe(0);
    expect(mixGain(undefined)).toBe(0);
    expect(mixGain(20)).toBeCloseTo(0.1, 12);
    expect(mixGain(-20)).toBeCloseTo(0.1, 12);
    const x = Float32Array.from([1, -1, 0.5]), y = Float32Array.from([0, 0.5, 0.5]);
    expect([...mix(x, y, 0)]).toEqual([0, 0.5, 0.5]);
    expect([...mix(x, y, 1)]).toEqual([1, -1, 0.5]);
    expect([...mix(x, y, 0.5)]).toEqual([0.5, -0.25, 0.5]);
  });

  it('keeps the sums of both sounds per bar, the same read in pieces as whole', () => {
    expect(BAR_SLICES).toBe(BAR_COUNT);
    const x = noise(10_007, 2), y = noise(10_007, 3);
    const whole = sliceSums(x, y, BAR_SLICES);
    const pieces = emptySums(BAR_SLICES);
    for (let at = 0; at < x.length; at += 999) addSums(pieces, x.subarray(at, at + 999), y.subarray(at, at + 999), at, x.length);
    expect(pieces.n).toEqual(whole.n);
    expect(maxDiff(pieces.xy, whole.xy)).toBeLessThan(1e-9);
    expect(whole.n.reduce((a, b) => a + b, 0)).toBe(x.length);
    expect(whole.xx[0]).toBeCloseTo([...x.subarray(0, whole.n[0])].reduce((a, v) => a + v * v, 0), 9);
  });

  it('writes 16-bit samples as the recorder does', () => {
    expect([...pcm16(Float32Array.from([1, -1, 0.5, 2, -2, 0]))]).toEqual([32767, -32767, 16384, 32767, -32767, 0]);
  });
});

describe("Clean up's model (models/)", () => {
  const models = path.join(path.dirname(fileURLToPath(import.meta.url)), '../modules/microphone-energy/models');
  const MODEL = path.join(models, 'deepfilter.onnx');
  const require = createRequire(import.meta.url);

  interface Tensor { data: Float32Array }
  interface Ort {
    Tensor: new (type: string, data: Float32Array, dims: number[]) => Tensor;
    InferenceSession: { create(model: Uint8Array): Promise<{ inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> }> };
  }
  async function session() {
    const ort = (await import(require.resolve('onnxruntime-web').replace(/ort\.[^/]*$/, 'ort.node.min.mjs'))) as Ort;
    const s = await ort.InferenceSession.create(new Uint8Array(readFileSync(MODEL)));
    const net: DeepFilterNet = async (erb, spec, frames) => {
      const out = await s.run({
        feat_erb: new ort.Tensor('float32', erb, [1, 1, frames, DEEP_FILTER.erb]),
        feat_spec: new ort.Tensor('float32', spec, [1, 2, frames, DEEP_FILTER.df])
      });
      return { mask: out['erb_mask']!.data, coefs: out['df_coefs']!.data };
    };
    return { s, net };
  }

  it('is the file its README names', () => {
    const readme = readFileSync(path.join(models, 'README.md'), 'utf8').replace(/\s+/g, ' ');
    expect(readme).toContain(createHash('sha256').update(readFileSync(MODEL)).digest('hex'));
  });

  it('takes and gives what the modules pass it', async () => {
    const { s } = await session();
    expect([...s.inputNames].sort()).toEqual(['feat_erb', 'feat_spec']);
    expect([...s.outputNames].sort()).toEqual(['df_coefs', 'erb_mask']);
  });

  it('takes a steady hiss away', async () => {
    const { net } = await session();
    const x = noise(DEEP_FILTER.rate * 2, 17, 0.06);
    const y = await clean(x, net);
    const span = [DEEP_FILTER.rate / 2, DEEP_FILTER.rate * 2 - 4800] as const;
    // Measured: from -35 dB to under -75 dB.
    expect(20 * Math.log10(rms(y, ...span) / rms(x, ...span))).toBeLessThan(-20);
  });
});
