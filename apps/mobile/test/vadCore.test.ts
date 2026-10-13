import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, prerollFrames, SAMPLE_RATE, Vad } from '../modules/microphone-energy/src/vadCore';
import { VAD_BASE } from '../src/recording/vadSettings';

// The voice detector's rules (vadCore.ts is the exact port of the native
// modules' handleVAD). Each test feeds frame peaks the way the microphone
// does: one 2048-sample frame about every 46 ms.
const FRAME_MS = FRAME_SAMPLES / (SAMPLE_RATE / 1000);

type Action = NonNullable<ReturnType<Vad['step']>>;

/** Feed `levels` (one per frame) and say what the detector did on which frame. */
function run(levels: number[], config = {}): { at: number; action: Action }[] {
  const vad = new Vad();
  vad.configure({ ...VAD_BASE, threshold: 0.1, silenceDuration: 1000, ...config });
  vad.reset();
  const out: { at: number; action: Action }[] = [];
  levels.forEach((level, f) => {
    const action = vad.step(level, f * FRAME_MS);
    if (action) out.push({ at: f, action });
  });
  return out;
}

const frames = (seconds: number, level: number) => Array.from({ length: Math.round(seconds * 1000 / FRAME_MS) }, () => level);
const stopOf = (actions: { action: Action }[]) => actions.find((a) => a.action.type === 'stop')?.action as Extract<Action, { type: 'stop' }> | undefined;

describe('the voice detector (decisions.md 93)', () => {
  it('keeps a part going while a soft voice stays above half the cutoff', () => {
    // A loud word, then 2 s of speech at 0.07: under the 0.1 cutoff, over half of it.
    const actions = run([...frames(0.2, 0.3), ...frames(2, 0.07), ...frames(1.5, 0.01)]);
    expect(actions.map((a) => a.action.type)).toEqual(['start', 'stop']);
    // It ends only once the soft speech has stopped for a pause.
    expect(actions[1]!.at * FRAME_MS).toBeGreaterThan(2200 + 1000 - FRAME_MS);
    expect(stopOf(actions)?.discard).toBe(false);
  });

  it('used to cut that part off after the loud word and throw it away (one cutoff for everything)', () => {
    const actions = run([...frames(0.2, 0.3), ...frames(2, 0.07), ...frames(1.5, 0.01)], { sustainMultiplier: 1 });
    expect(actions.map((a) => a.action.type)).toEqual(['start', 'stop']);
    expect(actions[1]!.at * FRAME_MS).toBeLessThan(200 + 1000 + 2 * FRAME_MS);
    expect(stopOf(actions)?.discard).toBe(true);
  });

  it('still throws away a bump: too little sound above half the cutoff', () => {
    const stop = stopOf(run([...frames(0.1, 0.5), ...frames(1.5, 0.01)]));
    expect(stop?.discard).toBe(true);
  });

  it('ends a part after the pause once the voice falls below half the cutoff', () => {
    const actions = run([...frames(1, 0.3), ...frames(2, 0.04)]);
    const stopAt = actions.find((a) => a.action.type === 'stop')!.at * FRAME_MS;
    expect(stopAt).toBeGreaterThanOrEqual(1000 + 1000 - FRAME_MS);
    expect(stopAt).toBeLessThan(1000 + 1000 + 2 * FRAME_MS);
    expect(stopOf(actions)).toMatchObject({ discard: false, rewindMs: 500 });
  });

  it('starts a part with a head start of whole frames', () => {
    const start = run([...frames(1, 0.01), ...frames(1, 0.3)]).find((a) => a.action.type === 'start')!.action;
    expect(start).toEqual({ type: 'start', prerollMs: 250 });
    expect(prerollFrames(250)).toBe(5);
  });
});
