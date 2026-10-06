// Which verses a unit covers, read from its label ("Luke 15:11-32",
// "Genesis 1:1-2:3", "Luke 15") and core's `unitPlace` for the book. Study
// guides and passage text are matched to units by book and verse overlap
// (STUDY-1, STUDY-5), so a chapter unit, a FIA pericope and a hand-added
// passage all find the same material. Pure: no I/O.
import { unitPlace, type PartitionState } from '@langquest-next/core';

export interface VerseRange {
  /** Core's book id ("gen", "luk", "joh"). */
  book: string;
  start: { chapter: number; verse: number };
  /** `verse: null` runs to the end of the chapter. */
  end: { chapter: number; verse: number | null };
}

const RANGE = /^(\d+)(?::(\d+))?(?:\s*[–-]\s*(?:(\d+):)?(\d+))?$/;

/** "15:11-32", "1:1-2:3", "15", "14-16" (chapters), "15:11" after the book's name; null when it is not a reference. */
export function parseRange(book: string, ref: string): VerseRange | null {
  const m = RANGE.exec(ref.trim());
  if (!m) return null;
  const c1 = Number(m[1]);
  if (m[2] === undefined) {
    // Whole chapters: "15" or "14-16".
    if (m[3] !== undefined) return null;
    const c2 = m[4] !== undefined ? Number(m[4]) : c1;
    return c2 < c1 ? null : { book, start: { chapter: c1, verse: 1 }, end: { chapter: c2, verse: null } };
  }
  const v1 = Number(m[2]);
  if (m[4] === undefined) return { book, start: { chapter: c1, verse: v1 }, end: { chapter: c1, verse: v1 } };
  const c2 = m[3] !== undefined ? Number(m[3]) : c1;
  const v2 = Number(m[4]);
  if (c2 < c1 || (c2 === c1 && v2 < v1)) return null;
  return { book, start: { chapter: c1, verse: v1 }, end: { chapter: c2, verse: v2 } };
}

const cache = new Map<string, VerseRange | null>();

/** The verses a unit covers; null for a whole book or a label that names no chapter. */
export function unitRange(state: PartitionState, unitId: string): VerseRange | null {
  const label = state.units[unitId]?.label ?? '';
  const key = `${unitId}\u0000${label}`;
  if (cache.has(key)) return cache.get(key)!;
  const place = unitPlace(state, unitId);
  let out: VerseRange | null = null;
  if (place.bookId && label.startsWith(`${place.bookLabel} `)) {
    out = parseRange(place.bookId, label.slice(place.bookLabel.length + 1));
  }
  cache.set(key, out);
  return out;
}

const pos = (chapter: number, verse: number | null) => chapter * 1000 + (verse ?? 999);

/** How many verse positions two ranges share (0 when none, or different books). Open chapter ends count as 999. */
export function overlap(a: VerseRange, b: VerseRange): number {
  if (a.book !== b.book) return 0;
  const lo = Math.max(pos(a.start.chapter, a.start.verse), pos(b.start.chapter, b.start.verse));
  const hi = Math.min(pos(a.end.chapter, a.end.verse), pos(b.end.chapter, b.end.verse));
  return hi >= lo ? hi - lo + 1 : 0;
}

/**
 * Every verse in a range, chapter by chapter. `versesIn(chapter)` says how
 * long a chapter is; null when a chapter the range runs to the end of is not known.
 */
export function versesOf(r: VerseRange, versesIn: (chapter: number) => number | undefined): { chapter: number; verse: number }[] | null {
  const out: { chapter: number; verse: number }[] = [];
  for (let c = r.start.chapter; c <= r.end.chapter; c++) {
    const first = c === r.start.chapter ? r.start.verse : 1;
    const endVerse = c === r.end.chapter ? r.end.verse : null;
    const last = endVerse ?? versesIn(c);
    if (last === undefined) return null;
    for (let v = first; v <= last; v++) out.push({ chapter: c, verse: v });
  }
  return out;
}
