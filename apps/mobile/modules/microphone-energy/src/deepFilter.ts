// Clean up's arithmetic (decision 179): everything around DeepFilterNet3
// except the network itself. A part's sound is brought to the model's
// 48 kHz, cut into 20 ms frames (960-point real FFT, 480-sample hop, Vorbis
// window), and each frame gives the model two features: its loudness in 32
// ERB bands and its first 96 bins, each against its running level. The
// model answers a gain for each band and a short filter (5 frames, 2 ahead)
// for the first 96 bins; those are applied to the frames, and the frames are
// put back together. This follows DeepFilterNet's own libDF (v0.5.6) and the
// export's contract (models/README.md): the same frames, features and
// filter, so the model hears what it learned on. The web runs this file
// (cleanUp.web.ts); the phones' modules follow it line for line
// (DeepFilter.kt, DeepFilter.swift), as a phone's JavaScript is too slow
// for it. Keep the three in step: test/deepFilter.test.ts holds this one,
// and the Kotlin is checked against it.
//
// The model holds 9 MB of memory for every second it hears at once, so a
// part goes through it 10 s at a time, each run starting 3 s early so it
// has settled, and the runs cross over in 1 s (modelRuns). Measured on 39 s
// of speech in a cafe: the joined answer is 35 dB under one long run, too
// small to hear. A part up to 10 s is one run. The part is read, resampled
// and cleaned a run at a time too, so a long part takes no more memory than
// a short one on a 2 GB phone.
//
// How much noise goes is not the model's: the cleaned sound is the full
// removal, and the slider mixes some of the part as recorded back in
// (mixGain). Mixing after is the same as DeepFilterNet's own limit, which
// mixes the frames before they are put back, because putting frames back
// is linear and gives the part as recorded exactly.

export const DEEP_FILTER = {
  /** What Clean up's note names as its tool. */
  tool: 'deepfilternet3',
  rate: 48000,
  fft: 960,
  hop: 480,
  bins: 481,
  erb: 32,
  df: 96,
  order: 5,
  lookahead: 2,
  alpha: 0.99
} as const;

const { fft: N, hop: H, bins: F, erb: NE, df: NDF, order: ORDER, lookahead: LA, alpha: ALPHA } = DEEP_FILTER;

/** The slices a part's sums are kept in: the bars it is drawn with (barsModel.ts BAR_COUNT; the phones' CleanUp says the same). */
export const BAR_SLICES = 64;

// ---- FFT ------------------------------------------------------------------------------

/**
 * A complex FFT of any length made of 2, 3, 4 and 5 (Stockham, self-sorting:
 * each stage reads one buffer and writes the other, so nothing is
 * reordered). Forward, unnormalised: X[k] = sum x[j] e^(-2 pi i jk/n). Each
 * stage's twiddles are worked out once, and every multiply is written out,
 * as a phone runs this a few thousand times a part.
 */
export class ComplexFft {
  readonly n: number;
  private readonly stages: { r: number; m: number; s: number; wr: Float64Array; wi: Float64Array }[] = [];
  private readonly ar: Float64Array;
  private readonly ai: Float64Array;
  private readonly br: Float64Array;
  private readonly bi: Float64Array;

  constructor(n: number) {
    this.n = n;
    let left = n;
    const radices: number[] = [];
    for (const r of [4, 2, 3, 5]) while (left % r === 0) { radices.push(r); left /= r; }
    if (left !== 1 || n < 1) throw new Error(`FFT length ${n} is not made of 2, 3 and 5`);
    let len = n, s = 1;
    for (const r of radices) {
      const m = len / r;
      // Stage twiddle (p, k), k = 1..r-1: e^(-2 pi i p k / len).
      const wr = new Float64Array(m * (r - 1)), wi = new Float64Array(m * (r - 1));
      for (let p = 0; p < m; p++) {
        for (let k = 1; k < r; k++) {
          const a = (-2 * Math.PI * p * k) / len;
          wr[p * (r - 1) + k - 1] = Math.cos(a);
          wi[p * (r - 1) + k - 1] = Math.sin(a);
        }
      }
      this.stages.push({ r, m, s, wr, wi });
      len = m;
      s *= r;
    }
    this.ar = new Float64Array(n); this.ai = new Float64Array(n);
    this.br = new Float64Array(n); this.bi = new Float64Array(n);
  }

