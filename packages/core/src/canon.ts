import { BIBLE_BOOKS } from './catalogData';

/**
 * The canon for the Map (J-MAP-2, J-MAP-3). Real projects cover a whole
 * Bible (1,189 chapters), so the Map navigates testament → book → chapter
 * and search forgives abbreviations: "luk 15", "1 cor", "ps 23".
 * Ported from the reference's canon.ts; the book list is our catalog's, so
 * a unit a template created always resolves to a book here. Pure.
 */

export type Testament = 'OT' | 'NT';

export interface CanonBook {
  /** The catalog item id ("luk"): template units and dynamic passages use it. */
  id: string;
  name: string;
  /** Other names a label may use ("Psalm 23" for Psalms). */
  aliases: string[];
  chapters: number;
  testament: Testament;
  group: string;
}

// Book index ranges of each group, in canon order (39 OT books, 27 NT).
const GROUPS: [number, string][] = [
  [0, 'Law'], [5, 'History'], [17, 'Poetry & Wisdom'], [22, 'Prophets'], [39, 'Gospels & Acts'], [44, 'Letters']
];
const ALIASES: Record<string, string[]> = { psa: ['Psalm'], sng: ['Song of Songs'] };

export const CANON: CanonBook[] = BIBLE_BOOKS.map((b, i) => ({
  id: b.itemId,
  name: b.label,
  aliases: ALIASES[b.itemId] ?? [],
  chapters: b.verses.length,
  testament: i < 39 ? 'OT' : 'NT',
  group: GROUPS.filter(([from]) => i >= from).pop()![1]
}));

const BY_ID = new Map(CANON.map((b) => [b.id, b]));
// Longest names first, so "1 John 3" finds 1 John before John could.
const NAMES = CANON.flatMap((b) => [b.name, ...b.aliases].map((n) => ({ n: n.toLowerCase(), b })))
  .sort((a, b) => b.n.length - a.n.length);

export function canonBook(id: string): CanonBook | undefined {
  return BY_ID.get(id);
}

/** Canon position for sorting; unknown books sort last. */
export function canonIndex(id: string): number {
  const i = CANON.findIndex((b) => b.id === id);
  return i < 0 ? CANON.length : i;
}

/**
 * The book and chapters a passage label names: "Luke 15" → Luke [15],
 * "Genesis 1:1-2:3" → Genesis [1, 2], "Luke 15:1–7" → Luke [15], "Luke" →
 * Luke [] (the whole book). Null when the label names no canon book.
 */
export function locateLabel(label: string): { book: CanonBook; chapters: number[] } | null {
  const l = label.trim().toLowerCase().replace(/\s+/g, ' ');
  const hit = NAMES.find(({ n }) => l.startsWith(n) && (l.length === n.length || l[n.length] === ' '));
  if (!hit) return null;
  return { book: hit.b, chapters: chaptersIn(l.slice(hit.n.length).trim(), hit.b.chapters) };
}

/** "15" → [15]; "1:1-2:3" → [1, 2]; "15:1-10" → [15]; "3-5" → [3, 4, 5]. Clamped to the book. */
function chaptersIn(ref: string, max: number): number[] {
  const m = /^(\d+)(:\d+)?(?:\s*[-–]\s*(\d+)(:\d+)?)?/.exec(ref);
  if (!m) return [];
  const from = Number(m[1]);
  // "15:1-10": the 10 is a verse. "1:1-2:3" and "3-5": the end is a chapter.
  const to = m[3] === undefined ? from : m[2] && !m[4] ? from : Number(m[3]);
  const out: number[] = [];
  for (let c = Math.max(1, from); c <= Math.min(max, to); c++) out.push(c);
  return out;
}

/** Splits a search into a book prefix and an optional chapter: "1 cor 13:4" → { book: "1 cor", chapter: 13 }. */
export function parseQuery(query: string): { book: string; chapter?: number } {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = /^(.*?)\s*(\d+)?(?::\d*)?$/.exec(q);
  const book = (m?.[1] ?? q).trim();
  return m?.[2] ? { book, chapter: Number(m[2]) } : { book };
}

/** A book name starts with the prefix, with or without its leading number ("cor" finds 1 and 2 Corinthians). */
export function bookMatches(b: CanonBook, prefix: string): boolean {
  if (!prefix) return true;
  return [b.name, ...b.aliases].map((n) => n.toLowerCase())
    .some((n) => n.startsWith(prefix) || n.replace(/^\d /, '').startsWith(prefix));
}

/** "luk 15", "Luke 15:3", "1 cor" all find a passage labelled "Luke 15:1-7" or "1 Corinthians 13". */
export function matchesQuery(label: string, query: string): boolean {
  if (!query.trim()) return false;
  const at = locateLabel(label);
  if (!at) return false;
  const { book, chapter } = parseQuery(query);
  if (!bookMatches(at.book, book)) return false;
  return chapter === undefined || at.chapters.includes(chapter);
}
