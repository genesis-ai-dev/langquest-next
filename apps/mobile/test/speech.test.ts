import { describe, expect, it } from 'vitest';
import { Resampler, SILERO, SpeechChunks, frameScore } from '../modules/microphone-energy/src/speech';

// The sound the speech model hears (LAN-82, decision 135): the microphone's
// 44.1 kHz brought down to 16 kHz, cut into 512-sample chunks with the 64
// samples before each. Speech.kt and Speech.swift do the same arithmetic.
const IN_RATE = 44100;
const sine = (hz: number, seconds: number, rate = IN_RATE) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.sin(2 * Math.PI * hz * i / rate));

function resample(input: Float32Array, pushes = 1): number[] {
  const r = new Resampler(IN_RATE);
  const out: number[] = [];
  const size = Math.ceil(input.length / pushes);
  for (let i = 0; i < input.length; i += size) r.push(input.subarray(i, i + size), (s) => out.push(s));
  return out;
}

/** Peak of the middle half, away from the filter's start. */
const peak = (xs: number[]) => Math.max(...xs.slice(xs.length / 4, xs.length * 3 / 4).map(Math.abs));

describe('the sound the speech model hears (speech.ts)', () => {
  it('brings 44.1 kHz down to 16 kHz', () => {
    const out = resample(sine(440, 2));
    expect(Math.abs(out.length - 2 * SILERO.sampleRate)).toBeLessThan(20);
  });

  it('keeps speech as it was and drops what 16 kHz cannot hold', () => {
    // A 1 kHz tone passes at its level; a 12 kHz tone would fold down into speech, so it goes.
    expect(peak(resample(sine(1000, 1)))).toBeCloseTo(1, 1);
    expect(peak(resample(sine(12000, 1)))).toBeLessThan(0.05);
  });

  it('gives the same samples however the microphone hands the sound over', () => {
    const input = sine(700, 1);
    const whole = resample(input);
    const pieces = resample(input, 37);
    expect(pieces).toHaveLength(whole.length);
    pieces.forEach((s, i) => expect(s).toBeCloseTo(whole[i]!, 6));
  });

  it('cuts chunks of 512 new samples with the 64 before them in front', () => {
    const c = new SpeechChunks();
    const chunks: Float32Array[] = [];
    for (let i = 1; i <= 3 * SILERO.chunk; i++) {
      const chunk = c.push(i);
      if (chunk) chunks.push(chunk);
    }
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk).toHaveLength(SILERO.context + SILERO.chunk);
    // The first chunk has nothing before it.
    expect(Array.from(chunks[0]!.subarray(0, SILERO.context))).toEqual(new Array(SILERO.context).fill(0));
    expect(chunks[0]![SILERO.context]).toBe(1);
    // Each later chunk starts with the end of the one before.
    expect(Array.from(chunks[1]!.subarray(0, SILERO.context))).toEqual(Array.from(chunks[0]!.subarray(SILERO.chunk)));
    expect(chunks[1]![SILERO.context]).toBe(SILERO.chunk + 1);
  });

  it('starts afresh after a reset', () => {
    const c = new SpeechChunks();
    for (let i = 0; i < SILERO.chunk + 100; i++) c.push(1);
    c.reset();
    let chunk: Float32Array | null = null;
    for (let i = 0; i < SILERO.chunk && !chunk; i++) chunk = c.push(2);
    expect(chunk).not.toBeNull();
    expect(Array.from(chunk!.subarray(0, SILERO.context))).toEqual(new Array(SILERO.context).fill(0));
    expect(Array.from(chunk!.subarray(SILERO.context))).toEqual(new Array(SILERO.chunk).fill(2));
  });

  it("scores a frame by the surest chunk that ended in it, or the last chunk's", () => {
    expect(frameScore([0.2, 0.9], 0.1)).toBe(0.9);
    expect(frameScore([], 0.7)).toBe(0.7);
  });
});