  /** The transform of (re, im), written back into them. */
  forward(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    let xr = this.ar, xi = this.ai, yr = this.br, yi = this.bi;
    for (let j = 0; j < n; j++) { xr[j] = re[j]; xi[j] = im[j]; }
    for (const { r, m, s, wr, wi } of this.stages) {
      const step = s * m;
      if (r === 4) {
        for (let p = 0; p < m; p++) {
          const w = p * 3, w1r = wr[w], w1i = wi[w], w2r = wr[w + 1], w2i = wi[w + 1], w3r = wr[w + 2], w3i = wi[w + 2];
          for (let q = 0; q < s; q++) {
            const at = q + s * p, out = q + 4 * s * p;
            const a0r = xr[at], a0i = xi[at], a1r = xr[at + step], a1i = xi[at + step];
            const a2r = xr[at + 2 * step], a2i = xi[at + 2 * step], a3r = xr[at + 3 * step], a3i = xi[at + 3 * step];
            const t0r = a0r + a2r, t0i = a0i + a2i, t1r = a0r - a2r, t1i = a0i - a2i;
            const t2r = a1r + a3r, t2i = a1i + a3i, t3r = a1r - a3r, t3i = a1i - a3i;
            // X1 = t1 - i t3, X2 = t0 - t2, X3 = t1 + i t3, each turned by its twiddle.
            const v1r = t1r + t3i, v1i = t1i - t3r, v2r = t0r - t2r, v2i = t0i - t2i, v3r = t1r - t3i, v3i = t1i + t3r;
            yr[out] = t0r + t2r; yi[out] = t0i + t2i;
            yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r;
            yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r;
            yr[out + 3 * s] = v3r * w3r - v3i * w3i; yi[out + 3 * s] = v3r * w3i + v3i * w3r;
          }
        }
      } else if (r === 2) {
        for (let p = 0; p < m; p++) {
          const w1r = wr[p], w1i = wi[p];
          for (let q = 0; q < s; q++) {
            const at = q + s * p, out = q + 2 * s * p;
            const a0r = xr[at], a0i = xi[at], a1r = xr[at + step], a1i = xi[at + step];
            const vr = a0r - a1r, vi = a0i - a1i;
            yr[out] = a0r + a1r; yi[out] = a0i + a1i;
            yr[out + s] = vr * w1r - vi * w1i; yi[out + s] = vr * w1i + vi * w1r;
          }
        }
      } else if (r === 3) {
        for (let p = 0; p < m; p++) {
          const w = p * 2, w1r = wr[w], w1i = wi[w], w2r = wr[w + 1], w2i = wi[w + 1];
          for (let q = 0; q < s; q++) {
            const at = q + s * p, out = q + 3 * s * p;
            const a0r = xr[at], a0i = xi[at], a1r = xr[at + step], a1i = xi[at + step], a2r = xr[at + 2 * step], a2i = xi[at + 2 * step];
            const tr = a1r + a2r, ti = a1i + a2i, dr = (a1r - a2r) * S3, di = (a1i - a2i) * S3;
            const mr = a0r - 0.5 * tr, mi = a0i - 0.5 * ti;
            const v1r = mr + di, v1i = mi - dr, v2r = mr - di, v2i = mi + dr;
            yr[out] = a0r + tr; yi[out] = a0i + ti;
            yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r;
            yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r;
          }
        }
      } else {
        for (let p = 0; p < m; p++) {
          const w = p * 4, w1r = wr[w], w1i = wi[w], w2r = wr[w + 1], w2i = wi[w + 1], w3r = wr[w + 2], w3i = wi[w + 2], w4r = wr[w + 3], w4i = wi[w + 3];
          for (let q = 0; q < s; q++) {
            const at = q + s * p, out = q + 5 * s * p;
            const a0r = xr[at], a0i = xi[at], a1r = xr[at + step], a1i = xi[at + step], a2r = xr[at + 2 * step], a2i = xi[at + 2 * step];
            const a3r = xr[at + 3 * step], a3i = xi[at + 3 * step], a4r = xr[at + 4 * step], a4i = xi[at + 4 * step];
            const b1r = a1r + a4r, b1i = a1i + a4i, b2r = a2r + a3r, b2i = a2i + a3i;
            const d1r = a1r - a4r, d1i = a1i - a4i, d2r = a2r - a3r, d2i = a2i - a3i;
            const r1r = a0r + C51 * b1r + C52 * b2r, r1i = a0i + C51 * b1i + C52 * b2i;
            const r2r = a0r + C52 * b1r + C51 * b2r, r2i = a0i + C52 * b1i + C51 * b2i;
            const i1r = S51 * d1r + S52 * d2r, i1i = S51 * d1i + S52 * d2i;
            const i2r = S52 * d1r - S51 * d2r, i2i = S52 * d1i - S51 * d2i;
            // X1 = r1 - i i1, X2 = r2 - i i2, X3 = r2 + i i2, X4 = r1 + i i1.
            const v1r = r1r + i1i, v1i = r1i - i1r, v2r = r2r + i2i, v2i = r2i - i2r;
            const v3r = r2r - i2i, v3i = r2i + i2r, v4r = r1r - i1i, v4i = r1i + i1r;
            yr[out] = a0r + b1r + b2r; yi[out] = a0i + b1i + b2i;
            yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r;
            yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r;
            yr[out + 3 * s] = v3r * w3r - v3i * w3i; yi[out + 3 * s] = v3r * w3i + v3i * w3r;
            yr[out + 4 * s] = v4r * w4r - v4i * w4i; yi[out + 4 * s] = v4r * w4i + v4i * w4r;
          }
        }
      }
      const tr = xr, ti = xi;
      xr = yr; xi = yi; yr = tr; yi = ti;
    }
    for (let j = 0; j < n; j++) { re[j] = xr[j]; im[j] = xi[j]; }
  }
}

