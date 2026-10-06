/**
 * Versification: lining up the same text across numbering systems
 * (docs/decisions.md 36).
 *
 * A reference like PSA 51:1 is a coordinate in a numbering system, and
 * systems disagree: Psalm titles are verse 0 in one and verse 1 in another,
 * chapters end in different places, verses split and merge. Each system is
 * a Copenhagen Alliance / Scripture Burrito versification document, written
 * as differences from the Original Hebrew and Greek numbering ("org"). Any
 * two systems are compared through org: a range becomes the set of org
 * verses it covers, and two ranges line up where those sets meet. This is
 * the pivot method of Frontier's versification-tool, reimplemented at verse
 * granularity: sub-verse parts are folded into their verse, which is
 * exactly enough to decide which study material belongs to which passage.
 *
 * Pure: documents in, answers out. Callers fetch the documents.
 */

/** A versification document (Copenhagen Alliance JSON, plus a name). */
export interface VersificationDoc {
  format: 'versification@1';
  /** Short code: org, eng, lxx, vul, rso, rsc, or a custom one. */
  code: string;
  name: string;
  /** Informative: the standard system this one started from. Mappings are always to org. */
  basedOn?: string;
  /** Book (USFM code) -> verses in each chapter, chapter 1 first. */
  maxVerses: Record<string, number[]>;
  /** "GEN 31:55" (this system) -> "GEN 32:1" (org). Either side may be a same-chapter range. */
  mappedVerses: Record<string, string>;
  excludedVerses?: string[];
  partialVerses?: Record<string, string[]>;
  mergedVerses?: string[];
  splitVerses?: string[];
}

/** One verse: book (USFM), chapter, verse (0 = a Psalm title). */
interface Verse {
  book: string;
  chapter: number;
  verse: number;
}

/** An inclusive range inside one book; it may cross chapters. */
export interface VerseRange {
  book: string;
  start: { chapter: number; verse: number };
  end: { chapter: number; verse: number };
}

/** USFM books in Paratext order: the 66, then the deuterocanon. Unknown books sort after. */
export const USFM_BOOKS = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST',
  'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM',
  'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL',
  '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
  'TOB', 'JDT', 'ESG', 'WIS', 'SIR', 'BAR', 'LJE', 'S3Y', 'SUS', 'BEL', '1MA', '2MA', '3MA', '4MA', '1ES', '2ES', 'MAN',
  'PS2', 'ODA', 'PSS', 'EZA', '5EZ', '6EZ', 'DAG', 'PS3', '2BA', 'LBA', 'JUB', 'ENO', '1MQ', '2MQ', '3MQ', 'REP', '4BA', 'LAO',
  // Paratext's alternate Greek texts, which the standard versifications list.
  'JSA', 'JDB', 'TBS', 'SST', 'DNT', 'BLT'
] as const;

const BOOK_ORDER = new Map<string, number>(USFM_BOOKS.map((b, i) => [b, i]));

/** Canon position of a USFM book, for sorting; unknown books after every known one. */
export function bookOrder(book: string): number {
  return BOOK_ORDER.get(book) ?? 1000;
}

/** The app's older book ids (from LangQuest v2) that are not USFM codes. */
const LEGACY_BOOK_IDS: Record<string, string> = { joe: 'JOL', nah: 'NAM', mar: 'MRK', joh: 'JHN', phi: 'PHP' };

/** USFM code for a book id the app already uses ("gen" -> "GEN", "joh" -> "JHN"). */
export function usfmOf(bookId: string): string {
  return LEGACY_BOOK_IDS[bookId] ?? bookId.toUpperCase();
}

const TO_LEGACY = Object.fromEntries(Object.entries(LEGACY_BOOK_IDS).map(([k, v]) => [v, k]));

/** The app's book id for a USFM code ("JHN" -> "joh"), the inverse of `usfmOf`. */
export function bookIdOf(usfm: string): string {
  return TO_LEGACY[usfm] ?? usfm.toLowerCase();
}

/**
 * The verses a library template's unit covers, from its id alone
 * (`<item>/GEN`, `<item>/GEN.1`, `<item>/GEN.1.1-2.3`); null for other units.
 * A book or chapter reads as all of it (`versesIn` bounds the last verse).
 */
export function libraryUnitRange(unitId: string, versesIn?: (book: string, chapter: number) => number | undefined): VerseRange | null {
  const slash = unitId.indexOf('/');
  if (slash < 0 || unitId.slice(0, slash).includes('@')) return null;
  const node = unitId.slice(slash + 1);
  return /^[A-Z0-9]{3}(\.|$)/.test(node) ? parseRef(node, versesIn) : null;
}

