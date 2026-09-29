// Pure reading of content templates for the content screens (screens/content.tsx),
// ported from the UX demo's src/content.ts and src/domain/boundaries.ts
// (TPL-1..9, ADR-025..027). Everything here is derived from the fold and
// core's catalog; nothing is stored. A language's passages in a book are
// its template's units in that book, read as verse ranges; FIA's breaks are
// read from core's bundled pericope list.
import {
  CATALOG_VERSION, catalogKey, contentTemplate, instantiateTemplate, laneLeafUnits, templateOfUnit, unitPlace,
  type ContentTemplate, type EventSpec, type Indexes, type OrgState, type ProjectState, type TemplateItem
} from '@langquest-next/core';
// Core does not export its canon data from its index yet (see the port report);
// this reaches the same file core itself reads.
import { BIBLE_BOOKS, FIA_PERICOPES, type BibleBook } from '@langquest-next/core';

export type { BibleBook };

// ---- verses and ranges -----------------------------------------------------------

export type VerseRef = { c: number; v: number };
export const verseKey = (r: VerseRef): number => r.c * 1000 + r.v;

/** FIA's seeds spell Mark and John differently from the canon list. */
const bookIdOf = (id: string): string => (id === 'mrk' ? 'mar' : id === 'jhn' ? 'joh' : id);

export function bibleBook(bookId: string): BibleBook | undefined {
  const id = bookIdOf(bookId);
  return BIBLE_BOOKS.find((b) => b.itemId === id);
}

export function versesIn(book: BibleBook, chapter: number): number {
  return book.verses[chapter - 1] ?? 0;
}

export function lastVerse(book: BibleBook): VerseRef {
  const c = book.verses.length;
  return { c, v: versesIn(book, c) };
}

/**
 * A reference within a book as a verse range: "15" is the whole chapter,
 * "15-16" two chapters, "15:11-32", "1:1-2:3", "12:9b-20" (partial verses
 * count as the whole verse). Hyphen or en dash. Null when it does not parse.
 */