const S3 = Math.sqrt(3) / 2;
const C51 = Math.cos((2 * Math.PI) / 5), C52 = Math.cos((4 * Math.PI) / 5);
const S51 = Math.sin((2 * Math.PI) / 5), S52 = Math.sin((4 * Math.PI) / 5);

/**
 * A real FFT of an even length through a complex one of half its length.
 * `forward` gives the n/2 + 1 bins of a real frame; `inverse` gives the
 * frame back unnormalised (n times it), as realfft and FFTW do.
 */
export class RealFft {
  readonly n: number;
  private readonly half: ComplexFft;
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;

  constructor(n: number) {
    if (n % 2 !== 0) throw new Error('A real FFT needs an even length');
    this.n = n;
    const h = n / 2;
    this.half = new ComplexFft(h);
    this.wr = new Float64Array(h + 1); this.wi = new Float64Array(h + 1);
    for (let k = 0; k <= h; k++) { this.wr[k] = Math.cos((2 * Math.PI * k) / n); this.wi[k] = -Math.sin((2 * Math.PI * k) / n); }
    this.zr = new Float64Array(h); this.zi = new Float64Array(h);
  }

  forward(x: ArrayLike<number>, re: Float64Array, im: Float64Array): void {
    const h = this.n / 2, zr = this.zr, zi = this.zi;
    for (let j = 0; j < h; j++) { zr[j] = x[2 * j]; zi[j] = x[2 * j + 1]; }
    this.half.forward(zr, zi);
    for (let k = 0; k <= h; k++) {
      const a = k % h, b = (h - k) % h;
      // E = (Z[k] + conj Z[h-k]) / 2, O = -i (Z[k] - conj Z[h-k]) / 2, X = E + W^k O
      const er = 0.5 * (zr[a] + zr[b]), ei = 0.5 * (zi[a] - zi[b]);
      const or = 0.5 * (zi[a] + zi[b]), oi = -0.5 * (zr[a] - zr[b]);
      const wr = this.wr[k], wi = this.wi[k];
      re[k] = er + wr * or - wi * oi;
      im[k] = ei + wr * oi + wi * or;
    }
  }

