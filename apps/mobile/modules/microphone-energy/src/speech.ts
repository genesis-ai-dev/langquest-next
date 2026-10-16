// Is this sound speech? (LAN-82, decision 135.) The splitter's levels say
// whether a sound stands out of the room; a fan, a clink or a passing car
// does too. Silero VAD (v6.2.3, MIT, the 16 kHz model) says how much each
// 32 ms of sound is like speech, and a part is only sound that is both. This
// file is the pure part every platform shares: the microphone's 44.1 kHz
// brought down to the model's 16 kHz, cut into the model's 512-sample chunks
// with the 64 samples before each, and a frame's score from the chunks that
// ended in it. The model itself runs where each platform can run it
// (ONNX Runtime on the phones, onnxruntime-web on the web). The phones'
// modules follow the same arithmetic (Speech.kt, Speech.swift).

export const SILERO = {
  sampleRate: 16000,
  /** Samples the model scores at a time (32 ms). */
  chunk: 512,
  /** Samples of the chunk before that go in with each chunk. */
  context: 64,
  /** A frame this sure or more is speech; under `off` it is not speech any more (Silero's own defaults). */
  on: 0.5,
  off: 0.35
};

/** Half the resampling filter's length, in input samples. */
const TAPS = 16;

/**
 * Streams one rate into another with a windowed-sinc filter (Hann, 2 × TAPS
 * input samples), low-passed under the slower rate's half, so speech keeps
 * its shape and nothing above 8 kHz folds down into it.
 */
export class Resampler {
  private readonly step: number;
  private readonly cutoff: number;
  /** Input not yet used up: kept from the last push. */
  private buf: number[] = [];
  /** Where the next output falls, in input samples from buf[0]. */
  private at = TAPS;

  constructor(inRate: number, outRate = SILERO.sampleRate) {
    this.step = inRate / outRate;
    this.cutoff = Math.min(1, outRate / inRate) * 0.45;
  }

  /** Some input; every output sample it completes goes to `out`. */
  push(input: ArrayLike<number>, out: (sample: number) => void): void {
    for (let i = 0; i < input.length; i++) this.buf.push(input[i]!);
    while (this.at + TAPS < this.buf.length) {
      const centre = Math.floor(this.at);
      let sum = 0, weights = 0;
      for (let k = centre - TAPS + 1; k <= centre + TAPS; k++) {
        const d = this.at - k;
        const w = 0.5 + 0.5 * Math.cos(Math.PI * d / TAPS);
        const x = 2 * Math.PI * this.cutoff * d;
        const h = (d === 0 ? 1 : Math.sin(x) / x) * w;
        sum += this.buf[k]! * h;
        weights += h;
      }
      out(weights === 0 ? 0 : sum / weights);
      this.at += this.step;
    }
    const drop = Math.floor(this.at) - TAPS;
    if (drop > 0) { this.buf.splice(0, drop); this.at -= drop; }
  }
}

/**
 * The model's chunks from 16 kHz samples: each 512 new samples, with the 64
 * before them in front, as Silero's own wrapper feeds it.
 */
export class SpeechChunks {
  private ctx = new Float32Array(SILERO.context);
  private cur = new Float32Array(SILERO.chunk);
  private n = 0;

  /** One sample; a full chunk, context first, when this one completes it. */
  push(sample: number): Float32Array | null {
    this.cur[this.n++] = sample;
    if (this.n < SILERO.chunk) return null;
    const input = new Float32Array(SILERO.context + SILERO.chunk);
    input.set(this.ctx, 0);
    input.set(this.cur, SILERO.context);
    this.ctx = this.cur.slice(SILERO.chunk - SILERO.context);
    this.n = 0;
    return input;
  }

  reset(): void {
    this.ctx = new Float32Array(SILERO.context);
    this.n = 0;
  }
}

/**
 * A microphone frame's speech score: the surest chunk that ended in it, or
 * the last chunk's when none did (a frame is shorter than two chunks).
 */
export function frameScore(scores: readonly number[], last: number): number {
  return scores.length === 0 ? last : Math.max(...scores);
}
