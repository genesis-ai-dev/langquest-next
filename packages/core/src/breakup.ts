import { asTemplateV2, templateBooks, type TemplateBook, type TemplateDoc, type TemplateDocV2 } from './libraryDocs';
import { mapRange, parseRef, type VersificationDoc } from './versification';

/**
 * Breaking up the Bible (decision 74). A Bible template lists its books,
 * and each book is broken up its own way (chapters, FIA's passages,
 * unfoldingWord's chunks, OpenBible's sections) or not yet. A way to break
 * it up is itself a template; breaking up one book copies that book's
 * parts from the way into the language's template. Pure.
 */

/** How one book is broken up in a template, or null when it is not (yet). */
export function bookParts(doc: TemplateDoc, book: string): TemplateBook | null {
  const b = templateBooks(doc).find((x) => x.book === book);
  return b && b.divide ? b : null;
}

/** Whether a way has parts for a book (FIA has none for Romans). */
export function wayCovers(way: TemplateDoc, book: string): boolean {
  const b = bookParts(way, book);
  return !!b && (b.divide !== 'passages' || (b.passages?.length ?? 0) > 0);
}

/** How many parts a book has in a way: its chapters, or its passages. */
export function partCount(way: TemplateDoc, book: string, versification: VersificationDoc | null): number {
  const b = bookParts(way, book);
  if (!b) return 0;
  if (b.divide === 'book') return 1;
  if (b.divide === 'chapters') return versification ? (versification.maxVerses[book]?.length ?? 0) : 0;
  return b.passages?.length ?? 0;
}

/** Every part of every book in a way, for "1,189 chapters" and the like. */
export function wayPartCount(way: TemplateDoc, versification: VersificationDoc | null): number {
  return templateBooks(way).reduce((n, b) => n + partCount(way, b.book, versification), 0);
}

/**
 * The template with one book broken up as `way` breaks it up; the book
 * keeps the template's name for it. `way: null` leaves the book listed with
 * nothing in it. Other books are unchanged, so their parts keep their ids.
 */
export function withBookBrokenUp(doc: TemplateDoc, book: string, way: TemplateDoc | null): TemplateDocV2 {
  const v2 = asTemplateV2(doc);
  const from = way ? bookParts(way, book) : null;
  if (way && !from) throw new Error(`${way.name} does not break up ${book}`);
  const books = templateBooks(v2).map((b) => (b.book === book ? partsOf(b, from) : b));
  return { ...v2, bible: { versification: v2.bible!.versification, books } };
}

/**
 * The template with every book that is not broken up yet broken up as
 * `way` does (FIA's passages, then chapters for the books FIA leaves out).
 * Books the way does not cover stay as they are.
 */
export function withEmptyBooksFilled(doc: TemplateDoc, way: TemplateDoc): TemplateDocV2 {
  const v2 = asTemplateV2(doc);
  const books = templateBooks(v2).map((b) => {
    if (b.divide) return b;
    const from = bookParts(way, b.book);
    return from ? partsOf(b, from) : b;
  });
  return { ...v2, bible: { versification: v2.bible!.versification, books } };
}

function partsOf(b: TemplateBook, from: TemplateBook | null): TemplateBook {
  const out: TemplateBook = { book: b.book, name: b.name };
  if (!from) return out;
  out.divide = from.divide!;
  if (from.part) out.part = from.part;
  if (from.divide === 'passages') out.passages = (from.passages ?? []).map((p) => ({ ...p }));
  return out;
}

/** Books listed with nothing in them, in the template's order. */
export function emptyBooks(doc: TemplateDoc): string[] {
  return templateBooks(doc).filter((b) => !b.divide).map((b) => b.book);
}

/** Two templates break up a book the same way (same parts, in the same order). */
export function sameParts(a: TemplateDoc, b: TemplateDoc, book: string): boolean {
  const x = bookParts(a, book);
  const y = bookParts(b, book);
  if (!x || !y) return !x && !y;
  if (x.divide !== y.divide) return false;
  if (x.divide !== 'passages') return true;
  const refs = (t: TemplateBook) => (t.passages ?? []).map((p) => parseRef(p.ref)).map((r) => (r ? `${r.start.chapter}:${r.start.verse}-${r.end.chapter}:${r.end.verse}` : ''));
  return refs(x).join('|') === refs(y).join('|');
}

/** Whether study material following `pattern` was made for this way of breaking up (`goesWith`). */
export function goesWith(doc: TemplateDoc | null | undefined, pattern: string | null | undefined): boolean {
  return !!doc && !!pattern && doc.format === 'template@2' && doc.goesWith?.pattern === pattern;
}

// ---- verse numbers, from the Bibles a language uses ----------------------------

/** Verses that read differently across the usual numberings, in the order worth showing. */
const TELLING_VERSES = [
  { ref: 'PSA 23:1', says: 'The Lord is my shepherd' },
  { ref: 'MAL 4:1', says: 'The day is coming, burning like an oven' },
  { ref: 'PSA 51:1', says: 'Have mercy on me, O God' },
  { ref: 'JOL 2:28', says: 'I will pour out my Spirit' },
  { ref: 'ROM 16:25', says: 'Now to him who is able to strengthen you' },
  { ref: 'DAN 4:1', says: 'King Nebuchadnezzar, to all peoples' },
  { ref: '3JN 1:15', says: 'Peace be to you' }
];

export interface NumberingClash {
  /** What the verse says, in English, so people can find it. */
  says: string;
  /** Where each Bible puts it: "Psalm 23:1", "Psalm 22:1". */
  places: { name: string; ref: string }[];
}

/**
 * How a language's Bibles number their verses (decision 74): the
 * numbering they share, or English when they have none, and when they
 * disagree, one verse that shows how ("The Lord is my shepherd" is Psalm 23
 * in one and Psalm 22 in the other). Nothing depends on it; it is a warning
 * the team may ignore.
 */
export function verseNumbering(
  bibles: { name: string; versification: VersificationDoc }[],
  english: VersificationDoc
): { code: string; clash: NumberingClash | null } {
  const codes = [...new Set(bibles.map((b) => b.versification.code))];
  if (codes.length <= 1) return { code: codes[0] ?? english.code, clash: null };
  for (const t of TELLING_VERSES) {
    const at = parseRef(t.ref);
    if (!at) continue;
    const places = bibles.map((b) => {
      const r = mapRange(english, b.versification, at);
      return { name: b.name, ref: r ? `${r.book} ${r.start.chapter}:${r.start.verse}` : '' };
    });
    if (new Set(places.map((p) => p.ref)).size > 1) return { code: codes[0]!, clash: { says: t.says, places } };
  }
  return { code: codes[0]!, clash: null };
}