  inverse(re: ArrayLike<number>, im: ArrayLike<number>, out: Float64Array): void {
    const h = this.n / 2, zr = this.zr, zi = this.zi;
    for (let k = 0; k < h; k++) {
      const b = h - k;
      // The first and last bins of a real frame are real: what imaginary part they carry is left out, as numpy and realfft do.
      const ik = k === 0 ? 0 : im[k], ib = k === 0 ? 0 : im[b];
      // E = (X[k] + conj X[h-k]) / 2, O = (X[k] - conj X[h-k]) conj(W^k) / 2, Z = E + i O; conjugated for the inverse.
      const er = 0.5 * (re[k] + re[b]), ei = 0.5 * (ik - ib);
      const dr = 0.5 * (re[k] - re[b]), di = 0.5 * (ik + ib);
      const wr = this.wr[k], wi = -this.wi[k];
      const or = dr * wr - di * wi, oi = dr * wi + di * wr;
      zr[k] = er - oi;
      zi[k] = -(ei + or);
    }
    this.half.forward(zr, zi);
    for (let j = 0; j < h; j++) { out[2 * j] = 2 * zr[j]; out[2 * j + 1] = -2 * zi[j]; }
  }
}

// ---- resampling ------------------------------------------------------------------------

/** Zero crossings of the resampling filter on each side, at the slower rate. */
const ZEROS = 16;
const KAISER_BETA = 8.6;

function besselI0(x: number): number {
  let s = 1, t = 1;
  for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; }
  return s;
}
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/**
 * A part at rate `from` brought to rate `to` as it is read, a piece at a
 * time, with a Kaiser-windowed sinc (16 zero crossings a side, low-passed
 * just under the slower rate's half). Rates in a small ratio (44.1 to 48 kHz
 * is 147 to 160) use one row of weights for each place an output can fall
 * between inputs. It holds only the inputs its next outputs need, so a long
 * part never sits in memory whole.
 */
export class Resampler {
  readonly from: number;
  readonly to: number;
  private readonly up: number;
  private readonly down: number;
  private readonly span: number;
  private readonly taps: number;
  private readonly h: (d: number) => number;
  private readonly table: Float64Array | null;
  /** Inputs from `base` on, and how many there are. */
  private buf = new Float32Array(0);
  private base = 0;
  private have = 0;
  /** The next output's index. */
  private next = 0;

  constructor(from: number, to: number) {
    this.from = from; this.to = to;
    const g = gcd(from, to);
    this.up = to / g; this.down = from / g;
    const scale = Math.min(1, to / from), cutoff = 0.97 * scale, span = Math.ceil(ZEROS / scale), i0 = besselI0(KAISER_BETA);
    this.span = span; this.taps = 2 * span;
    this.h = (d: number) => {
      const u = Math.abs(d) / span;
      if (u >= 1) return 0;
      const w = besselI0(KAISER_BETA * Math.sqrt(1 - u * u)) / i0;
      const a = Math.PI * d * cutoff;
      return (a === 0 ? 1 : Math.sin(a) / a) * w;
    };
    if (this.up > 4096) { this.table = null; return; }
    // Phase f: an output at input place c + f/up, c whole; its taps are inputs c - span + 1 .. c + span.
    const table = new Float64Array(this.up * this.taps);
    for (let f = 0; f < this.up; f++) {
      let sum = 0;
      for (let j = 0; j < this.taps; j++) { const v = this.h(f / this.up - (j - span + 1)); table[f * this.taps + j] = v; sum += v; }
      for (let j = 0; j < this.taps; j++) table[f * this.taps + j] /= sum;
    }
    this.table = table;
  }

  /** The input sample an output falls at or after. */
  private centre(i: number): number {
    return this.table ? Math.floor((i * this.down) / this.up) : Math.floor((i * this.from) / this.to);
  }

