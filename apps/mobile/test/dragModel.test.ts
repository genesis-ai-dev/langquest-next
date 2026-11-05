import { dropPlan, edgeSpeed, partIndexAfter } from '../src/recording/dragModel';

const rows = [
  { key: 'a', y: 0, h: 64 },
  { key: 'b', y: 64, h: 64 },
  { key: 'gap', y: 128, h: 64 },
  { key: 'c', y: 192, h: 64 }
];

describe('dragging a part by its grip (Caleb, 2026-10-16)', () => {
  it('stays put until its edge passes the middle of the next row', () => {
    expect(dropPlan(rows, 'a', 31)!.to).toBe(0);
    expect(dropPlan(rows, 'a', 33)!.to).toBe(1);
  });

  it('moves the rows it passes out of the way by its height', () => {
    const plan = dropPlan(rows, 'a', 110)!;
    expect(plan.to).toBe(2);
    expect([...plan.shift]).toEqual([['b', -64], ['gap', -64]]);
    const up = dropPlan(rows, 'c', -170)!;
    expect(up.to).toBe(0);
    expect([...up.shift]).toEqual([['gap', 64], ['b', 64], ['a', 64]]);
  });

  it('lands at the end when dragged past the last row', () => {
    expect(dropPlan(rows, 'a', 900)!.to).toBe(3);
    expect(dropPlan(rows, 'zzz', 0)).toBeNull();
  });

  it('counts only parts for the place in the list', () => {
    // Why: a gap is a row on the card, not a part in the list being reordered.
    const isPart = [true, true, false, true];
    expect(partIndexAfter(isPart, 0, 2)).toBe(1);
    expect(partIndexAfter(isPart, 0, 3)).toBe(2);
    expect(partIndexAfter(isPart, 3, 0)).toBe(0);
    expect(partIndexAfter(isPart, 3, 2)).toBe(2);
  });

  it('scrolls faster the nearer the finger is to an edge, and not at all in the middle or in a short list', () => {
    expect(edgeSpeed(300, 0, 600)).toBe(0);
    expect(edgeSpeed(0, 0, 600)).toBe(-14);
    expect(edgeSpeed(28, 0, 600)).toBe(-7);
    expect(edgeSpeed(600, 0, 600)).toBe(14);
    expect(edgeSpeed(0, 0, 100)).toBe(0);
  });
});
