// Reference search over the canon (ng-langquest-ux src/canon.ts), for the
// Map (MAP-1, MAP-4, ADR-009). A whole Bible is about 1,200 passages, so the
// Map is reached by testament, book and chapter, or by typing a reference
// the way people say it: "joh 3", "ps 23", "1 cor 13:4", or "cor" for both
// Corinthians. Pure: the books come from core's Bible template (the same
// BIBLE_BOOKS the units were made from), grouped into the demo's canon
// sections. The Map's filters and chapter colours (MAP-3, MAP-5; demo
// screens/map.tsx) sit at the end, so they can be tested without React.
import { BIBLE_BOOKS } from '@langquest-next/core';
import { latinDigits } from './textMatch';
import { bookName } from './coreText';
import { currentLanguage, t } from './i18n';

export type Testament = 'ot' | 'nt';

export interface CanonBook {
  /** Core's book id ("luk", "1co"), as `unitPlace(...).bookId` gives it. */
  id: string;
  /** "Psalms", in the language showing. */
  name: string;
  /** Other names people search by ("Psalm", "Song of Songs", and core's English name when the app shows another). */
  aliases: string[];
  chapters: number;
  testament: Testament;
  /** Canon section in the language showing: "Law", "Gospels & Acts", ... */
  group: string;
  /** 0..65 in canon order. */
  index: number;
}

/** The demo's canon sections. */
export type CanonGroup = 'law' | 'history' | 'poetry' | 'prophets' | 'gospels' | 'letters';

/** The canon sections, by the index of the first book in each. */
const GROUPS: { from: number; id: CanonGroup }[] = [
  { from: 0, id: 'law' },
  { from: 5, id: 'history' },
  { from: 17, id: 'poetry' },
  { from: 22, id: 'prophets' },
  { from: 39, id: 'gospels' },
  { from: 44, id: 'letters' }
];

/** A canon section's name in the language showing. */
export function canonGroupName(id: CanonGroup): string {
  switch (id) {
    case 'law': return t('canon.groups.law');
    case 'history': return t('canon.groups.history');
    case 'poetry': return t('canon.groups.poetry');
    case 'prophets': return t('canon.groups.prophets');
    case 'gospels': return t('canon.groups.gospels');
    case 'letters': return t('canon.groups.letters');
  }
}

/** The canon sections in order, in the language showing. */
export function canonGroups(): string[] {
  return GROUPS.map((g) => canonGroupName(g.id));
}

/** The same names, read each time they are iterated, so never the English of the moment the module loaded. */
export const CANON_GROUPS: Iterable<string> = { [Symbol.iterator]: () => canonGroups()[Symbol.iterator]() };

/** Another name people search for a book by, in the language showing. */
function aliasOf(id: string): string | null {
  switch (id) {
    case 'psa': return t('canon.aliases.psa');
    case 'sng': return t('canon.aliases.sng');
    default: return null;
  }
}

let books: CanonBook[] | null = null;
let booksLanguage = '';

/** The 66 books in canon order. Built once for the language showing. */
export function canonBooks(): CanonBook[] {
  if (books && booksLanguage === currentLanguage()) return books;
  // The canon is reference data in core, not a content template: a language's
  // own book names come from its template (docs/library.md).
  booksLanguage = currentLanguage();
  books = BIBLE_BOOKS.map((it, index) => {
    const name = bookName(it.itemId);
    return {
      id: it.itemId,
      name,
      aliases: [...new Set([aliasOf(it.itemId), it.label])].filter((a): a is string => !!a && a !== name),
      chapters: it.verses.length,
      testament: index < 39 ? 'ot' : 'nt',
      group: canonGroupName([...GROUPS].reverse().find((g) => index >= g.from)!.id),
      index
    };
  });
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
  const q = latinDigits(query).trim().toLowerCase().replace(/\s+/g, ' ');
  const m = /^(.*?)\s*(\d+)?(?::\d*(?:[-–]\d*)?)?$/.exec(q);
  const book = (m?.[1] ?? q).trim();
  if (!book) return { book: q.replace(/:.*$/, '').trim() };
  return m?.[2] ? { book, chapter: Number(m[2]) } : { book };
}

/** The book's names start with the prefix, with or without a leading number ("cor" finds 1 and 2 Corinthians), or one of their words does. */
export function bookMatches(b: CanonBook, prefix: string): boolean {
  if (!prefix) return true;
  const p = prefix.toLowerCase();
  return [b.name, ...b.aliases].map((n) => latinDigits(n).toLowerCase()).some((n) => n.startsWith(p) || n.replace(/^\d /, '').startsWith(p)
    // Any word of the name ("yohana" in "Injili ya Yohana"), and, in scripts without
    // letters a-z, anywhere in it ("ယောဟန်" in "ရှင်ယောဟန်ခရစ်ဝင်", "约翰" in "约翰福音").
    || n.split(/\s+/).some((w) => w.startsWith(p)) || (p.length >= 2 && !/[a-z]/.test(p) && n.includes(p)));
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

export const MAP_FILTERS: readonly { id: MapFilter }[] = [
  { id: 'all' }, { id: 'feedback' }, { id: 'waiting' }, { id: 'review' }, { id: 'done' }, { id: 'todo' }
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

/**
 * What a chapter tile shows (the simple Map, decision 71): three states,
 * marked as well as coloured. Done is every passage done; started is any
 * work at all (recording begun, recorded, in review, feedback waiting); new
 * is nothing yet. `none` is a chapter with no passage in this language.
 */
export type ChapterStage = 'done' | 'started' | 'new' | 'none';

export function chapterStage(tone: ChapterTone): ChapterStage {
  switch (tone) {
    case 'done': return 'done';
    case 'feedback':
    case 'review':
    case 'drafting': return 'started';
    case 'todo': return 'new';
    case 'none': return 'none';
  }
}

export function chapterTone(states: PassageFacts[]): ChapterTone {
  if (states.length === 0) return 'none';
  if (states.some((s) => s.awaitingResponse.length > 0)) return 'feedback';
  if (states.every((s) => s.done)) return 'done';
  if (states.some((s) => s.recorded)) return 'review';
  if (states.some((s) => s.drafting)) return 'drafting';
  return 'todo';
}
