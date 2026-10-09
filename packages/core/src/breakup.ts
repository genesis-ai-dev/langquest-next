import { asTemplateV2, templateBooks, type TemplateBook, type TemplateDoc, type TemplateDocV2 } from './libraryDocs';
import {
  libraryUnitRange, mapRange, orgVerses, parseRef, sharedVerses, verseFromOrg, versesOf, verseToOrg, type VerseRange, type VersificationDoc
} from './versification';

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

// ---- a way of dividing in another numbering (decision 80) ----------------------------

/**
 * A way of dividing written in one numbering (`from`), as the same sections
 * in another numbering, with that numbering's books. FIA, unfoldingWord and
 * OpenBible divide the text, so each section is the same verses wherever
 * they are numbered; "by chapter" is the target numbering's own chapters.
 * The rules (docs/breaking-up-the-bible.md):
 *
 * 1. Verses no section covers, inside a chapter, are a section of their own
 *    (Luther's Psalm 51:1–2).
 * 2. Uncovered verses in the middle of a section split it (Catholic Daniel
 *    3:19–23, 3:24–90, 3:91–97); both parts keep the section's name.
 * 3. A verse two sections both reach goes to the earlier one (Douay Judges
 *    21:24); a section left with nothing is not made.
 * 4. Uncovered whole chapters are a section each (Catholic Daniel 13, 14).
 *
 * A book the way leaves out, or covers nowhere, is listed with nothing in
 * it: it waits to be divided. The same numbering keeps the way as it is.
 */
export function convertWay(
  way: TemplateDoc,
  from: VersificationDoc,
  to: { doc: VersificationDoc; hash: string; books: { book: string; name: string }[] }
): TemplateDocV2 {
  const src = templateBooks(way);
  const byBook = new Map(src.map((b) => [b.book, b]));
  const goes = way.format === 'template@2' && way.goesWith ? { goesWith: way.goesWith } : {};
  const base = { format: 'template@2' as const, name: way.name, description: way.description, structure: 'bible' as const, levels: way.levels, ...goes, deps: [] as string[] };
  if (from.code === to.doc.code) {
    const books = to.books.map((b): TemplateBook => {
      const s = byBook.get(b.book);
      return s ? { ...s, name: b.name } : { book: b.book, name: b.name };
    });
    return { ...base, bible: { versification: to.hash, books } };
  }

  // Every target verse a section reaches, owned by the earliest section (rule 3).
  const owner = new Map<string, number>();
  const pieces: { name?: string; part?: string }[] = [];
  const vkey = (v: { book: string; chapter: number; verse: number }) => `${v.book} ${v.chapter}:${v.verse}`;
  for (const b of src) {
    if (b.divide !== 'passages') continue;
    for (const p of b.passages ?? []) {
      const r = parseRef(p.ref, (bk, c) => from.maxVerses[bk]?.[c - 1]);
      const g = pieces.length;
      pieces.push({ ...(p.name ? { name: p.name } : {}), ...(b.part ? { part: b.part } : {}) });
      if (!r) continue;
      for (const v of versesOf(from, r)) {
        for (const o of verseToOrg(from, v)) {
          for (const t of verseFromOrg(to.doc, o)) {
            if (t.verse === 0) continue;
            const k = vkey(t);
            const had = owner.get(k);
            if (had === undefined || g < had) owner.set(k, g);
          }
        }
      }
    }
  }

  const books = to.books.map((tb): TemplateBook => {
    const s = byBook.get(tb.book);
    const out: TemplateBook = { book: tb.book, name: tb.name };
    if (s?.divide === 'chapters') return { ...out, divide: 'chapters', ...(s.part ? { part: s.part } : {}) };
    if (s?.divide === 'book') return { ...out, divide: 'book' };
    const max = to.doc.maxVerses[tb.book] ?? [];
    const runs: { owner: number | null; c1: number; v1: number; c2: number; v2: number }[] = [];
    max.forEach((count, i) => {
      const c = i + 1;
      for (let v = 1; v <= count; v++) {
        const o = owner.get(`${tb.book} ${c}:${v}`) ?? null;
        const last = runs[runs.length - 1];
        // A covered run goes on across chapters; an uncovered one ends with its chapter (rules 1 and 4).
        if (last && last.owner === o && (o !== null || last.c2 === c)) { last.c2 = c; last.v2 = v; }
        else runs.push({ owner: o, c1: c, v1: v, c2: c, v2: v });
      }
    });
    if (!runs.some((r) => r.owner !== null)) return out;
    const part = s?.part ?? runs.map((r) => (r.owner !== null ? pieces[r.owner]!.part : undefined)).find(Boolean);
    return {
      ...out,
      divide: 'passages',
      ...(part ? { part } : {}),
      passages: runs.map((r) => {
        const ref = r.c1 === r.c2
          ? (r.v1 === r.v2 ? `${tb.book} ${r.c1}:${r.v1}` : `${tb.book} ${r.c1}:${r.v1}-${r.v2}`)
          : `${tb.book} ${r.c1}:${r.v1}-${r.c2}:${r.v2}`;
        const name = r.owner !== null ? pieces[r.owner]!.name : undefined;
        return name ? { ref, name } : { ref };
      })
    };
  });
  return { ...base, bible: { versification: to.hash, books } };
}