  /** More of the part; the outputs it completes. */
  push(x: Float32Array): Float32Array {
    if (this.from === this.to) { this.have += x.length; return x.slice(); }
    const keepFrom = Math.max(this.base, Math.min(this.have, this.centre(this.next) - this.span + 1));
    const kept = this.buf.subarray(keepFrom - this.base, this.have - this.base);
    const buf = new Float32Array(kept.length + x.length);
    buf.set(kept); buf.set(x, kept.length);
    this.buf = buf; this.base = keepFrom; this.have += x.length;
    let last = this.next;
    while (this.centre(last) + this.span < this.have) last++;
    return this.outputs(last);
  }

  /** The part has ended: the outputs left, up to its length at the new rate. */
  end(): Float32Array {
    if (this.from === this.to) return new Float32Array(0);
    return this.outputs(Math.floor((this.have * this.up) / this.down));
  }

  private outputs(until: number): Float32Array {
    const out = new Float32Array(Math.max(0, until - this.next));
    const { buf, base, have, span, taps, table } = this;
    for (let i = this.next; i < until; i++) {
      let v: number;
      if (table) {
        const at = i * this.down, c = Math.floor(at / this.up), f = at - c * this.up, first = c - span + 1, row = f * taps;
        let acc = 0;
        if (first >= 0 && first + taps <= have) {
          for (let j = 0; j < taps; j++) acc += buf[first + j - base] * table[row + j];
        } else {
          for (let j = 0; j < taps; j++) { const k = first + j; if (k >= 0 && k < have) acc += buf[k - base] * table[row + j]; }
        }
        v = acc;
      } else {
        const t = (i * this.from) / this.to, c = Math.floor(t);
        let acc = 0, sum = 0;
        for (let k = Math.max(0, c - span + 1); k <= Math.min(have - 1, c + span); k++) { const w = this.h(t - k); acc += buf[k - base] * w; sum += w; }
        v = sum === 0 ? 0 : acc / sum;
      }
      out[i - this.next] = v;
    }
    this.next = Math.max(this.next, until);
    return out;
  }
}

/** A whole part at rate `from` brought to rate `to`. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  const r = new Resampler(from, to);
  const a = r.push(x), b = r.end();
  const out = new Float32Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

// ---- frames and features ---------------------------------------------------------------

/** How many bins each ERB band holds, lowest first (libDF erb_fb with min_nb_freqs 2): they add up to 481. */
export const ERB_WIDTHS: readonly number[] = (() => {
  const toErb = (f: number) => 9.265 * Math.log1p(f / (24.7 * 9.265));
  const fromErb = (e: number) => 24.7 * 9.265 * (Math.exp(e / 9.265) - 1);
  const lo = toErb(0), hi = toErb(DEEP_FILTER.rate / 2), step = (hi - lo) / NE, binHz = DEEP_FILTER.rate / N;
  const widths: number[] = [];
  let prev = 0, over = 0;
  for (let i = 1; i <= NE; i++) {
    const bin = Math.round(Math.fround(fromErb(lo + i * step) / binHz));
    let w = bin - prev - over;
    if (w < 2) { over = 2 - w; w = 2; } else over = 0;
    widths.push(w);
    prev = bin;
  }
  widths[NE - 1] = widths[NE - 1]! + 1;
  const extra = widths.reduce((a, b) => a + b, 0) - F;
  if (extra > 0) widths[NE - 1] = widths[NE - 1]! - extra;
  return widths;
})();
const EDGES = ERB_WIDTHS.reduce<number[]>((e, w) => [...e, e[e.length - 1]! + w], [0]);

/** The Vorbis window: its square and the square of its other half add to one, so frames put back give the sound exactly. */
const WINDOW = (() => {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) { const s = Math.sin((0.5 * Math.PI * (i + 0.5)) / (N / 2)); w[i] = Math.sin(0.5 * Math.PI * s * s); }
  return w;
})();
const WNORM = 1 / ((N * N) / (2 * H));

/** Called every so many frames, so a phone's screen keeps drawing while a long part is worked through. */
export type Pause = () => Promise<void>;
const PAUSE_EVERY = 100;

// ---- the model, a stretch at a time ----------------------------------------------------