// ---- references --------------------------------------------------------------

const REF = /^([A-Z0-9]{3})(?:[ .](\d+)(?:[:.](\d+)[a-z]?)?(?:-(?:(\d+)[:.])?(\d+)[a-z]?)?)?$/;

/**
 * Parse "GEN 1:1-2:3", "GEN 1:1-5", "GEN 1:3", "GEN 1" or "GEN" (also the
 * dotted form used in unit ids, "GEN.1.1-2.3"). A chapter or book reads as
 * all of it, with `versesIn` supplying the last verse. Null when unreadable.
 */
export function parseRef(text: string, versesIn?: (book: string, chapter: number) => number | undefined): VerseRange | null {
  const m = REF.exec(text.trim());
  if (!m) return null;
  const book = m[1]!;
  const last = (c: number) => versesIn?.(book, c) ?? 999;
  if (m[2] === undefined) {
    return { book, start: { chapter: 1, verse: 1 }, end: { chapter: 999, verse: 999 } };
  }
  const c1 = Number(m[2]);
  if (m[3] === undefined) {
    // "GEN 1" or "GEN 1-3": whole chapters.
    const c2 = m[5] !== undefined && m[4] === undefined ? Number(m[5]) : c1;
    return { book, start: { chapter: c1, verse: 1 }, end: { chapter: c2, verse: last(c2) } };
  }
  const v1 = Number(m[3]);
  if (m[5] === undefined) return { book, start: { chapter: c1, verse: v1 }, end: { chapter: c1, verse: v1 } };
  const c2 = m[4] !== undefined ? Number(m[4]) : c1;
  return { book, start: { chapter: c1, verse: v1 }, end: { chapter: c2, verse: Number(m[5]) } };
}

/** "GEN 1:1-2:3", "GEN 2:4-25", "GEN 3:1". */
export function formatRef(r: VerseRange): string {
  const { book, start, end } = r;
  if (start.chapter === end.chapter && start.verse === end.verse) return `${book} ${start.chapter}:${start.verse}`;
  if (start.chapter === end.chapter) return `${book} ${start.chapter}:${start.verse}-${end.verse}`;
  return `${book} ${start.chapter}:${start.verse}-${end.chapter}:${end.verse}`;
}

/** The dotted form, safe inside ids: "GEN.1.1-2.3", "GEN.2.4-25". */
export function refId(r: VerseRange): string {
  return formatRef(r).replace(' ', '.').replace(/:/g, '.');
}

const key = (v: Verse) => `${v.book} ${v.chapter}:${v.verse}`;

function parseVerseKey(text: string): Verse[] {
  // A mapping side: one verse, or a same-chapter range; a trailing part
  // letter ("ESG 1:1a") folds into its verse.
  const m = /^([A-Z0-9]{3}) (\d+):(\d+)[a-z]?(?:-(\d+)[a-z]?)?$/.exec(text.trim());
  if (!m) return [];
  const [book, c, v1] = [m[1]!, Number(m[2]), Number(m[3])];
  const v2 = m[4] !== undefined ? Number(m[4]) : v1;
  const out: Verse[] = [];
  for (let v = v1; v <= v2; v++) out.push({ book, chapter: c, verse: v });
  return out;
}

// ---- compiled systems --------------------------------------------------------

interface Compiled {
  code: string;
  max: Map<string, number[]>;
  /** This system's verse -> org verses, for every verse that is not identity. */
  toOrg: Map<string, Verse[]>;
  /** Org verse -> this system's verses, for every org verse some mapping lands on. */
  fromOrg: Map<string, Verse[]>;
}

const compiled = new WeakMap<VersificationDoc, Compiled>();

function compile(doc: VersificationDoc): Compiled {
  const hit = compiled.get(doc);
  if (hit) return hit;
  const toOrg = new Map<string, Verse[]>();
  const fromOrg = new Map<string, Verse[]>();
  const keys = Object.keys(doc.mappedVerses).sort();
  for (const k of keys) {
    const src = parseVerseKey(k);
    const dst = parseVerseKey(doc.mappedVerses[k]!);
    // Equal lengths pair verse by verse; a merge or split maps every verse
    // on one side to the whole other side.
    src.forEach((s, i) => {
      const targets = src.length === dst.length ? [dst[i]!] : dst;
      toOrg.set(key(s), [...(toOrg.get(key(s)) ?? []), ...targets]);
      for (const t of targets) fromOrg.set(key(t), [...(fromOrg.get(key(t)) ?? []), s]);
    });
  }
  for (const k of doc.excludedVerses ?? []) for (const s of parseVerseKey(k)) toOrg.set(key(s), []);
  const c: Compiled = { code: doc.code, max: new Map(Object.entries(doc.maxVerses)), toOrg, fromOrg };
  compiled.set(doc, c);
  return c;
}

