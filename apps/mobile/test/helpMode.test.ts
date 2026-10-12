// Help mode (demo ADR-038; decision 71 as amended 2026-10-10): what a part
// says when tapped while help is on, how parts are numbered, and where the
// lit places and the tooltip go.
import { describe, expect, it } from 'vitest';
import { clipRect, helpLine, litShape, markAt, numberParts, tooltipPlace, type FirstSeen, type HelpRect } from '../src/helpContext';

const box = (x: number, y: number, width = 100, height = 48): HelpRect => ({ x, y, width, height });

describe('help mode', () => {
  it('says the part and what it does, or just the part', () => {
    expect(helpLine('Something else?', 'Another way forward, less often needed.')).toBe('Something else? Another way forward, less often needed.');
    expect(helpLine('Record', 'The main thing to do on this screen.')).toBe('Record. The main thing to do on this screen.');
    expect(helpLine(' Record ')).toBe('Record');
    expect(helpLine('Publish', '  ')).toBe('Publish');
  });
});

describe('numbering the parts', () => {
  const seen = (entries: [string, number, HelpRect][]): Map<string, FirstSeen> => new Map(entries.map(([k, s, rect]) => [k, { seen: s, rect }]));

  it('reads top to bottom, then along a line', () => {
    const n = numberParts(seen([['start', 0, box(16, 400)], ['bell', 0, box(260, 20)], ['help', 0, box(320, 24)], ['all', 0, box(120, 500)]]));
    expect([...n]).toEqual([['bell', 1], ['help', 2], ['start', 3], ['all', 4]]);
  });

  it('reads along a line from the right in a right-to-left language', () => {
    const n = numberParts(seen([['a', 0, box(16, 100)], ['b', 0, box(200, 104)]]), true);
    expect(n.get('b')).toBe(1);
    expect(n.get('a')).toBe(2);
  });

  it('numbers parts scrolled into view after those on screen, so numbers never move', () => {
    const n = numberParts(seen([['record', 0, box(150, 760)], ['verse 1', 0, box(16, 300)], ['verse 3', 40, box(16, 310)]]));
    expect([...n]).toEqual([['verse 1', 1], ['record', 2], ['verse 3', 3]]);
  });
});

describe('where help draws', () => {
  it('cuts a part to the area it scrolls in, and drops it when it is out of sight', () => {
    const pane = box(0, 100, 390, 300);
    expect(clipRect(box(16, 80, 100, 60), pane)).toEqual({ x: 16, y: 100, width: 100, height: 40 });
    expect(clipRect(box(16, 420), pane)).toBeNull();
    expect(clipRect(box(16, 420), undefined)).toEqual(box(16, 420));
  });

  it('lights a round button as a circle, a row as its own box, anything else a little larger', () => {
    expect(litShape(box(10, 10, 48, 48), 16)).toEqual({ circle: { cx: 34, cy: 34, r: 28 } });
    expect(litShape(box(0, 100, 358, 72), 16, true)).toEqual({ box: { x: 0, y: 100, width: 358, height: 72, r: 0 } });
    expect(litShape(box(16, 400, 358, 56), 16)).toEqual({ box: { x: 12, y: 396, width: 366, height: 64, r: 20 } });
  });

  it('puts the number over the leading top corner, or just inside it', () => {
    expect(markAt(box(16, 400), 'corner')).toEqual({ x: 8, y: 392 });
    expect(markAt(box(16, 400), 'inset')).toEqual({ x: 20, y: 404 });
    expect(markAt(box(16, 400), 'corner', true)).toEqual({ x: 16 + 100 + 8 - 26, y: 392 });
  });

  it('puts the tooltip under the part, above it when there is no room, else at the foot', () => {
    const window = { width: 390, height: 844 };
    const opts = { margin: 16, gap: 8, maxWidth: 420, top: 47, bottom: 34 };
    const under = tooltipPlace(box(16, 200, 358, 56), window, { height: 120 }, opts);
    expect(under).toMatchObject({ x: 16, width: 358, below: true });
    expect(under.y).toBeGreaterThan(256);
    const over = tooltipPlace(box(150, 740, 88, 88), window, { height: 120 }, opts);
    expect(over.below).toBe(false);
    expect(over.y + 120).toBeLessThan(740);
    expect(over.arrowX).toBe(150 + 44 - 16);
    const told = tooltipPlace(null, window, { height: 200 }, opts);
    expect(told).toMatchObject({ below: null, y: 844 - 34 - 200 });
  });
});
