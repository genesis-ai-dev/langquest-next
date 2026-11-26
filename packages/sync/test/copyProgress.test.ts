import fc from 'fast-check';
import { CopyTally } from '../src/nearbyCopy';

/**
 * The inviter's estimate of how far a starting copy has gone, for Let someone in's bar
 * (2026-11-25). Why these tests: the inviter sees only the asks it answers, so it counts against
 * what a newcomer with nothing asks for, guessing the length of what has not gone. The bar must
 * never claim more than went, must end at the whole once everything went, and a part asked again
 * after a dropped page must not count twice.
 */

const units = (rows: Record<string, number>) => new Map(Object.entries(rows));

describe('how far a starting copy has gone', () => {
  it('says nothing until it knows what a newcomer asks for', () => {
    const t = new CopyTally();
    t.part('state:lang', 0, 100, true);
    expect(t.progress()).toBeNull();
    t.planned(units({}), new Set());
    expect(t.progress()).toEqual({ sent: 100, total: 100 });
  });

  it('guesses what has not gone, then takes the average of what went', () => {
    const t = new CopyTally();
    t.planned(units({ p1: 10, p2: 10 }), new Set(['d1', 'd2']));
    // 20 rows at 500 characters and two documents at 40,000 before any went.
    expect(t.progress()).toEqual({ sent: 0, total: 20 * 500 + 2 * 40_000 });
    t.part('rows:p1', 0, 2_000, true);
    // A passage of 10 rows took 2,000 characters: the other is guessed at the same.
    expect(t.progress()).toEqual({ sent: 2_000, total: 2_000 + 2_000 + 2 * 40_000 });
    t.part('doc:d1', 0, 1_000, true);
    expect(t.progress()).toEqual({ sent: 3_000, total: 2_000 + 2_000 + 1_000 + 1_000 });
  });

  it('counts an item under way by its built length, else by what went of it or its guess', () => {
    const t = new CopyTally();
    t.planned(units({ p1: 4 }), new Set(['d1']));
    t.part('doc:d1', 0, 50_000, false);
    // More went than the guess: the item counts what went.
    expect(t.progress()).toEqual({ sent: 50_000, total: 50_000 + 4 * 500 });
    t.size('rows:p1', 9_000);
    expect(t.progress()).toEqual({ sent: 50_000, total: 50_000 + 9_000 });
  });

  it('counts a part asked again once, and nothing of an item that already went', () => {
    const t = new CopyTally();
    t.planned(units({ p1: 2 }), new Set());
    t.part('rows:p1', 0, 600, false);
    t.part('rows:p1', 0, 600, false);
    t.part('rows:p1', 600, 400, true);
    t.part('rows:p1', 0, 600, false);
    expect(t.progress()).toEqual({ sent: 1_000, total: 1_000 });
  });

  it('counts what went before the plan was known against it once it is', () => {
    const t = new CopyTally();
    t.part('rows:p1', 0, 3_000, true);
    t.part('doc:d1', 0, 500, false);
    t.planned(units({ p1: 6, p2: 6 }), new Set(['d1', 'd2']));
    // p2 at p1's average; d1 under way at its guess; d2 at the guess too, no document having finished.
    expect(t.progress()).toEqual({ sent: 3_500, total: 3_000 + 3_000 + 40_000 + 40_000 });
  });

  const plan = fc.record({
    passages: fc.array(fc.record({ rows: fc.nat({ max: 40 }), chars: fc.integer({ min: 2, max: 30_000 }) }), { maxLength: 12 }),
    docs: fc.array(fc.integer({ min: 2, max: 200_000 }), { maxLength: 12 }),
    // A few items off the plan: the states, names, the held list.
    extras: fc.array(fc.integer({ min: 2, max: 5_000 }), { maxLength: 4 })
  });

  it('never says more went than the total, never goes back on what went, and ends at the whole', () => {
    fc.assert(fc.property(plan, fc.nat(), fc.integer({ min: 1, max: 9_000 }), fc.boolean(), (p, seed, partChars, planFirst) => {
      const t = new CopyTally();
      const items = [
        ...p.passages.map((x, i) => ({ key: `rows:p${i}`, chars: x.chars })),
        ...p.docs.map((chars, i) => ({ key: `doc:d${i}`, chars })),
        ...p.extras.map((chars, i) => ({ key: `extra${i}`, chars }))
      ];
      const doPlan = () => t.planned(new Map(p.passages.map((x, i) => [`p${i}`, x.rows])), new Set(p.docs.map((_, i) => `d${i}`)));
      if (planFirst) doPlan();
      // Every item in parts, interleaved by the seed, with now and then a part asked again.
      const at = new Map(items.map((x) => [x.key, 0]));
      let lastSent = 0;
      let n = seed;
      for (let left = items.filter((x) => x.chars > 0); left.length > 0; left = left.filter((x) => at.get(x.key)! < x.chars)) {
        const item = left[n % left.length]!;
        n = (n * 7 + 3) % 1_000_003;
        const start = at.get(item.key)!;
        const again = n % 5 === 0 && start > 0;
        const from = again ? 0 : start;
        // At most about 20 parts an item, as a sender's parts are large: a long document a character at a time takes too long.
        const chars = Math.min(Math.max(partChars, Math.ceil(item.chars / 20)), item.chars - from);
        if (n % 3 === 0) t.size(item.key, item.chars);
        t.part(item.key, from, chars, from + chars === item.chars);
        if (!again) at.set(item.key, from + chars);
        const got = t.progress();
        if (got) {
          expect(got.sent).toBeLessThanOrEqual(got.total);
          expect(got.sent).toBeGreaterThanOrEqual(lastSent);
          lastSent = got.sent;
        }
      }
      if (!planFirst) doPlan();
      const whole = items.reduce((s, x) => s + x.chars, 0);
      expect(t.progress()).toEqual({ sent: whole, total: whole });
    }), { numRuns: 300 });
  });
});