/** Verses in a chapter under this system, or undefined when the chapter does not exist. */
export function versesInChapter(doc: VersificationDoc, book: string, chapter: number): number | undefined {
  return compile(doc).max.get(book)?.[chapter - 1];
}

/** Chapters in a book under this system (0 when the book is not in it). */
export function chaptersInBook(doc: VersificationDoc, book: string): number {
  return compile(doc).max.get(book)?.length ?? 0;
}

/** Every verse a range covers under this system, in order. */
function versesOf(doc: VersificationDoc, r: VerseRange): Verse[] {
  const max = compile(doc).max.get(r.book);
  if (!max) return [];
  const out: Verse[] = [];
  const lastChapter = Math.min(r.end.chapter, max.length);
  for (let c = r.start.chapter; c <= lastChapter; c++) {
    const from = c === r.start.chapter ? r.start.verse : 1;
    const to = c === r.end.chapter ? Math.min(r.end.verse, max[c - 1] ?? 0) : max[c - 1] ?? 0;
    for (let v = from; v <= to; v++) out.push({ book: r.book, chapter: c, verse: v });
  }
  return out;
}

/** The org verses one verse of this system holds (none when it is excluded). */
export function verseToOrg(doc: VersificationDoc, v: Verse): Verse[] {
  return compile(doc).toOrg.get(key(v)) ?? [v];
}

/** The verses of this system that hold one org verse (none when this system leaves it out). */
export function verseFromOrg(doc: VersificationDoc, v: Verse): Verse[] {
  const c = compile(doc);
  const mapped = c.fromOrg.get(key(v));
  if (mapped) return mapped;
  // Identity, unless that coordinate is itself mapped elsewhere in this system.
  if (c.toOrg.has(key(v))) return [];
  const max = c.max.get(v.book)?.[v.chapter - 1];
  return max !== undefined && (v.verse <= max || v.verse === 0) ? [v] : [];
}

/** The org verses a range covers, as keys ("GEN 32:1"). */
export function orgVerses(doc: VersificationDoc, r: VerseRange): Set<string> {
  const out = new Set<string>();
  for (const v of versesOf(doc, r)) for (const o of verseToOrg(doc, v)) out.add(key(o));
  return out;
}

/**
 * How many verses two ranges share, each read in its own system. Zero means
 * they do not line up at all. Same system: plain overlap, no documents
 * consulted beyond chapter lengths.
 */
export function sharedVerses(a: { doc: VersificationDoc; range: VerseRange }, b: { doc: VersificationDoc; range: VerseRange }): number {
  const left = orgVerses(a.doc, a.range);
  let n = 0;
  for (const k of orgVerses(b.doc, b.range)) if (left.has(k)) n++;
  return n;
}

/**
 * A range from one system expressed in another: every verse it covers,
 * carried through org, then the smallest range around what lands in the
 * target's most-covered book. Null when nothing of it exists there.
 */
export function mapRange(from: VersificationDoc, to: VersificationDoc, r: VerseRange): VerseRange | null {
  if (from === to || from.code === to.code) return r;
  const landed: Verse[] = [];
  for (const v of versesOf(from, r)) for (const o of verseToOrg(from, v)) landed.push(...verseFromOrg(to, o));
  if (landed.length === 0) return null;
  const byBook = new Map<string, Verse[]>();
  for (const v of landed) byBook.set(v.book, [...(byBook.get(v.book) ?? []), v]);
  const [book, verses] = [...byBook].sort((x, y) => y[1].length - x[1].length || bookOrder(x[0]) - bookOrder(y[0]))[0]!;
  const ord = (v: Verse) => v.chapter * 10000 + v.verse;
  verses.sort((x, y) => ord(x) - ord(y));
  const first = verses[0]!;
  const last = verses[verses.length - 1]!;
  return { book, start: { chapter: first.chapter, verse: first.verse }, end: { chapter: last.chapter, verse: last.verse } };
}
