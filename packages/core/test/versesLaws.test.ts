import fc from 'fast-check';
import type { AnyEvent } from '../src/events';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import {
  cardVerseEvents, derivePartVerses, markForSpan, partMarksFor, settlePartMarks, skippedVerses, tapPart, versesStillToLabel,
  type PartMark,
} from '../src/verses';

/**
 * Laws of the verse labels (decisions.md 82): whatever someone taps or chooses,
 * the labels down the list stay inside the passage, in order, with no overlap
 * (a join repeats the part above on purpose).
 */

const markArb = (count: number): fc.Arbitrary<PartMark> =>
  fc.oneof(
    { weight: 2, arbitrary: fc.constant(null) },
    { weight: 3, arbitrary: fc.constant({ t: 'next' } as PartMark) },
    { weight: 2, arbitrary: fc.constant({ t: 'join' } as PartMark) },
    { weight: 2, arbitrary: fc.tuple(fc.nat(count - 1), fc.nat(count - 1)).map(([a, b]) => ({ t: 'set', s: Math.min(a, b), e: Math.max(a, b) }) as PartMark) },
  );
const listArb = fc.integer({ min: 1, max: 12 }).chain((count) =>
  fc.record({ count: fc.constant(count), marks: fc.array(markArb(count), { maxLength: 14 }) }));

