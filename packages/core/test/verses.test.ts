import { describe, expect, it } from 'vitest';
import { derivePartVerses, markForSpan, settlePartMarks, skippedVerses, tapPart, type PartMark } from '../src/verses';
import { validateEvent } from '../src/validate';
import type { AnyEvent } from '../src/events';

// Seven verses (Luke 15:1-7): indexes 0..6.
const N = 7;
const show = (marks: readonly PartMark[]) =>
  derivePartVerses(marks, N).labels.map((l) => (l ? `${l.kind === 'join' ? '+' : ''}${l.s + 1}${l.e > l.s ? `-${l.e + 1}` : ''}` : '_')).join(' ');
const tapAll = (marks: PartMark[], order: number[]) => {
  let m = marks;
  for (const i of order) {
    const t = tapPart(m, i, N);
    if (t.ok) m = t.marks;
  }
  return m;
};

describe('tapping the space beside a part (decisions.md 82)', () => {
  it('numbers parts in order, and parts tapped first move down when one above is tapped', () => {
    const empty: PartMark[] = Array(5).fill(null);
    expect(show(tapAll(empty, [2]))).toBe('_ _ 1 _ _');
    expect(show(tapAll(empty, [2, 3]))).toBe('_ _ 1 2 _');
    expect(show(tapAll(empty, [2, 3, 0]))).toBe('1 _ 2 3 _');
    expect(show(tapAll(empty, [2, 3, 0, 1]))).toBe('1 2 3 4 _');
  });

  it('a tapped number joins the verse above, and a second tap splits it out again', () => {
    const m = tapAll(Array(4).fill(null), [0, 1, 2, 3]);
    const joined = tapAll(m, [2]);
    expect(show(joined)).toBe('1 2 +2 3');
    expect(show(tapAll(joined, [2]))).toBe('1 2 3 4');
  });

  it('joins the verse above when there is no next verse left', () => {
    const m = tapAll(Array(9).fill(null), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(show(m)).toBe('1 2 3 4 5 6 7 +7 +7');
  });

  it('refuses rather than breaking the order', () => {
    const first = tapAll([null, null], [0]);
    const t = tapPart(first, 0, N);
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.why).toBe('nothingToJoin');
  });

  it('a chosen verse stays put, leaves a gap, and the parts after it follow on', () => {
    const m: PartMark[] = [{ t: 'next' }, { t: 'set', s: 3, e: 3 }, { t: 'next' }];
    expect(show(m)).toBe('1 4 5');
    expect(skippedVerses(derivePartVerses(m, N).labels)).toEqual([{ s: 1, e: 2, before: 1 }]);
  });

  it('settling a choice empties the parts that no longer fit', () => {
    const m = tapAll(Array(5).fill(null), [0, 1, 2, 3, 4]);
    const st = settlePartMarks([...m.slice(0, 2), { t: 'set', s: 5, e: 6 }, ...m.slice(3)], 2, N);
    expect(st && show(st.marks)).toBe('1 2 6-7 _ _');
    expect(st?.cleared).toEqual([3, 4]);
  });

  it('a chosen span equal to the part right above becomes a join', () => {
    const m = tapAll(Array(3).fill(null), [0, 1]);
    expect(markForSpan(m, 2, 1, 1, N)).toEqual({ t: 'join' });
    expect(markForSpan(m, 2, 2, 3, N)).toEqual({ t: 'set', s: 2, e: 3 });
  });
});

describe('v1.CardVerseSet validation', () => {
  const ev = (payload: Record<string, unknown>) => ({ id: 'e', type: 'v1.CardVerseSet', orgId: 'o', streamId: 'l', actorId: 'a', deviceId: 'd', hlc: '0', payload }) as unknown as AnyEvent;
  it('accepts the marks and checks chosen verses', () => {
    expect(validateEvent(ev({ unitId: 'u', hash: 'h', mark: 'next' }))).toBeNull();
    expect(validateEvent(ev({ unitId: 'u', hash: 'h', mark: 'set', from: '1:31', to: '2:3' }))).toBeNull();
    expect(validateEvent(ev({ unitId: 'u', hash: 'h', mark: 'set', from: '2:3', to: '1:31' }))).toMatch(/must not come after/);
    expect(validateEvent(ev({ unitId: 'u', hash: 'h', mark: 'set', from: '4' }))).toMatch(/chapter:verse/);
    expect(validateEvent(ev({ unitId: 'u', hash: 'h', mark: 'join', from: '1:1' }))).toMatch(/set only/);
    expect(validateEvent(ev({ unitId: 'u', hash: 'h', mark: 'maybe' }))).toMatch(/mark must be one of/);
  });
});