/** Frames the model hears at once at most, the frames it hears before a stretch to settle, and the frames two stretches cross over. */
export const MODEL_RUN = { frames: 1000, settle: 300, cross: 100 } as const;

/**
 * One run of the model: frames `from` to `to` go in; frames from `keep` on
 * are used, the first `cross` of them faded in over the run before.
 */
export interface ModelRun { from: number; to: number; keep: number; cross: number }

/** How a part is cut into runs: MODEL_RUN, or another cut in the tests. */
export interface RunCut { frames: number; settle: number; cross: number }

/** The runs that cover `frames` frames: one when it fits (the same as a single run). */
export function modelRuns(frames: number, cut: RunCut = MODEL_RUN): ModelRun[] {
  const out: ModelRun[] = [];
  for (let s = 0; s < frames;) {
    const e = Math.min(frames, s + cut.frames);
    out.push({ from: Math.max(0, s - cut.settle), to: e < frames ? Math.min(frames, e + cut.cross) : frames, keep: s, cross: s > 0 ? cut.cross : 0 });
    s = e;
  }
  return out;
}

/** What the model says for `n` frames: a gain per band, [1, 1, n, 32], and the filter, [1, 5, n, 96, 2]. */
export interface ModelAnswer { mask: Float32Array; coefs: Float32Array }

/** The network itself, run where the platform can: a run's features in ([1, 1, n, 32] and [1, 2, n, 96], real parts then imaginary), its answer out. */
export type DeepFilterNet = (erb: Float32Array, spec: Float32Array, frames: number) => Promise<ModelAnswer>;

/** The model's answer that changes nothing: every gain 1, and the filter passing each bin's own frame. */
export function passThrough(frames: number): ModelAnswer {
  const mask = new Float32Array(frames * NE).fill(1), coefs = new Float32Array(ORDER * frames * NDF * 2);
  const o = ORDER - 1 - LA;
  for (let t = 0; t < frames; t++) for (let k = 0; k < NDF; k++) coefs[((o * frames + t) * NDF + k) * 2] = 1;
  return { mask, coefs };
}

// ---- the whole part --------------------------------------------------------------------

/** How many frames cover a part of `length` samples with the half frame it lags by. */
export function frameCount(length: number): number {
  return Math.floor((length + N) / H);
}

/**
 * A part at 48 kHz cleaned at full strength (libDF's analysis, its
 * normalised features, the model, and its synthesis). The part is read and
 * the cleaned sound written a run at a time, and only one run's frames are
 * held, so a long part takes no more memory than a short one. `read` fills
 * `into` with the part's samples from `at` on (zeros past its end); `write`
 * takes the cleaned sound in order, `length` samples in all. `progress`
 * hears how far along it is, 0 to 1. `cut` is for the tests.
 */
