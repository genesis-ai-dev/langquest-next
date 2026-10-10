// Pure reading of content templates for the content screens (screens/content.tsx),
// ported from the UX demo's src/content.ts and src/domain/boundaries.ts
// (TPL-1..9, ADR-025..027). Templates are library items (docs/library.md):
// a language names one version of one (`v1.TemplateSelected`) and its units
// come from that version. Everything here is derived from the fold and the documents; nothing is
// stored. A language's passages in a book are its template's units in that
// book, read as verse ranges; FIA's breaks are read from core's bundled
// pericope list.
import {
  bookIdOf, bookOrder, canonicalJson, languagePassages, templateBooks, libraryUnitRange, subscriptionItemId, unitPlace, unitPrefixOf, USFM_BOOKS,
  type Indexes, type LevelDisplay, type LibraryItemState, type LibraryItemView, type OutlineNode, type LanguageState,
  type TemplateBook, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { latinDigits } from './textMatch';
import { BIBLE_BOOKS, FIA_PERICOPES, type BibleBook } from '@langquest-next/core';
import { bookName } from './coreText';
import { currentLanguage, t } from './i18n';
import type { SharedItem } from './library/model';

export type { BibleBook };

// ---- verses and ranges -----------------------------------------------------------

type VerseRef = { c: number; v: number };
export const verseKey = (r: VerseRef): number => r.c * 1000 + r.v;

/** FIA's seeds spell Mark and John differently from the canon list. */
const bookIdFromFia = (id: string): string => (id === 'mrk' ? 'mar' : id === 'jhn' ? 'joh' : id);

export function bibleBook(bookId: string): BibleBook | undefined {
  const id = bookIdFromFia(bookId);
  return BIBLE_BOOKS.find((b) => b.itemId === id);
}

function versesIn(book: BibleBook, chapter: number): number {
  return book.verses[chapter - 1] ?? 0;
}

function lastVerse(book: BibleBook): VerseRef {
  const c = book.verses.length;
  return { c, v: versesIn(book, c) };
}

/**
 * A reference within a book as a verse range: "15" is the whole chapter,
 * "15-16" two chapters, "15:11-32", "1:1-2:3", "12:9b-20" (partial verses
 * count as the whole verse). Hyphen or en dash. Null when it does not parse.
 */
export function parseRange(ref: string, book: BibleBook): { from: VerseRef; to: VerseRef } | null {
  const m = /^(\d+)(?::(\d+)[a-z]?)?(?:\s*[-–]\s*(\d+)[a-z]?(?::(\d+)[a-z]?)?)?$/.exec(latinDigits(ref).trim());
  if (!m) return null;
  const c1 = Number(m[1]);
  let from: VerseRef;
  let to: VerseRef;
  if (m[2] === undefined) {
    const c2 = m[3] ? Number(m[3]) : c1;
    from = { c: c1, v: 1 };
    to = { c: c2, v: versesIn(book, c2) };
  } else {
    from = { c: c1, v: Number(m[2]) };
    if (m[3] === undefined) to = from;
    else if (m[4] !== undefined) to = { c: Number(m[3]), v: Number(m[4]) };
    else to = { c: c1, v: Number(m[3]) };
  }
  if (from.c < 1 || to.c > book.verses.length || verseKey(to) < verseKey(from)) return null;
  return { from, to };
}

/** A unit's range from its label: "Luke" is the whole book, "Luke 15" a chapter, "Luke 15:11-32" a passage. */
export function rangeOfLabel(label: string, book: BibleBook): { from: VerseRef; to: VerseRef } | null {
  const text = label.trim();
  if (text === book.label) return { from: { c: 1, v: 1 }, to: lastVerse(book) };
  if (!text.startsWith(`${book.label} `)) return null;
  return parseRange(text.slice(book.label.length + 1), book);
}

/**
 * A unit's range in a book: a library unit says it in its id
 * (`<item>/LUK.15.11-32`), whatever the language calls it; an older unit in
 * its label. Null when it is not in this book or does not read.
 */
export function rangeOfUnit(unitId: string, label: string, book: BibleBook): { from: VerseRef; to: VerseRef } | null {
  const lib = libraryUnitRange(unitId, (_b, c) => versesIn(book, c) || undefined);
  if (!lib) return rangeOfLabel(label, book);
  if (bookIdOf(lib.book) !== book.itemId) return null;
  const last = lastVerse(book);
  const from = { c: lib.start.chapter, v: lib.start.verse };
  const end = { c: lib.end.chapter, v: lib.end.verse };
  const to = verseKey(end) > verseKey(last) ? last : end;
  if (from.c < 1 || verseKey(to) < verseKey(from)) return null;
  return { from, to };
}

/** "15:1–32", "15:30–16:8", as the demo writes a passage's verses. */
export function versesText(s: { from: VerseRef; to: VerseRef }): string {
  return s.from.c === s.to.c ? `${s.from.c}:${s.from.v}–${s.to.v}` : `${s.from.c}:${s.from.v}–${s.to.c}:${s.to.v}`;
}

/** Jump-bar label: a whole chapter reads "Ch 15", a part its verses. */
export function chipLabel(book: BibleBook, s: { from: VerseRef; to: VerseRef }): string {
  if (s.from.v === 1 && s.from.c === s.to.c && s.to.v === versesIn(book, s.to.c)) return t('content.chapterChip', { chapter: s.from.c });
  if (s.from.c === s.to.c) return s.from.v === s.to.v ? `${s.from.c}:${s.from.v}` : `${s.from.c}:${s.from.v}–${s.to.v}`;
  return versesText(s);
}

// ---- a language's template ----------------------------------------------------------

/** The library version a language records against. */
interface LanguageTemplate {
  itemId: string;
  docHash: string;
  /** The books it covers; null means every book. */
  books: string[] | null;
}

export function templateOf(state: LanguageState): LanguageTemplate | null {
  const sel = state.template?.value;
  return sel ? { itemId: sel.itemId, docHash: sel.docHash, books: sel.books ?? null } : null;
}

/** A template's levels, outermost first: Book › Chapter, Module › Lesson. */
export function docLevels(doc: TemplateDoc): string[] {
  return doc.levels.map((l) => l.name);
}

/** The word for what a language records: its template's last level ("Passage", "Chapter"), else the app's word. */
export function partName(doc?: TemplateDoc | null): string {
  return (doc ? docLevels(doc) : []).at(-1) ?? t('content.levels.passage');
}

/**
 * The word for what a language records, one and many: the template's last
 * level (the organization's word, made plural the demo's way), else the
 * app's own "Passage" and "Passages" in the language showing.
 */
export function partWords(doc?: TemplateDoc | null): { one: string; many: string } {
  const name = (doc ? docLevels(doc) : []).at(-1);
  // The organization's word made plural the English way only when the app speaks English: other
  // languages make plurals their own way, so the word stays as the organization wrote it.
  if (name) return { one: name, many: currentLanguage() === 'en' ? pluralOf(name) : name };
  return { one: t('content.levels.passage'), many: t('content.levels.passages') };
}

/** "passages", "stories": the demo's plural of a level name (the organization's word, so English rules). */
export function pluralOf(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** The number people see for one of an item's versions, or null when it is not one of them. */
export function versionNumber(item: LibraryItemView | null, docHash: string | null | undefined): number | null {
  return item?.versions.find((v) => v.docHash === docHash)?.n ?? null;
}

/** "FIA passages (English) · version 2", or "No template yet", for a language's row. */
export function templateLine(state: LanguageState, item: (itemId: string) => LibraryItemView | null): string {
  const sel = templateOf(state);
  if (!sel) return t('content.noTemplate');
  const it = item(sel.itemId);
  const n = versionNumber(it, sel.docHash);
  const name = it?.name ?? t('content.aTemplate');
  return n ? t('content.templateVersion', { name, n }) : name;
}

/**
 * Recorded parts set aside (TPL-7): units with a recording in this language
 * that its template no longer shows, because it switched templates, a new
 * version dropped them, or it narrowed its books. Switching back brings them
 * back; nothing was deleted.
 */
export function setAsideCount(state: LanguageState): number {
  const sel = state.template?.value;
  if (!sel) return 0;
  const books = sel.books ? new Set(sel.books) : null;
  const units = new Set<string>();
  for (const take of Object.values(state.takes)) {
    if (take.archived) continue;
    const prefix = unitPrefixOf(take.unitId);
    if (prefix === null) continue;
    const book = libraryUnitRange(take.unitId)?.book;
    if (prefix !== sel.unitPrefix) units.add(take.unitId);
    else if (state.hiddenUnits[take.unitId]?.value === true) units.add(take.unitId);
    else if (books && book && !books.has(book)) units.add(take.unitId);
  }
  return units.size;
}

/** Parts of the language that already have a recording: they never move on their own. */
export function recordedCount(state: LanguageState): number {
  const units = new Set<string>();
  for (const take of Object.values(state.takes)) if (!take.archived) units.add(take.unitId);
  return units.size;
}

// ---- choosing a template (TPL-1) -------------------------------------------------------------

/** The starter LangQuest suggests to a new organization. */
// i18n-ignore: LangQuest's starter by its library name, matched against what LangQuest shares
export const STARTER_TEMPLATE = { orgId: 'langquest', name: 'FIA passages (English)' } as const;

/** A template (or versification) someone can use: one of this organization's, or one another organization shares. */
export type LibraryChoice =
  | { key: string; source: 'ours'; item: LibraryItemView; name: string; hash: string }
  | { key: string; source: 'shared'; shared: SharedItem; name: string; hash: string };

/**
 * What to choose from, in order: this organization's items (made here,
 * copied, or followed) that have a version, then what other organizations
 * share that it does not follow already, LangQuest's first and `preferred`
 * first among those.
 */
export function libraryChoices(
  library: Record<string, LibraryItemState>, ours: LibraryItemView[], shared: SharedItem[], preferred?: string
): LibraryChoice[] {
  const own: LibraryChoice[] = ours
    .filter((it) => !it.archived && it.current)
    .map((item) => ({ key: `ours:${item.itemId}`, source: 'ours', item, name: item.name, hash: item.current! }));
  const rank = (s: SharedItem) => (s.org_id === STARTER_TEMPLATE.orgId ? (s.name === preferred ? 0 : 1) : 2);
  const others: LibraryChoice[] = shared
    .filter((s) => !library[subscriptionItemId(s.org_id, s.item_id)] && s.latest_hash)
    .sort((a, b) => rank(a) - rank(b) || a.org_name.localeCompare(b.org_name) || a.name.localeCompare(b.name))
    .map((s) => ({ key: `shared:${s.org_id}/${s.item_id}`, source: 'shared', shared: s, name: s.name, hash: s.latest_hash }));
  return [...own, ...others];
}

/** "Version 3 · copied from LangQuest" for ours, "From LangQuest · 2 versions" for a shared one. */
export function choiceLine(c: LibraryChoice, sourceLine: (it: LibraryItemView) => string): string {
  if (c.source === 'ours') return sourceLine(c.item);
  const n = c.shared.version_count;
  return n > 1 ? t('content.fromOrgVersions', { org: c.shared.org_name, count: n }) : t('content.fromOrg', { org: c.shared.org_name });
}

// ---- the template editor (TPL-9) --------------------------------------------------------------

/** What the template editor edits; `docFromForm` turns it into the next version. */
export interface TemplateForm {
  name: string;
  description: string;
  structure: 'bible' | 'outline';
  levels: { name: string; display?: LevelDisplay }[];
  /** Hash of the versification document (Bible). */
  versification: string | null;
  /** Books covered with their names in the language, in canon order. */
  books: { book: string; name: string }[];
  divide: 'books' | 'chapters' | 'passages';
  /** Kept from the version this started from; dividing books is later work (TPL-4..7). */
  passages: { ref: string; name?: string }[];
  /** A node with `children` is a folder, even while empty. */
  outline: OutlineNode[];
  /**
   * A template@2 Bible's books as they are broken up (decision 74), kept
   * whole: the editor names and chooses books, and each keeps its parts.
   * Absent for a template@1, which divides every book one way.
   */
  bookParts?: TemplateBook[];
  /** A template@2 Bible's numbering code and study pattern (decision 80), kept as they were. */
  numbering?: string;
  goesWith?: { pattern: string };
}

export function formFromDoc(doc: TemplateDoc, name = doc.name, description = doc.description): TemplateForm {
  return {
    name, description, structure: doc.structure,
    levels: doc.levels.map((l) => ({ ...l })),
    versification: doc.bible?.versification ?? null,
    books: sortBooks((doc.bible?.books ?? []).map((b) => ({ book: b.book, name: b.name }))),
    divide: doc.format === 'template@1' ? doc.bible?.divide ?? 'chapters' : 'passages',
    passages: doc.format === 'template@1' ? doc.bible?.passages ?? [] : [],
    outline: doc.outline ?? [],
    ...(doc.format === 'template@2' && doc.bible ? { bookParts: templateBooks(doc) } : {}),
    ...(doc.format === 'template@2' && doc.bible?.numbering ? { numbering: doc.bible.numbering } : {}),
    ...(doc.format === 'template@2' && doc.goesWith ? { goesWith: doc.goesWith } : {})
  };
}

/** The document for a form; `deps` are filled in when it is published (prepareDoc). */
export function docFromForm(f: TemplateForm): TemplateDoc {
  const base = { format: 'template@1' as const, name: f.name.trim(), description: f.description.trim(), structure: f.structure, levels: f.levels, deps: [] };
  if (f.structure === 'outline') return { ...base, outline: f.outline };
  if (f.bookParts) {
    // Each book keeps how it is broken up; a book added here waits to be broken up.
    const parts = new Map(f.bookParts.map((b) => [b.book, b]));
    return {
      ...base, format: 'template@2',
      bible: {
        versification: f.versification ?? '', books: sortBooks(f.books).map((b) => ({ ...(parts.get(b.book) ?? {}), book: b.book, name: b.name })),
        ...(f.numbering ? { numbering: f.numbering } : {})
      },
      ...(f.goesWith ? { goesWith: f.goesWith } : {})
    };
  }
  const books = sortBooks(f.books);
  const covered = new Set(books.map((b) => b.book));
  return {
    ...base,
    bible: {
      versification: f.versification ?? '',
      books,
      divide: f.divide,
      ...(f.divide === 'passages' ? { passages: f.passages.filter((p) => covered.has(p.ref.slice(0, 3))) } : {})
    }
  };
}

/** Whether a form differs from where it started, in what would be published. */
export function formChanged(a: TemplateForm, b: TemplateForm): boolean {
  return canonicalJson(docFromForm(a)) !== canonicalJson(docFromForm(b));
}

const sortBooks = (books: { book: string; name: string }[]) => [...books].sort((a, b) => bookOrder(a.book) - bookOrder(b.book));

/** The English name the app knows for a USFM book, else its code. */
export function englishBookName(usfm: string): string {
  return BIBLE_BOOKS.find((b) => b.itemId === bookIdOf(usfm))?.label ?? usfm;
}

/** The name the app shows for a USFM book, in the language showing ("Luke", "Lucas"), else its code. */
export function bookNameOf(usfm: string): string {
  const id = bookIdOf(usfm);
  const name = bookName(id);
  return name === id ? usfm : name;
}

/** Every book a versification has, in canon order. */
export function versificationBooks(v: VersificationDoc): string[] {
  return Object.keys(v.maxVerses).filter((b) => (v.maxVerses[b]?.length ?? 0) > 0).sort((a, b) => bookOrder(a) - bookOrder(b));
}

/** The 66 books of the Protestant canon that a versification has, with the app's names (in the language showing) to rename. */
export function defaultBooks(v: VersificationDoc): { book: string; name: string }[] {
  return versificationBooks(v).filter((b) => bookOrder(b) < 66).map((book) => ({ book, name: bookNameOf(book) }));
}

/** Levels for a Bible template's divide: Book, then Chapter or Passage. Names already given are kept. */
export function levelsForDivide(levels: TemplateForm['levels'], divide: TemplateForm['divide']): TemplateForm['levels'] {
  const book = t('content.levels.book');
  const want = divide === 'books' ? [{ name: book }] : [{ name: book }, { name: divide === 'chapters' ? t('content.levels.chapter') : t('content.levels.passage'), display: 'reference' as const }];
  if (levels.length === want.length) return levels;
  return want.map((w, i) => (i === 0 && levels[0] ? levels[0] : w));
}

/** A new template: a Bible one from a versification, or an empty outline (the demo's New Template). */
export function newTemplateForm(structure: 'bible' | 'outline', versification?: { hash: string; doc: VersificationDoc }): TemplateForm {
  if (structure === 'outline') {
    return {
      name: '', description: '', structure, levels: [{ name: t('content.levels.section') }, { name: t('content.levels.lesson'), display: 'name' }],
      versification: null, books: [], divide: 'chapters', passages: [], outline: []
    };
  }
  return {
    name: '', description: '', structure,
    levels: [{ name: t('content.levels.book') }, { name: t('content.levels.chapter'), display: 'reference' }],
    versification: versification?.hash ?? null,
    books: versification ? defaultBooks(versification.doc) : [],
    divide: 'chapters', passages: [], outline: []
  };
}

// ---- outline editing (one scroll, TPL-9) -----------------------------------------------------

export function findNode(list: OutlineNode[], id: string): OutlineNode | undefined {
  for (const n of list) {
    if (n.id === id) return n;
    const hit = n.children && findNode(n.children, id);
    if (hit) return hit;
  }
  return undefined;
}

/** The list a node sits in, for Move up / Move down. */
export function siblingsOf(list: OutlineNode[], id: string): OutlineNode[] {
  if (list.some((n) => n.id === id)) return list;
  for (const n of list) {
    const hit = n.children ? siblingsOf(n.children, id) : [];
    if (hit.length) return hit;
  }
  return [];
}

function mapNodes(list: OutlineNode[], fn: (n: OutlineNode) => OutlineNode | null): OutlineNode[] {
  return list.flatMap((n) => {
    const next = fn(n);
    if (!next) return [];
    return [next.children ? { ...next, children: mapNodes(next.children, fn) } : next];
  });
}

/** Add a folder or an item at the end of a folder (or at the top when `parentId` is null). */
export function addNode(list: OutlineNode[], parentId: string | null, node: { id: string; title: string; folder: boolean }): OutlineNode[] {
  const fresh: OutlineNode = { id: node.id, title: node.title, ...(node.folder ? { children: [] } : {}) };
  if (parentId === null) return [...list, fresh];
  return mapNodes(list, (n) => (n.id === parentId ? { ...n, children: [...(n.children ?? []), fresh] } : n));
}

export function renameNode(list: OutlineNode[], id: string, title: string): OutlineNode[] {
  return mapNodes(list, (n) => (n.id === id ? { ...n, title } : n));
}

export function removeNode(list: OutlineNode[], id: string): OutlineNode[] {
  return mapNodes(list, (n) => (n.id === id ? null : n));
}

export function moveNode(list: OutlineNode[], id: string, by: number): OutlineNode[] {
  const i = list.findIndex((n) => n.id === id);
  if (i >= 0) {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  }
  return list.map((n) => (n.children ? { ...n, children: moveNode(n.children, id, by) } : n));
}

/** An outline deeper than its named levels gets a level for each extra depth (the demo's levelsFor). */
export function levelsForOutline(outline: OutlineNode[], levels: TemplateForm['levels']): TemplateForm['levels'] {
  const depth = (list: OutlineNode[]): number => (list.length ? 1 + Math.max(...list.map((n) => (n.children ? depth(n.children) : 0))) : 1);
  const need = depth(outline);
  if (levels.length >= need) return levels;
  return [...levels.slice(0, -1), ...Array.from({ length: need - levels.length }, () => ({ name: t('content.levels.part') })), levels[levels.length - 1]!];
}

/** Folders and items under a node, for its one-line summary. */
export function countOutline(list: OutlineNode[]): { folders: number; items: number } {
  let folders = 0;
  let items = 0;
  for (const n of list) {
    if (n.children) {
      folders++;
      const c = countOutline(n.children);
      folders += c.folders;
      items += c.items;
    } else items++;
  }
  return { folders, items };
}

// ---- a language's books ------------------------------------------------------------------

const booksCache = new WeakMap<LanguageState, Map<string, string[]>>();

/** The language's units grouped by Bible book, in canon order within each book. Cached per fold revision. */
function unitsByBook(state: LanguageState, idx: Indexes): Map<string, string[]> {
  const hit = booksCache.get(state);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  for (const unitId of languagePassages(state, idx)) {
    const bookId = unitPlace(state, unitId).bookId;
    if (!bookId) continue;
    const list = out.get(bookId);
    if (list) list.push(unitId);
    else out.set(bookId, [unitId]);
  }
  booksCache.set(state, out);
  return out;
}

interface BookRow {
  book: BibleBook;
  /** What the language calls it (a library template names its books). */
  label: string;
  parts: number;
}

/** The books a language divides, in canon order, with how many parts each has. */
export function bookRows(state: LanguageState, idx: Indexes): BookRow[] {
  const byBook = unitsByBook(state, idx);
  return BIBLE_BOOKS.filter((b) => byBook.has(b.itemId)).map((book) => {
    const units = byBook.get(book.itemId)!;
    return { book, label: unitPlace(state, units[0]!).bookLabel || bookName(book.itemId), parts: units.length };
  });
}

/** Where a USFM book sits among the 66, for testament checks: the first 39 are the Old Testament. */
export const canonIndex = (usfm: string): number => (USFM_BOOKS as readonly string[]).indexOf(usfm);

// ---- a book's passages as segments (demo boundaries.ts) ------------------------------------

export interface Segment {
  unitId: string;
  from: VerseRef;
  to: VerseRef;
}

/**
 * The language's parts in a book, as verse ranges in order. A part that
 * starts inside the one before (FIA's "9b") starts after it, so every verse
 * belongs to at most one part. Units that do not read are left out.
 */
export function toSegments(book: BibleBook, units: { unitId: string; label: string }[]): Segment[] {
  const raw = units.flatMap((u) => {
    const r = rangeOfUnit(u.unitId, u.label, book);
    return r ? [{ unitId: u.unitId, ...r }] : [];
  }).sort((a, b) => verseKey(a.from) - verseKey(b.from));
  const out: Segment[] = [];
  for (const s of raw) {
    const prev = out.at(-1);
    let from = s.from;
    if (prev && verseKey(from) <= verseKey(prev.to)) {
      from = prev.to.v < versesIn(book, prev.to.c) ? { c: prev.to.c, v: prev.to.v + 1 } : { c: prev.to.c + 1, v: 1 };
      if (verseKey(from) > verseKey(s.to)) continue;
    }
    out.push({ unitId: s.unitId, from, to: s.to });
  }
  return out;
}

export function bookSegments(state: LanguageState, idx: Indexes, book: BibleBook): Segment[] {
  const units = unitsByBook(state, idx).get(book.itemId) ?? [];
  return toSegments(book, units.map((unitId) => ({ unitId, label: state.units[unitId]?.label ?? '' })));
}

/** Where FIA starts its passages in a book (TPL-5), as verse keys. Empty for books FIA does not cover. */
export function fiaStarts(book: BibleBook): Set<number> {
  const out = new Set<number>();
  for (const p of FIA_PERICOPES) {
    if (bookIdFromFia(p.book) !== book.itemId) continue;
    const r = parseRange(p.verseRange, book);
    if (r) out.add(verseKey(r.from));
  }
  return out;
}

export type Block =
  | { kind: 'card'; seg: Segment; n: number }
  | { kind: 'fia'; at: VerseRef }
  | { kind: 'gap'; from: number }
  | { kind: 'para'; seg: Segment | null; n: number; verses: { v: number; text?: string }[] };

/**
 * One chapter as the demo lays it out: a card where each part starts, a
 * quiet FIA suggestion where FIA starts one and the language does not, a
 * note where verses belong to no part, and the verses in runs by part.
 */
export function chapterBlocks(book: BibleBook, c: number, segments: Segment[], fia: Set<number>, text: (c: number, v: number) => string | undefined): Block[] {
  const blocks: Block[] = [];
  const inChapter = segments
    .map((seg, i) => ({ seg, n: i + 1 }))
    .filter(({ seg }) => verseKey(seg.from) <= verseKey({ c, v: 999 }) && verseKey(seg.to) >= verseKey({ c, v: 1 }));
  const segOf = (r: VerseRef) => inChapter.find(({ seg }) => verseKey(seg.from) <= verseKey(r) && verseKey(r) <= verseKey(seg.to)) ?? null;
  let para: Extract<Block, { kind: 'para' }> | null = null;
  let inGap = false;
  for (let v = 1; v <= versesIn(book, c); v++) {
    const r = { c, v };
    const hit = segOf(r);
    const startsHere = !!hit && verseKey(hit.seg.from) === verseKey(r);
    if (startsHere) { blocks.push({ kind: 'card', seg: hit.seg, n: hit.n }); para = null; }
    else if (fia.has(verseKey(r))) { blocks.push({ kind: 'fia', at: r }); para = null; }
    if (!hit && !inGap) { blocks.push({ kind: 'gap', from: v }); para = null; }
    inGap = !hit;
    if (!para || para.seg !== (hit?.seg ?? null)) {
      para = { kind: 'para', seg: hit?.seg ?? null, n: hit?.n ?? 0, verses: [] };
      blocks.push(para);
    }
    const words = text(c, v);
    para.verses.push(words === undefined ? { v } : { v, text: words });
  }
  return blocks;
}

/** The part a chapter opens inside of, when it started in an earlier chapter. */
export function continuesInto(segments: Segment[], c: number): Segment | null {
  const r = verseKey({ c, v: 1 });
  return segments.find((s) => verseKey(s.from) < r && verseKey(s.to) >= r) ?? null;
}
