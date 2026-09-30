import { BIBLE_BOOKS, FIA_PERICOPES } from './catalogData';
import type { TargetScope } from './record';
import type { ProjectState } from './state';

/**
 * Where a unit sits in the canon, verse by verse, so coverage can be
 * weighted by verses (a long New Testament counts for more than a short
 * one) and chapters can be counted exactly once. Every verse of the
 * Protestant canon has an index; a unit covers a set of them. Pure and
 * cached: the catalog is static and a hand-added unit's label is the only
 * input besides its id.
 */

const OFFSETS: number[][] = [];
const VERSE_BOOK: number[] = [];
const VERSE_CHAPTER: number[] = [];
let total = 0;
BIBLE_BOOKS.forEach((b, bi) => {
  OFFSETS[bi] = b.verses.map((n, ci) => {
    const start = total;
    for (let v = 0; v < n; v++) { VERSE_BOOK.push(bi); VERSE_CHAPTER.push(ci + 1); }
    total += n;
    return start;
  });
});

const BOOK_INDEX = new Map(BIBLE_BOOKS.map((b, i) => [b.itemId, i]));
// FIA seeds use other abbreviations for Mark and John.
BOOK_INDEX.set('mrk', BOOK_INDEX.get('mar')!);
BOOK_INDEX.set('jhn', BOOK_INDEX.get('joh')!);
const FIA = new Map(FIA_PERICOPES.map((p) => [p.itemId, p]));

const FIRST_NT = BOOK_INDEX.get('mat')!;
const LAST_GOSPEL = BOOK_INDEX.get('joh')!;

export function inScope(scope: TargetScope, bookIndex: number): boolean {
  switch (scope) {
    case 'gospels': return bookIndex >= FIRST_NT && bookIndex <= LAST_GOSPEL;
    case 'nt': return bookIndex >= FIRST_NT;
    case 'ot': return bookIndex < FIRST_NT;
    case 'bible': return true;
  }
}

/** Verses in each scope of the whole canon: the denominators of coverage. */
export const SCOPE_VERSES: Record<TargetScope, number> = (() => {
  const out: Record<TargetScope, number> = { gospels: 0, nt: 0, ot: 0, bible: 0 };
  for (const bi of VERSE_BOOK) for (const s of ['gospels', 'nt', 'ot', 'bible'] as const) if (inScope(s, bi)) out[s] += 1;
  return out;
})();

export const bookOfVerse = (v: number): number => VERSE_BOOK[v]!;

/** A chapter's id across the canon: `bookIndex * 1000 + chapter`. */
export const chapterOfVerse = (v: number): number => VERSE_BOOK[v]! * 1000 + VERSE_CHAPTER[v]!;
export const bookOfChapter = (chapterId: number): number => Math.floor(chapterId / 1000);
export const chapterNumber = (chapterId: number): number => chapterId % 1000;
export const bookLabel = (bookIndex: number): string => BIBLE_BOOKS[bookIndex]?.label ?? '';
export const bookId = (bookIndex: number): string => BIBLE_BOOKS[bookIndex]?.itemId ?? '';

/** Verse indices from chapter:verse to chapter:verse in one book, clamped to the book. */
function span(bi: number, c1: number, v1: number, c2: number, v2: number): number[] {
  const chapters = BIBLE_BOOKS[bi]!.verses;
  const out: number[] = [];
  for (let c = Math.max(1, c1); c <= Math.min(c2, chapters.length); c++) {
    const n = chapters[c - 1]!;
    const from = c === c1 ? Math.max(1, v1) : 1;
    const to = c === c2 ? Math.min(v2, n) : n;
    for (let v = from; v <= to; v++) out.push(OFFSETS[bi]![c - 1]! + v - 1);
  }
  return out;
}

/** "3:1-21", "1:1-2:3", "5:11b-18", "3", "3-4" within one book; letters mark part-verses and count as the verse. */
function parseRange(bi: number, range: string): number[] {
  const verse = /^(\d+):(\d+)[a-z]?(?:\s*[–-]\s*(?:(\d+):)?(\d+)[a-z]?)?$/.exec(range.trim());
  if (verse) {
    const c1 = Number(verse[1]), v1 = Number(verse[2]);
    const c2 = verse[3] ? Number(verse[3]) : c1;
    const v2 = verse[4] ? Number(verse[4]) : v1;
    return span(bi, c1, v1, c2, v2);
  }
  const chapters = /^(\d+)(?:\s*[–-]\s*(\d+))?$/.exec(range.trim());
  if (chapters) {
    const c1 = Number(chapters[1]);
    const c2 = chapters[2] ? Number(chapters[2]) : c1;
    return span(bi, c1, 1, c2, Number.MAX_SAFE_INTEGER);
  }
  return [];
}

const cache = new Map<string, number[]>();

/**
 * The canon verses a unit covers: a Bible-chapter unit its chapter, a FIA
 * pericope its range, a hand-added unit what its label says ("Luke
 * 15:11-32", "John 3"). Book overviews and anything else cover none.
 */
export function unitVerses(state: ProjectState, unitId: string): number[] {
  const label = state.units[unitId]?.label ?? '';
  const key = `${unitId}\u0000${label}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: number[] = [];
  const m = /^(bible|fia|book)@\d+\/(.+)$/.exec(unitId);
  if (m?.[1] === 'bible') {
    const c = /^(.+)-(\d+)$/.exec(m[2]!);
    const bi = c ? BOOK_INDEX.get(c[1]!) : undefined;
    if (bi !== undefined) out = span(bi, Number(c![2]), 1, Number(c![2]), Number.MAX_SAFE_INTEGER);
  } else if (m?.[1] === 'fia') {
    const p = FIA.get(m[2]!);
    const bi = p ? BOOK_INDEX.get(p.book) : undefined;
    if (p && bi !== undefined) out = parseRange(bi, p.verseRange);
  } else if (!m) {
    const bi = BIBLE_BOOKS.findIndex((b) => label.startsWith(`${b.label} `));
    if (bi >= 0) out = parseRange(bi, label.slice(BIBLE_BOOKS[bi]!.label.length + 1));
  }
  cache.set(key, out);
  return out;
}

/** The chapters a unit touches, as chapter ids. */
export function unitChapters(state: ProjectState, unitId: string): number[] {
  return [...new Set(unitVerses(state, unitId).map(chapterOfVerse))];
}