export async function deepFilter(
  length: number,
  read: (at: number, into: Float32Array) => void,
  net: DeepFilterNet,
  write: (y: Float32Array) => void,
  progress?: (done: number) => void,
  pause?: Pause,
  cut: RunCut = MODEL_RUN
): Promise<void> {
  const frames = frameCount(length);
  const runs = modelRuns(frames, cut);
  const held = Math.min(frames, cut.frames + cut.settle + cut.cross);
  // The frames held, from frame `lo`: spectra, and the model's features.
  const re = new Float32Array(held * F), im = new Float32Array(held * F);
  const erb = new Float32Array(held * NE), specRe = new Float32Array(held * NDF), specIm = new Float32Array(held * NDF);
  let lo = 0, analysed = 0;
  // Analysis: the window's first half, and the running levels the features are measured against.
  const fft = new RealFft(N);
  const buf = new Float64Array(N), xr = new Float64Array(F), xi = new Float64Array(F), mem = new Float64Array(N - H);
  const meanErb = new Float64Array(NE), unit = new Float64Array(NDF);
  for (let b = 0; b < NE; b++) meanErb[b] = -60 + (b * -30) / (NE - 1);
  for (let k = 0; k < NDF; k++) unit[k] = 0.001 + (k * (0.0001 - 0.001)) / (NDF - 1);
  // Synthesis: one frame's answer, its bins, and the frame before's second half.
  const mask = new Float32Array(NE), coefs = new Float32Array(ORDER * NDF * 2);
  const er = new Float64Array(F), ei = new Float64Array(F), frame = new Float64Array(N), out = new Float64Array(N - H);
  // The last run's answer for the frames the next one crosses over.
  const tailMask = new Float32Array(cut.cross * NE), tailCoefs = new Float32Array(ORDER * cut.cross * NDF * 2);
  let tailFrom = 0, tailN = 0;
  // The cleaned sound lags by half a frame: its first half frame is dropped.
  let skip = N - H, left = length;

  for (const [r, run] of runs.entries()) {
    // Keep the frames this run hears again, and analyse the rest.
    const shift = run.from - lo;
    if (shift > 0) {
      const kept = analysed - run.from;
      re.copyWithin(0, shift * F, (shift + kept) * F); im.copyWithin(0, shift * F, (shift + kept) * F);
      erb.copyWithin(0, shift * NE, (shift + kept) * NE);
      specRe.copyWithin(0, shift * NDF, (shift + kept) * NDF); specIm.copyWithin(0, shift * NDF, (shift + kept) * NDF);
      lo = run.from;
    }
    const x = new Float32Array((run.to - analysed) * H);
    read(analysed * H, x);
    for (let t = analysed; t < run.to; t++) {
      for (let i = 0; i < N - H; i++) buf[i] = mem[i] * WINDOW[i];
      const at = (t - analysed) * H;
      for (let i = 0; i < H; i++) {
        const v = x[at + i];
        buf[N - H + i] = v * WINDOW[N - H + i];
        mem[i] = v;
      }
      fft.forward(buf, xr, xi);
      const row = (t - lo) * F;
      for (let k = 0; k < F; k++) { re[row + k] = xr[k] * WNORM; im[row + k] = xi[k] * WNORM; }
      for (let b = 0; b < NE; b++) {
        let e = 0;
        for (let k = EDGES[b]!; k < EDGES[b + 1]!; k++) { const a = re[row + k], c = im[row + k]; e += a * a + c * c; }
        const db = 10 * Math.log10(e / ERB_WIDTHS[b]! + 1e-10);
        meanErb[b] = db * (1 - ALPHA) + meanErb[b] * ALPHA;
        erb[(t - lo) * NE + b] = (db - meanErb[b]) / 40;
      }
      for (let k = 0; k < NDF; k++) {
        const a = re[row + k], c = im[row + k];
        unit[k] = Math.hypot(a, c) * (1 - ALPHA) + unit[k] * ALPHA;
        const d = Math.sqrt(unit[k]);
        specRe[(t - lo) * NDF + k] = a / d;
        specIm[(t - lo) * NDF + k] = c / d;
      }
      if (pause && t % PAUSE_EVERY === PAUSE_EVERY - 1) await pause();
    }
    analysed = run.to;

    // The model hears the run.
    const n = run.to - run.from;
    const spec = new Float32Array(2 * n * NDF);
    spec.set(specRe.subarray(0, n * NDF)); spec.set(specIm.subarray(0, n * NDF), n * NDF);
    const answer = await net(erb.slice(0, n * NE), spec, n);

    // Frames from `keep` up to the next run's are final: their answer, crossed over the last run's, applied and put back.
    const end = Math.min(frames, run.keep + cut.frames);
    const y = new Float32Array((end - run.keep) * H);
    for (let t = run.keep; t < end; t++) {
      const u = t - run.from;
      const w = t < run.keep + run.cross ? (t - run.keep + 0.5) / run.cross : 1;
      const v = t - tailFrom;
      for (let b = 0; b < NE; b++) mask[b] = w === 1 ? answer.mask[u * NE + b] : (1 - w) * tailMask[v * NE + b] + w * answer.mask[u * NE + b];
      for (let o = 0; o < ORDER; o++) {
        const into = o * NDF * 2, from = ((o * n + u) * NDF) * 2, tail = ((o * cut.cross + v) * NDF) * 2;
        for (let k = 0; k < NDF * 2; k++) coefs[into + k] = w === 1 ? answer.coefs[from + k] : (1 - w) * tailCoefs[tail + k] + w * answer.coefs[from + k];
      }
      const row = (t - lo) * F;
      for (let b = 0; b < NE; b++) {
        const g = mask[b];
        for (let k = EDGES[b]!; k < EDGES[b + 1]!; k++) { er[k] = re[row + k] * g; ei[k] = im[row + k] * g; }
      }
      for (let k = 0; k < NDF; k++) {
        let sr = 0, si = 0;
        for (let o = 0; o < ORDER; o++) {
          const tt = t - (ORDER - 1 - LA) + o;
          if (tt < 0 || tt >= frames) continue;
          const c = (o * NDF + k) * 2, cr = coefs[c], ci = coefs[c + 1];
          const a = re[(tt - lo) * F + k], b = im[(tt - lo) * F + k];
          sr += a * cr - b * ci;
          si += a * ci + b * cr;
        }
        er[k] = sr; ei[k] = si;
      }
      fft.inverse(er, ei, frame);
      const at = (t - run.keep) * H;
      for (let i = 0; i < H; i++) y[at + i] = frame[i] * WINDOW[i] + out[i];
      for (let i = 0; i < N - H; i++) out[i] = frame[H + i] * WINDOW[H + i];
      if (pause && t % PAUSE_EVERY === PAUSE_EVERY - 1) await pause();
    }
    const from = Math.min(skip, y.length), count = Math.min(left, y.length - from);
    skip -= from;
    if (count > 0) { write(y.subarray(from, from + count)); left -= count; }

    // The frames the next run crosses over, as this run answered them.
    tailFrom = end; tailN = run.to - end;
    for (let v = 0; v < tailN; v++) {
      const u = end + v - run.from;
      tailMask.set(answer.mask.subarray(u * NE, (u + 1) * NE), v * NE);
      for (let o = 0; o < ORDER; o++) tailCoefs.set(answer.coefs.subarray(((o * n + u) * NDF) * 2, ((o * n + u + 1) * NDF) * 2), ((o * cut.cross + v) * NDF) * 2);
    }
    progress?.((r + 1) / runs.length);
  }
}

