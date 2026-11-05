// Dragging a part up or down the parts card by its grip (Caleb, 2026-10-16):
// where a row dragged this far lands, how far the rows it passes move to
// make room, and which place in the list of parts that is. Pure, so the rules
// are tested in test/dragModel.test.ts; useDragRows.ts carries the finger.

/** A row as laid out in its list: its key, its top and its height. */
export interface RowBox { key: string; y: number; h: number }

export interface DropPlan {
  /** The dragged row's place among the rows, and where it lands. */
  from: number;
  to: number;
  /** How far each row it passes moves (the dragged row's height, up or down). */
  shift: Map<string, number>;
}

/**
 * Where the row `key`, moved `dy` from where it was laid out, lands: past
 * every row whose middle its leading edge has crossed (its bottom going
 * down, its top going up). Those rows move by its height the other way, so
 * the place it will take opens under the finger.
 */
export function dropPlan(rows: readonly RowBox[], key: string, dy: number): DropPlan | null {
  const sorted = [...rows].sort((a, b) => a.y - b.y);
  const from = sorted.findIndex((r) => r.key === key);
  if (from < 0) return null;
  const me = sorted[from]!;
  const top = me.y + dy;
  const bottom = top + me.h;
  const shift = new Map<string, number>();
  let to = from;
  for (let j = from + 1; j < sorted.length; j++) {
    const r = sorted[j]!;
    if (dy <= 0 || bottom <= r.y + r.h / 2) break;
    shift.set(r.key, -me.h);
    to = j;
  }
  for (let j = from - 1; j >= 0; j--) {
    const r = sorted[j]!;
    if (dy >= 0 || top >= r.y + r.h / 2) break;
    shift.set(r.key, me.h);
    to = j;
  }
  return { from, to, shift };
}

/**
 * The dragged part's place in the list of parts once dropped: the parts
 * above it among the rows in their new order (gaps are rows too, but not
 * parts).
 */
export function partIndexAfter(rowIsPart: readonly boolean[], from: number, to: number): number {
  const order = rowIsPart.map((part, i) => ({ part, i }));
  const [moved] = order.splice(from, 1);
  if (!moved) return 0;
  order.splice(to, 0, moved);
  let n = 0;
  for (const r of order) {
    if (r === moved) return n;
    if (r.part) n++;
  }
  return n;
}

/** How fast the list scrolls while a dragged row is held near its top or bottom edge, in points per frame: faster nearer the edge. */
export function edgeSpeed(fingerY: number, top: number, bottom: number, zone = 56, max = 14): number {
  if (bottom - top < zone * 3) return 0;
  if (fingerY < top + zone) return -Math.ceil(max * Math.min(1, (top + zone - fingerY) / zone));
  if (fingerY > bottom - zone) return Math.ceil(max * Math.min(1, (fingerY - (bottom - zone)) / zone));
  return 0;
}