export function parseRange(ref: string, book: BibleBook): { from: VerseRef; to: VerseRef } | null {
  const m = /^(\d+)(?::(\d+)[a-z]?)?(?:\s*[-–]\s*(\d+)[a-z]?(?::(\d+)[a-z]?)?)?$/.exec(ref.trim());
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

/** "15:1–32", "15:30–16:8", as the demo writes a passage's verses. */
export function versesText(s: { from: VerseRef; to: VerseRef }): string {
  return s.from.c === s.to.c ? `${s.from.c}:${s.from.v}–${s.to.v}` : `${s.from.c}:${s.from.v}–${s.to.c}:${s.to.v}`;
}

/** Jump-bar label: a whole chapter reads "Ch 15", a part its verses. */
export function chipLabel(book: BibleBook, s: { from: VerseRef; to: VerseRef }): string {
  if (s.from.v === 1 && s.from.c === s.to.c && s.to.v === versesIn(book, s.to.c)) return `Ch ${s.from.c}`;
  if (s.from.c === s.to.c) return s.from.v === s.to.v ? `${s.from.c}:${s.from.v}` : `${s.from.c}:${s.from.v}–${s.to.v}`;
  return versesText(s);
}

// ---- a language's template ----------------------------------------------------------

/** The catalog template a language records against, or undefined when none is chosen. */
export function laneTemplate(state: ProjectState, laneId: string): ContentTemplate | undefined {
  const sel = state.laneTemplates[laneId]?.value;
  return sel ? contentTemplate(sel.templateId) : undefined;
}

/** A template's levels, outermost first: Book › Chapter, Book › Passage. */
export function templateLevels(t: ContentTemplate): string[] {
  return t.unitKinds.map((k) => k.label);
}

/** The word for what a language records: its template's last level ("Passage", "Chapter"). */
export function partName(state: ProjectState, laneId: string): string {
  const t = laneTemplate(state, laneId);
  return t ? templateLevels(t).at(-1) ?? 'Passage' : 'Passage';
}

/** "passages", "stories": the demo's plural of a level name. */
export function pluralOf(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** How each library template reads: its books, and what it divides them into. */
export function templateLeafCount(t: ContentTemplate): number {
  const leaf = new Set(t.unitKinds.filter((k) => k.childKinds.length === 0).map((k) => k.id));
  return t.items.filter((it) => leaf.has(it.kind)).length;
}

/** The library template's outline: each top-level folder with what it holds, in order (TPL-2). */
export function templateOutline(t: ContentTemplate): { folder: TemplateItem; items: TemplateItem[] }[] {
  const children = new Map<string, TemplateItem[]>();
  const roots: TemplateItem[] = [];
  for (const it of t.items) {
    if (it.parentItemId === null) roots.push(it);
    else {
      const list = children.get(it.parentItemId);
      if (list) list.push(it);
      else children.set(it.parentItemId, [it]);
    }
  }
  const byOrder = (a: TemplateItem, b: TemplateItem) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
  return roots.sort(byOrder).map((folder) => ({ folder, items: (children.get(folder.itemId) ?? []).sort(byOrder) }));
}

/** Which template each language in the project uses. */
export function templateUsage(state: ProjectState): { laneId: string; templateId: string | null }[] {
  return Object.keys(state.lanes).sort().map((laneId) => ({ laneId, templateId: state.laneTemplates[laneId]?.value.templateId ?? null }));
}

/**
 * Recorded parts set aside because the language switched templates (TPL-7):
 * units from another template that have a recording in this language.
 * Switching back brings them back; nothing was deleted.
 */
export function setAsideCount(state: ProjectState, laneId: string): number {
  const sel = state.laneTemplates[laneId]?.value;
  if (!sel) return 0;
  const units = new Set<string>();
  for (const t of Object.values(state.takes)) {
    if (t.laneId !== laneId || t.archived) continue;
    const from = templateOfUnit(t.unitId);
    if (from && (from.templateId !== sel.templateId || from.catalogVersion !== sel.catalogVersion)) units.add(t.unitId);
  }
  return units.size;
}

/** Parts of a language that already have a recording: they never move on their own. */
export function recordedCount(state: ProjectState, laneId: string): number {
  const units = new Set<string>();
  for (const t of Object.values(state.takes)) if (t.laneId === laneId && !t.archived) units.add(t.unitId);
  return units.size;
}

// ---- suggestions (TPL-1) --------------------------------------------------------------

/** Suggested at exactly this level: advice is opt-in, so only an explicit toggle counts. */
export function suggestedAt(org: OrgState | null, templateId: string, level: 'org' | 'project', projectId?: string): boolean {
  if (!org) return false;
  return org.catalog[catalogKey('template', templateId, level, level === 'project' ? projectId : undefined)]?.value === true;
}

/**
 * What the languages of a project are advised to start from, and who said
 * so: the project's own suggestions, then the organization's unless the
 * project turned one off.
 */
export function suggestionsFor(org: OrgState | null, projectId: string, library: ContentTemplate[]): { templateId: string; by: 'org' | 'project' }[] {
  if (!org) return [];
  const out: { templateId: string; by: 'org' | 'project' }[] = [];
  for (const t of library) {
    const project = org.catalog[catalogKey('template', t.id, 'project', projectId)]?.value;
    if (project === true) out.push({ templateId: t.id, by: 'project' });
    else if (project !== false && suggestedAt(org, t.id, 'org')) out.push({ templateId: t.id, by: 'org' });
  }
  return out;
}

// ---- choosing a template (the old TemplatesHome, as specs) ----------------------------

/**
 * Use a catalog template for a language: the selection and every unit it
 * implies that the fold does not hold yet (ids are deterministic, so a
 * second device choosing the same template adds nothing twice).
 */
export function templateSelectionSpecs(state: ProjectState, laneId: string, templateId: string, commandId: string): EventSpec[] {
  let n = 0;
  const id = () => `${commandId}:${n++}`;
  const specs: EventSpec[] = [
    { id: id(), type: 'v1.LaneTemplateSelected', payload: { laneId, templateId, catalogVersion: CATALOG_VERSION } }
  ];
  for (const payload of instantiateTemplate(templateId)) {
    if (!state.units[payload.unitId]) specs.push({ id: id(), type: 'v1.UnitAdded', payload });
  }
  return specs;
}

/** Undo of a change of template: select the one before again (its units are still there). */
export function templateRestoreSpecs(laneId: string, previous: { templateId: string; catalogVersion: number }, commandId: string): EventSpec[] {
  return [{ id: `${commandId}:0`, type: 'v1.LaneTemplateSelected', payload: { laneId, templateId: previous.templateId, catalogVersion: previous.catalogVersion } }];
}

// ---- a language's books ------------------------------------------------------------------

const booksCache = new WeakMap<ProjectState, Map<string, Map<string, string[]>>>();

/** A language's units grouped by Bible book, in canon order within each book. Cached per fold revision. */
export function laneUnitsByBook(state: ProjectState, idx: Indexes, laneId: string): Map<string, string[]> {
  let perLane = booksCache.get(state);
  if (!perLane) {
    perLane = new Map();
    booksCache.set(state, perLane);
  }
  const hit = perLane.get(laneId);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  for (const unitId of laneLeafUnits(state, idx, laneId)) {
    const bookId = unitPlace(state, unitId).bookId;
    if (!bookId) continue;
    const list = out.get(bookId);
    if (list) list.push(unitId);
    else out.set(bookId, [unitId]);
  }
  perLane.set(laneId, out);
  return out;
}

export interface BookRow {
  book: BibleBook;
  parts: number;
}

/** The books a language divides, in canon order, with how many parts each has. */
export function bookRows(state: ProjectState, idx: Indexes, laneId: string): BookRow[] {
  const byBook = laneUnitsByBook(state, idx, laneId);
  return BIBLE_BOOKS.filter((b) => byBook.has(b.itemId)).map((book) => ({ book, parts: byBook.get(book.itemId)!.length }));
}

// ---- a book's passages as segments (demo boundaries.ts) ------------------------------------

export interface Segment {
  unitId: string;
  from: VerseRef;
  to: VerseRef;
}

/**
 * The language's parts in a book, as verse ranges in order. A part that
 * starts inside the one before (FIA's "9b") starts after it, so every verse
 * belongs to at most one part. Units whose label does not parse are left out.
 */
export function toSegments(book: BibleBook, units: { unitId: string; label: string }[]): Segment[] {
  const raw = units.flatMap((u) => {
    const r = rangeOfLabel(u.label, book);
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

export function bookSegments(state: ProjectState, idx: Indexes, laneId: string, book: BibleBook): Segment[] {
  const units = laneUnitsByBook(state, idx, laneId).get(book.itemId) ?? [];
  return toSegments(book, units.map((unitId) => ({ unitId, label: state.units[unitId]?.label ?? '' })));
}

/** Where FIA starts its passages in a book (TPL-5), as verse keys. Empty for books FIA does not cover. */
export function fiaStarts(book: BibleBook): Set<number> {
  const out = new Set<number>();
  for (const p of FIA_PERICOPES) {
    if (bookIdOf(p.book) !== book.itemId) continue;
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
    const t = text(c, v);
    para.verses.push(t === undefined ? { v } : { v, text: t });
  }
  return blocks;
}

/** The part a chapter opens inside of, when it started in an earlier chapter. */
export function continuesInto(segments: Segment[], c: number): Segment | null {
  const r = verseKey({ c, v: 1 });
  return segments.find((s) => verseKey(s.from) < r && verseKey(s.to) >= r) ?? null;
}
