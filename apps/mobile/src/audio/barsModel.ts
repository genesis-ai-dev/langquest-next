// A part's sound as bars (Caleb, 2026-10-16: a part reads as a voice
// message, its bars and its length where its name was). Pure: the levels
// of a recording in even slices, as tall as the part's loudest slice allows
// (so speech shows its rise and fall), though a part that is quiet all
// through stays low; and how they are kept and fitted to a row.

/** How many bars are kept for a part, whatever the row has room for. */
export const BAR_COUNT = 64;
/** A part whose loudest slice is quieter than this (about -26 dBFS) draws lower than full height. */
const QUIET = 0.05;
/** Lifts the middle of the scale, so speech between its peaks still shows. */
const CURVE = 0.7;

/**
 * Builds bars from samples as they arrive, in `count` even slices of
 * `total` samples (frames: every channel of one moment), so a long part is
 * read a block at a time and never held whole.
 */
export function barsBuilder(total: number, count = BAR_COUNT) {
  const sums = new Float64Array(count);
  const ns = new Float64Array(count);
  let at = 0;
  const per = Math.max(1, total / count);
  return {
    /** One moment's sample, from -1 to 1. */
    add(v: number) {
      const k = Math.min(count - 1, Math.floor(at / per));
      sums[k]! += v * v;
      ns[k]! += 1;
      at++;
    },
    bars(): number[] {
      const amps = Array.from(sums, (s, k) => (ns[k]! > 0 ? Math.sqrt(s / ns[k]!) : 0));
      const top = Math.max(QUIET, ...amps);
      return amps.map((a) => Math.min(1, Math.pow(a / top, CURVE)));
    }
  };
}

/** Bars from 16-bit PCM with `channels` interleaved. */
export function barsFromPcm(pcm: Int16Array, channels: number, count = BAR_COUNT): number[] {
  const frames = Math.floor(pcm.length / channels);
  const b = barsBuilder(frames, count);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm[f * channels + c]!;
    b.add(sum / channels / 32768);
  }
  return b.bars();
}

/** Bars from decoded samples (the web's decoder gives each channel as floats). */
export function barsFromChannels(channels: Float32Array[], count = BAR_COUNT): number[] {
  const frames = channels[0]?.length ?? 0;
  const b = barsBuilder(frames, count);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (const c of channels) sum += c[f]!;
    b.add(sum / channels.length);
  }
  return b.bars();
}

/**
 * Bars from the levels the recording screen showed while the part was said
 * (livePartsModel.ts: each frame's loudest sample, dB), so leaving a session
 * draws its parts without reading their files. A part shorter than `count`
 * frames gets a bar a frame (fitBars spreads them); none, when it has none.
 */
export function barsFromLevels(db: readonly number[], count = BAR_COUNT): number[] | null {
  if (db.length === 0) return null;
  const b = barsBuilder(db.length, Math.min(count, db.length));
  for (const d of db) b.add(10 ** (d / 20));
  return b.bars();
}

/** `bars` fitted to `n` places: each place takes the loudest bar it covers, or repeats one when there are more places than bars. */
export function fitBars(bars: readonly number[], n: number): number[] {
  if (n <= 0 || bars.length === 0) return [];
  return Array.from({ length: n }, (_, k) => {
    const from = Math.floor((k * bars.length) / n);
    const to = Math.max(from + 1, Math.floor(((k + 1) * bars.length) / n));
    let top = 0;
    for (let j = from; j < to && j < bars.length; j++) top = Math.max(top, bars[j]!);
    return top;
  });
}

const DIGITS = '0123456789abcdefghijklmnopqrstuv';

/** Bars as text to keep on the phone: one character each, 32 steps. */
export function packBars(bars: readonly number[]): string {
  return bars.map((b) => DIGITS[Math.max(0, Math.min(31, Math.round(b * 31)))]).join('');
}

/** Bars kept by `packBars`, or null when the text is not that. */
export function unpackBars(text: string | null | undefined): number[] | null {
  if (!text || !/^[0-9a-v]+$/.test(text)) return null;
  return Array.from(text, (ch) => DIGITS.indexOf(ch) / 31);
}