/** The share of the part as recorded that a limit of `limitDb` keeps (DeepFilterNet's attenuation limit); none without a limit. */
export function mixGain(limitDb?: number | null): number {
  return limitDb === undefined || limitDb === null ? 0 : 10 ** (-Math.abs(limitDb) / 20);
}

/** The cleaned sound with `gain` of the part as recorded mixed back in. */
export function mix(x: Float32Array, y: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = gain * x[i] + (1 - gain) * y[i];
  return out;
}

/**
 * For the bars of both sounds at any strength without going through them
 * again: in each of `count` even slices (as barsModel.ts slices a part),
 * the sums of x*x, x*y and y*y, x the part as recorded and y the cleaned
 * sound. A mix's square is a sum of these three.
 */
export interface SliceSums { n: number[]; xx: number[]; xy: number[]; yy: number[] }

export function emptySums(count: number): SliceSums {
  const n = new Array<number>(count).fill(0);
  return { n, xx: n.slice(), xy: n.slice(), yy: n.slice() };
}

/** Adds a stretch of both sounds, from sample `at` of a part `total` samples long. */
export function addSums(s: SliceSums, x: Float32Array, y: Float32Array, at: number, total: number): void {
  const count = s.n.length, per = Math.max(1, total / count);
  for (let i = 0; i < y.length; i++) {
    const k = Math.min(count - 1, Math.floor((at + i) / per)), a = x[i], b = y[i];
    s.n[k] += 1; s.xx[k] += a * a; s.xy[k] += a * b; s.yy[k] += b * b;
  }
}

export function sliceSums(x: Float32Array, y: Float32Array, count: number): SliceSums {
  const s = emptySums(count);
  addSums(s, x, y, 0, y.length);
  return s;
}

/** Samples from -1 to 1 as 16-bit PCM, as the recorder writes them. */
export function pcm16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, x[i])) * 32767);
  return out;
}
