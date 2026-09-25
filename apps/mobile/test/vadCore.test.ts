import { assemble, encodeWav, FRAME_SAMPLES, peakEnergy, prerollFrames, SAMPLE_RATE, Vad,
  type VadAction } from '../modules/microphone-energy/src/vadCore';

// The web recorder must split takes exactly as the phone does, or a journey
// on web proves nothing about a translator's recording. Settings below are
// the ones useRecorder sends (BASE plus its default threshold and pause).
const APP = { onsetMultiplier: 0.1, maxOnsetDuration: 250, rewindHalfPause: true,
  minSegmentDuration: 200, minActiveAudioDuration: 250, threshold: 0.1, silenceDuration: 1000 };
const FRAME_MS = FRAME_SAMPLES / (SAMPLE_RATE / 1000);
const LOUD = 0.5, QUIET = 0.001, SOFT = 0.03; // SOFT: above onset (0.01), below threshold (0.1)

/** Feed `ms` of frames at one energy; collect actions with their times. */
function feed(vad: Vad, clock: { t: number }, ms: number, energy: number, out: { at: number; action: VadAction }[]) {
  for (const end = clock.t + ms; clock.t < end; clock.t += FRAME_MS) {
    const action = vad.step(energy, clock.t);
    if (action) out.push({ at: clock.t, action });
  }
}

function session() {
  const vad = new Vad();
  vad.configure(APP);
  vad.reset();
  return { vad, clock: { t: 10_000 }, out: [] as { at: number; action: VadAction }[] };
}

describe('voice activity detection (native parity)', () => {
  it('drops a tap or cough so a translator never gets a junk take', () => {
    const { vad, clock, out } = session();
    feed(vad, clock, 100, LOUD, out);
    feed(vad, clock, 2000, QUIET, out);
    expect(out.map(o => o.action.type)).toEqual(['start', 'stop']);
    expect(out[1]!.action).toMatchObject({ discard: true });
  });

  it('keeps one take across a pause shorter than the pause setting', () => {
    const { vad, clock, out } = session();
    feed(vad, clock, 1000, LOUD, out);
    feed(vad, clock, 500, QUIET, out);
    feed(vad, clock, 1000, LOUD, out);
    feed(vad, clock, 1500, QUIET, out);
    expect(out.map(o => o.action.type)).toEqual(['start', 'stop']);
    expect(out[1]!.action).toEqual({ type: 'stop', discard: false, rewindMs: 500 });
  });

  it('splits into two takes when the speaker pauses for the full pause setting', () => {
    const { vad, clock, out } = session();
    feed(vad, clock, 1000, LOUD, out);
    feed(vad, clock, 1200, QUIET, out);
    feed(vad, clock, 1000, LOUD, out);
    feed(vad, clock, 1200, QUIET, out);
    expect(out.map(o => o.action.type)).toEqual(['start', 'stop', 'start', 'stop']);
  });

  it('keeps the soft start of a word, but never more than maxOnsetDuration of it', () => {
    const { vad, clock, out } = session();
    feed(vad, clock, 1000, QUIET, out);
    feed(vad, clock, 150, SOFT, out);
    feed(vad, clock, 500, LOUD, out);
    const start = out[0]!.action;
    expect(start).toEqual({ type: 'start', prerollMs: 250 });
    // 250 ms is 5 whole ring frames at 44.1 kHz / 2048; native truncates.
    expect(prerollFrames(250)).toBe(5);
  });

  it('abandons a soft sound that never reaches the threshold', () => {
    const { vad, clock, out } = session();
    feed(vad, clock, 400, SOFT, out);
    feed(vad, clock, 400, QUIET, out);
    expect(out).toEqual([]);
    expect(vad.state).toBe('IDLE');
  });

  it('ends a take one full pause after the last loud frame, not after the first', () => {
    const { vad, clock, out } = session();
    feed(vad, clock, 50, LOUD, out); // two frames: the start frame and one more
    feed(vad, clock, 3000, QUIET, out);
    const [start, stop] = out;
    const lastLoud = start!.at + FRAME_MS;
    expect(stop!.at - lastLoud).toBeGreaterThanOrEqual(APP.silenceDuration);
    expect(stop!.at - lastLoud).toBeLessThan(APP.silenceDuration + FRAME_MS);
  });
});

describe('segment audio', () => {
  it('measures energy as clamped peak level, like the native meter', () => {
    expect(peakEnergy(new Float32Array(8))).toBeCloseTo(0.001); // -60 dB floor
    expect(peakEnergy(Float32Array.of(0, -0.5, 0.25))).toBeCloseTo(0.5);
    expect(peakEnergy(Float32Array.of(2))).toBe(1);
  });

  it('trims half the pause from the end, so a take does not end in dead air', () => {
    const frames = [Float32Array.of(0.5, 0.5, 0.5), Float32Array.of(0, 0, 0)];
    expect([...assemble(frames, 2)]).toEqual([16384, 16384, 16384, 0]);
    expect(assemble(frames, 99).length).toBe(0);
  });

  it('writes the same mono 16-bit WAV header as the phone', () => {
    const wav = encodeWav(Int16Array.of(1, -1));
    const view = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.slice(at, at + 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(36 + 4);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(46, true)).toBe(-1);
  });
});
