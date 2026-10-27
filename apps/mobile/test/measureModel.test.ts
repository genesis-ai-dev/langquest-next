import { describe, expect, it } from 'vitest';
import { MEASURE_IDLE_MS, MEASURE_MOVING_MS, MEASURE_SETTLE_MS, measureDue } from '../src/helpMode/measureModel';

// Help mode measures its lit parts (helpMode.tsx) at a pace, not per frame.
describe('when help mode measures (measureModel.ts)', () => {
  it('measures about ten times a second while parts move, and no more', () => {
    let last = -Infinity, rounds = 0;
    // Something moves all the time, on a 60 Hz clock.
    for (let now = 0; now < 5000; now += 1000 / 60) if (measureDue(now, last, now)) { last = now; rounds++; }
    expect(rounds / 5).toBeLessThanOrEqual(10.5);
    expect(rounds / 5).toBeGreaterThan(7);
  });
  it('slows down once nothing has moved for a second, and speeds up again at the next move', () => {
    let last = 0, rounds = 0;
    for (let now = 0; now < 10_000; now += 1000 / 60) if (measureDue(now, last, 0)) { last = now; rounds++; }
    // One second at ten a second, then nine at a third of that.
    expect(rounds).toBeLessThan(MEASURE_SETTLE_MS / MEASURE_MOVING_MS + 9_000 / MEASURE_IDLE_MS + 3);
    expect(measureDue(20_000 + MEASURE_IDLE_MS - 1, 20_000, 0)).toBe(false);
    expect(measureDue(20_000 + MEASURE_MOVING_MS, 20_000, 20_000)).toBe(true);
  });
  it('measures at once the first time, and after the clock steps back', () => {
    expect(measureDue(5, -Infinity, 0)).toBe(true);
    expect(measureDue(100, 5000, 100)).toBe(true);
  });
});