/**
 * Sections a language no longer has that hold its work, each with the
 * current sections it overlaps (decision 80): what was recorded before a way
 * changed its divisions, a book was divided again or the numbering changed.
 * `numberingOf` says which numbering an expired section was written in (the
 * template version it came from), else the current one is assumed.
 */
export function earlierSections(c: {
  current: string[];
  expired: string[];
  currentNumbering: VersificationDoc | null;
  numberingOf: (unitId: string) => VersificationDoc | null;
}): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!c.currentNumbering) return out;
  const cur = c.currentNumbering;
  const rangeIn = (unitId: string, doc: VersificationDoc) => libraryUnitRange(unitId, (b, ch) => doc.maxVerses[b]?.[ch - 1]);
  const byBook = new Map<string, { unitId: string; range: VerseRange }[]>();
  for (const u of c.current) {
    const r = rangeIn(u, cur);
    if (r) byBook.set(r.book, [...(byBook.get(r.book) ?? []), { unitId: u, range: r }]);
  }
  for (const e of c.expired) {
    const doc = c.numberingOf(e) ?? cur;
    const r = rangeIn(e, doc);
    if (!r) continue;
    // The same book in the other numbering, or one its verses land in.
    const books = new Set([r.book, ...[...orgVerses(doc, r)].map((k) => k.slice(0, 3))]);
    for (const book of books) {
      for (const u of byBook.get(book) ?? []) {
        if (sharedVerses({ doc, range: r }, { doc: cur, range: u.range }) > 0) out.set(u.unitId, [...(out.get(u.unitId) ?? []), e]);
      }
    }
  }
  return out;
}

/**
 * A numbering as an admin chooses it (decision 80): a source numbering with
 * exactly one tradition's books, and only the mappings of those books, so
 * a book this tradition does not print (the Vulgate file's Greek Daniel,
 * `DAG`) cannot claim verses.
 */
export function numberingOf(doc: VersificationDoc, books: readonly string[], name?: string): VersificationDoc {
  const keep = new Set(books);
  const inBooks = (ref: string) => keep.has(ref.slice(0, 3));
  const mapped = Object.fromEntries(Object.entries(doc.mappedVerses).filter(([k]) => inBooks(k)));
  const more = (doc.moreMappedVerses ?? []).filter(([k]) => inBooks(k));
  return {
    format: 'versification@1',
    code: doc.code,
    name: name ?? doc.name,
    basedOn: doc.code,
    maxVerses: Object.fromEntries(books.filter((b) => doc.maxVerses[b]).map((b) => [b, [...doc.maxVerses[b]!]])),
    mappedVerses: mapped,
    ...(more.length ? { moreMappedVerses: more } : {}),
    ...(doc.excludedVerses?.length ? { excludedVerses: doc.excludedVerses.filter(inBooks) } : {})
  };
}
