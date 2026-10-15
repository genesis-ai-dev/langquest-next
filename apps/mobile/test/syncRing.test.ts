import { describe, expect, it } from 'vitest';
import { CAP, IDLE, MAX_LAP, ringOpacity, stepRing, type RingInput, type RingState } from '../src/syncRing';

function run(s: RingState, seconds: number, input: RingInput, trace?: RingState[]): RingState {
  for (let t = 0; t < seconds; t += 1 / 60) { s = stepRing(s, 1 / 60, input); trace?.push(s); }
  return s;
}

describe('header sync ring', () => {
  it('never moves backward within a lap, so it never looks like work was lost', () => {
    const trace: RingState[] = [];
    let s = run(IDLE, 1, { pending: 10, peak: 10 }, trace);
    s = run(s, 1, { pending: 2, peak: 10 }, trace);
    run(s, 1, { pending: 6, peak: 10 }, trace); // more arrives; the ring must not shrink
    for (let i = 1; i < trace.length; i++) {
      if (trace[i]!.lap === trace[i - 1]!.lap) expect(trace[i]!.shown).toBeGreaterThanOrEqual(trace[i - 1]!.shown);
    }
  });

  it('does not look finished while anything is still waiting', () => {
    const s = run(IDLE, 1.5, { pending: 5, peak: 5 });
    expect(s.phase).toBe('busy');
    expect(s.shown).toBeLessThanOrEqual(CAP);
  });

  it('runs to full fast once the queue empties, then returns to the plain icon', () => {
    let s = run(IDLE, 1, { pending: 3, peak: 3 });
    s = run(s, 0.3, { pending: 0, peak: 0 });
    expect(s.phase).toBe('done');
    expect(s.shown).toBe(1);
    s = run(s, 1, { pending: 0, peak: 0 });
    expect(s).toEqual(IDLE);
    expect(ringOpacity(s)).toBe(0);
  });

  it('adds heavier laps on a long upload, but stops adding at the heaviest', () => {
    const s = run(IDLE, 60, { pending: 50, peak: 50 });
    expect(s.lap).toBe(MAX_LAP);
    expect(s.phase).toBe('busy');
  });

  it('counts down toward what is left, quickly even when everything lands at once', () => {
    let s = run(IDLE, 0.1, { pending: 200, peak: 200 });
    expect(s.count).toBe(200);
    s = stepRing(s, 1 / 60, { pending: 0, peak: 0 });
    expect(s.count).toBeGreaterThan(0); // depletes visibly rather than snapping
    s = run(s, 0.6, { pending: 0, peak: 0 });
    expect(s.count).toBe(0);
  });
});
