// Reference search over the canon (ng-langquest-ux src/canon.ts), for the
// Map (MAP-1, MAP-4, ADR-009). A whole Bible is about 1,200 passages, so the
// Map is reached by testament, book and chapter, or by typing a reference
// the way people say it: "joh 3", "ps 23", "1 cor 13:4", or "cor" for both
// Corinthians. Pure: the books come from core's Bible template (the same
// BIBLE_BOOKS the units were made from), grouped into the demo's canon
// sections. The Map's filters and chapter colours (MAP-3, MAP-5; demo
// screens/map.tsx) sit at the end, so they can be tested without React.
import { BIBLE_BOOKS } from '@langquest-next/core';

export type Testament = 'ot' | 'nt';

export interface CanonBook {
  /** Core's book id ("luk", "1co"), as `unitPlace(...).bookId` gives it. */
  id: string;
  /** "Psalms" */
  name: string;
  /** Other names people search by ("Psalm", "Song of Songs"). */
  aliases: string[];
  chapters: number;
  testament: Testament;
  /** Canon section: "Law", "Gospels & Acts", ... */
  group: string;
  /** 0..65 in canon order. */
  index: number;
}

/** The demo's canon sections, by the index of the first book in each. */
const GROUPS: { from: number; name: string }[] = [
  { from: 0, name: 'Law' },
  { from: 5, name: 'History' },
  { from: 17, name: 'Poetry & Wisdom' },
  { from: 22, name: 'Prophets' },
  { from: 39, name: 'Gospels & Acts' },
  { from: 44, name: 'Letters' }
];
export const CANON_GROUPS: string[] = GROUPS.map((g) => g.name);

const ALIASES: Record<string, string[]> = {
  psa: ['Psalm'],
  sng: ['Song of Songs']
};

let books: CanonBook[] | null = null;

/** The 66 books in canon order. Built once. */
export function canonBooks(): CanonBook[] {
  if (books) return books;
  // The canon is reference data in core, not a content template: a language's
  // own book names come from its template (docs/library.md).
  books = BIBLE_BOOKS.map((it, index) => ({
    id: it.itemId,
    name: it.label,
    aliases: (ALIASES[it.itemId] ?? []).filter((a) => a !== it.label),
    chapters: it.verses.length,
    testament: index < 39 ? 'ot' : 'nt',
    group: [...GROUPS].reverse().find((g) => index >= g.from)!.name,
    index
  }));
  return books;
}

export function canonBook(id: string | null | undefined): CanonBook | undefined {
  return id ? canonBooks().find((b) => b.id === id) : undefined;
}

/**
 * A search as a book prefix and an optional chapter: "1 cor 13:4" ->
 * { book: "1 cor", chapter: 13 }. A number alone is a book prefix ("1"
 * lists 1 Samuel, 1 Kings, ...), not every chapter 1 in the Bible.
 */
export function parseQuery(query: string): { book: string; chapter?: number } {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = /^(.*?)\s*(\d+)?(?::\d*(?:[-–]\d*)?)?$/.exec(q);
  const book = (m?.[1] ?? q).trim();
  if (!book) return { book: q.replace(/:.*$/, '').trim() };
  return m?.[2] ? { book, chapter: Number(m[2]) } : { book };
}

/** The book's names start with the prefix, with or without a leading number ("cor" finds 1 and 2 Corinthians). */
export function bookMatches(b: CanonBook, prefix: string): boolean {
  if (!prefix) return true;
  const p = prefix.toLowerCase();
  return [b.name, ...b.aliases].map((n) => n.toLowerCase()).some((n) => n.startsWith(p) || n.replace(/^\d /, '').startsWith(p));
}

/** Books a search names, in canon order. */
export function booksMatching(query: string): CanonBook[] {
  if (!query.trim()) return [];
  const { book } = parseQuery(query);
  return canonBooks().filter((b) => bookMatches(b, book));
}

/** Does a unit (its book and chapters, from core `unitPlace`) answer the search? False for an empty search. */
export function placeMatches(place: { bookId: string | null; chapters: number[] }, query: string): boolean {
  if (!query.trim()) return false;
  const b = canonBook(place.bookId);
  if (!b) return false;
  const { book, chapter } = parseQuery(query);
  if (!bookMatches(b, book)) return false;
  return chapter === undefined || place.chapters.includes(chapter);
}

/** Canon order for a unit: book, then first chapter. Units with no book sort last. */
export function canonKey(place: { bookId: string | null; chapters: number[] }): number {
  const b = canonBook(place.bookId);
  return (b ? b.index : 999) * 1000 + (place.chapters[0] ?? 0);
}

// ---- what the Map counts (MAP-3, MAP-5) ---------------------------------------------

/** The Map's filters, in the demo's order. */
export type MapFilter = 'all' | 'feedback' | 'waiting' | 'review' | 'done' | 'todo';

export const MAP_FILTERS: { id: MapFilter; label: string; noun: string }[] = [
  { id: 'all', label: 'All', noun: '' },
  { id: 'feedback', label: 'Feedback waiting', noun: 'with feedback' },
  { id: 'waiting', label: 'With reviewers', noun: 'with reviewers' },
  { id: 'review', label: 'In review', noun: 'in review' },
  { id: 'done', label: 'Done', noun: 'done' },
  { id: 'todo', label: 'Not recorded', noun: 'not recorded' }
];

export function isMapFilter(v: string | undefined): v is MapFilter {
  return MAP_FILTERS.some((f) => f.id === v);
}

/** The parts of core's PassageState the Map reads. */
export interface PassageFacts {
  recorded: boolean;
  done: boolean;
  drafting: boolean;
  awaitingResponse: readonly unknown[];
  openRequests: readonly { what: 'record' | 'review' }[];
}

export function matchesFilter(s: PassageFacts, f: MapFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'feedback': return s.awaitingResponse.length > 0;
    case 'waiting': return s.openRequests.some((r) => r.what === 'review');
    case 'done': return s.done;
    case 'todo': return !s.recorded;
    case 'review': return s.recorded && !s.done;
  }
}

export function countFilters(states: PassageFacts[]): Record<MapFilter, number> {
  const counts: Record<MapFilter, number> = { all: states.length, feedback: 0, waiting: 0, review: 0, done: 0, todo: 0 };
  for (const s of states) for (const f of ['feedback', 'waiting', 'review', 'done', 'todo'] as const) if (matchesFilter(s, f)) counts[f]++;
  return counts;
}

/** Where a chapter stands, from its passages (MAP-5); "none" when no passage covers it. */
export type ChapterTone = 'done' | 'feedback' | 'review' | 'drafting' | 'todo' | 'none';

export function chapterTone(states: PassageFacts[]): ChapterTone {
  if (states.length === 0) return 'none';
  if (states.some((s) => s.awaitingResponse.length > 0)) return 'feedback';
  if (states.every((s) => s.done)) return 'done';
  if (states.some((s) => s.recorded)) return 'review';
  if (states.some((s) => s.drafting)) return 'drafting';
  return 'todo';
}
