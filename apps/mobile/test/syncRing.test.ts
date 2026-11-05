import { describe, expect, it } from 'vitest';
import { CAP, IDLE, MAX_LAP, paceRing, ringOpacity, startPace, stepRing, type RingInput, type RingPace, type RingState } from '../src/sync/syncRing';

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

  // The ring's clock (decision 105's audit, 2026-10-15): React draws the ring
  // only when it looks different, not on every frame, and the clock slows
  // while nothing visible moves. A long upload used to redraw ~60 times a second.
  describe('its clock', () => {
    /** Run the clock as the indicator does: a frame when it asks for one, else after the delay it names. */
    function clock(p: RingPace, seconds: number, input: RingInput, out: { ticks: number; draws: number; drawn: RingState[] }): RingPace {
      for (let t = 0; t < seconds;) {
        if (out.ticks > 0 && p.nextMs < 0) break; // the indicator stops its clock here
        const dt = out.ticks === 0 || p.nextMs === 0 ? 1 / 60 : p.nextMs / 1000;
        t += dt;
        const r = paceRing(p, dt, input);
        out.ticks++;
        if (r.draw) { out.draws++; out.drawn.push(r.pace.drawn); }
        p = r.pace;
      }
      return p;
    }
    const counts = () => ({ ticks: 0, draws: 0, drawn: [] as RingState[] });

    it('draws rarely while an upload stalls, instead of every frame', () => {
      const out = counts();
      let p = clock(startPace(IDLE), 10, { pending: 40, peak: 40 }, counts()); // laps settle
      p = clock(p, 60, { pending: 40, peak: 40 }, out); // a minute stalled at the heaviest lap
      expect(p.ring.lap).toBe(MAX_LAP);
      expect(out.draws).toBeLessThan(60); // under one a second (it was ~3600)
      expect(out.ticks).toBeLessThan(60 * 6); // the clock rests between looks, too
    });

    it('still moves visibly while work is under way: at most 20 draws a second', () => {
      const out = counts();
      clock(startPace(IDLE), 3, { pending: 10, peak: 10 }, out);
      expect(out.draws).toBeGreaterThan(15);
      expect(out.draws).toBeLessThanOrEqual(3 * 20 + 2);
    });

    it('draws a new count or lap at once', () => {
      let p = clock(startPace(IDLE), 1, { pending: 10, peak: 10 }, counts());
      const r = paceRing(p, 1 / 60, { pending: 11, peak: 11 });
      expect(r.draw).toBe(true);
      expect(r.pace.drawn.count).toBe(11);
      p = r.pace;
    });

    it('runs out, holds, fades and rests as before, and then stops ticking', () => {
      const out = counts();
      let p = clock(startPace(IDLE), 2, { pending: 3, peak: 3 }, counts());
      p = clock(p, 2, { pending: 0, peak: 0 }, out);
      expect(out.drawn.some((d) => d.phase === 'done' && d.shown === 1)).toBe(true);
      expect(p.drawn).toEqual(IDLE);
      expect(p.nextMs).toBe(-1);
    });

    it('never draws the ring going backward within a lap', () => {
      const out = counts();
      let p = clock(startPace(IDLE), 1, { pending: 10, peak: 10 }, out);
      p = clock(p, 1, { pending: 2, peak: 10 }, out);
      clock(p, 1, { pending: 6, peak: 10 }, out);
      for (let i = 1; i < out.drawn.length; i++) {
        if (out.drawn[i]!.lap === out.drawn[i - 1]!.lap && out.drawn[i]!.phase === 'busy') expect(out.drawn[i]!.shown).toBeGreaterThanOrEqual(out.drawn[i - 1]!.shown);
      }
    });
  });
});