describe('part verse labels', () => {
  it('when the order holds, labels stay inside the passage and never overlap (a join repeats the part above)', () => {
    fc.assert(
      fc.property(listArb, ({ count, marks }) => {
        const d = derivePartVerses(marks, count);
        expect(d.labels).toHaveLength(marks.length);
        if (!d.ok) {
          expect(d.bad).toBeGreaterThanOrEqual(0);
          expect(d.bad).toBeLessThan(marks.length);
          return;
        }
        expect(d.bad).toBe(-1);
        let prev: { s: number; e: number } | null = null;
        for (const l of d.labels) {
          if (!l) continue;
          expect(l.s).toBeGreaterThanOrEqual(0);
          expect(l.e).toBeLessThan(count);
          expect(l.s).toBeLessThanOrEqual(l.e);
          if (prev) {
            if (l.kind === 'join') expect([l.s, l.e]).toEqual([prev.s, prev.e]);
            else expect(l.s).toBeGreaterThan(prev.e);
          }
          prev = l;
        }
      }),
      { numRuns: 300 },
    );
  });

  it('labelled verses, passed-over verses and the verses still to label cover 1..count exactly once', () => {
    fc.assert(
      fc.property(listArb, ({ count, marks }) => {
        const d = derivePartVerses(marks, count);
        fc.pre(d.ok);
        const seen = new Array<number>(count).fill(0);
        for (const l of d.labels) if (l && l.kind !== 'join') for (let v = l.s; v <= l.e; v++) seen[v]!++;
        for (const g of skippedVerses(d.labels)) {
          expect(g.s).toBeLessThanOrEqual(g.e);
          expect(g.before).toBeGreaterThanOrEqual(0);
          expect(d.labels[g.before]).not.toBeNull();
          for (let v = g.s; v <= g.e; v++) seen[v]!++;
        }
        const rest = versesStillToLabel(d.labels, count);
        if (rest) for (let v = rest.s; v <= rest.e; v++) seen[v]!++;
        expect(seen).toEqual(new Array(count).fill(1));
      }),
      { numRuns: 300 },
    );
  });

  it('a tap that is allowed always leaves a legal list, and one that is refused says why and changes nothing', () => {
    fc.assert(
      fc.property(listArb, fc.nat(13), ({ count, marks }, at) => {
        fc.pre(derivePartVerses(marks, count).ok && marks.length > 0);
        const i = at % marks.length;
        const t = tapPart(marks, i, count);
        if (t.ok) {
          const d = derivePartVerses(t.marks, count);
          expect(d.ok).toBe(true);
          expect(d.labels).toEqual(t.labels);
          t.marks.forEach((m, j) => { if (j !== i) expect(m).toEqual(marks[j]); }); // only the tapped part moves
        } else {
          expect(['start', 'nothingToJoin', 'gapAbove', 'noRoom']).toContain(t.why);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('settling a choice keeps the choice, clears only parts after it, and leaves a legal list', () => {
    fc.assert(
      fc.property(listArb, fc.nat(13), ({ count, marks }, at) => {
        fc.pre(marks.length > 0);
        const keep = at % marks.length;
        const r = settlePartMarks(marks, keep, count);
        if (!r) return;
        expect(derivePartVerses(r.marks, count).ok).toBe(true);
        expect(r.marks[keep]).toEqual(marks[keep]);
        marks.forEach((m, j) => {
          if (r.cleared.includes(j)) {
            expect(r.marks[j]).toBeNull();
            expect(j).not.toBe(keep);
          } else expect(r.marks[j]).toEqual(m);
        });
        // Nothing needed clearing when the list was already legal.
        if (derivePartVerses(marks, count).ok) expect(r.cleared).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('settling gives up (null) rather than clear the choice itself, when the choice is the one that breaks the order', () => {
    // A set below another set that sits above it: the second cannot stand.
    const marks: PartMark[] = [{ t: 'set', s: 4, e: 5 }, { t: 'set', s: 1, e: 2 }];
    expect(derivePartVerses(marks, 7).bad).toBe(1);
    expect(settlePartMarks(marks, 1, 7)).toBeNull();
    expect(settlePartMarks(marks, 0, 7)?.cleared).toEqual([1]);
  });

  it('versesStillToLabel and skippedVerses on small tables', () => {
    const labels = derivePartVerses([{ t: 'next' }, null, { t: 'set', s: 3, e: 4 }], 7).labels;
    expect(skippedVerses(labels)).toEqual([{ s: 1, e: 2, before: 2 }]);
    expect(versesStillToLabel(labels, 7)).toEqual({ s: 5, e: 6 });
    expect(versesStillToLabel(labels, 5)).toBeNull();
    expect(versesStillToLabel([null, null], 3)).toEqual({ s: 0, e: 2 });
    expect(skippedVerses([null])).toEqual([]);
    // A join never counts as skipping, and a chosen verse above the cursor does not move it back.
    expect(skippedVerses(derivePartVerses([{ t: 'next' }, { t: 'join' }], 3).labels)).toEqual([]);
  });

  it('markForSpan turns exactly the verses of the part above into a join', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9 }), fc.nat(8), fc.nat(8), (count, a, b) => {
        const marks: PartMark[] = [{ t: 'set', s: Math.min(a, b) % count, e: Math.max(a, b) % count }, null];
        fc.pre(marks[0]!.t === 'set' && marks[0]!.s <= marks[0]!.e);
        const above = derivePartVerses(marks, count).labels[0]!;
        expect(markForSpan(marks, 1, above.s, above.e, count)).toEqual({ t: 'join' });
        expect(markForSpan(marks, 1, above.s, above.e + 1, count)).toEqual({ t: 'set', s: above.s, e: above.e + 1 });
        expect(markForSpan(marks, 0, 0, 0, count)).toEqual({ t: 'set', s: 0, e: 0 });
      }),
      { numRuns: 100 },
    );
  });
});

describe('storing marks as v1.CardVerseSet', () => {
  const verses = Array.from({ length: 12 }, (_, i) => `15:${i + 1}`);
  const apply = (state: ReturnType<typeof emptyLanguageState>, specs: ReturnType<typeof cardVerseEvents>, start: number) =>
    foldLanguage(
      specs.map((s, i) => ({ ...s, orgId: 'o', streamId: 'L', actorId: 'a', deviceId: 'd', hlc: `${String(start + i).padStart(15, '0')}:000000:d` }) as AnyEvent),
      state,
    );
  const cards = (n: number) => Array.from({ length: n }, (_, i) => `card${i}`);
  const marksFor = (n: number) => fc.array(markArb(verses.length), { minLength: n, maxLength: n });

  it('what is stored reads back as the same marks, and storing them again writes nothing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }).chain((n) => fc.tuple(fc.constant(n), marksFor(n), marksFor(n))), ([n, first, second]) => {
        const c = cards(n);
        let state = emptyLanguageState();
        const e1 = cardVerseEvents(state, { commandId: 'a', unitId: 'u', cards: c, marks: first, verses });
        state = apply(state, e1, 1);
        expect(partMarksFor(state, 'u', c, verses)).toEqual(first);
        expect(cardVerseEvents(state, { commandId: 'b', unitId: 'u', cards: c, marks: first, verses })).toEqual([]);

        // Changing the marks writes only the cards that changed, and they read back.
        const e2 = cardVerseEvents(state, { commandId: 'c', unitId: 'u', cards: c, marks: second, verses });
        const changed = c.filter((_, i) => JSON.stringify(first[i] ?? null) !== JSON.stringify(second[i] ?? null));
        expect(e2.map((e) => e.payload.hash).sort()).toEqual(changed.sort());
        expect(new Set(e2.map((e) => e.id)).size).toBe(e2.length);
        state = apply(state, e2, 100);
        expect(partMarksFor(state, 'u', c, verses)).toEqual(second);
      }),
      { numRuns: 100 },
    );
  });

  it('a chosen verse the passage no longer has reads as no mark', () => {
    const state = apply(
      emptyLanguageState(),
      cardVerseEvents(emptyLanguageState(), { commandId: 'a', unitId: 'u', cards: ['c'], marks: [{ t: 'set', s: 10, e: 11 }], verses }),
      1,
    );
    expect(partMarksFor(state, 'u', ['c'], verses.slice(0, 5))).toEqual([null]);
    expect(partMarksFor(state, 'other', ['c'], verses)).toEqual([null]);
  });
});
