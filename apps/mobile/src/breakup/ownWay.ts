// Dividing a book your own way (decision 93; demo ADR-041): the book as its
// verses in order, and the sections as the verses they start at. Starting a
// section at a verse adds a start; joining one with the one before removes
// it. A ready-made way, or the book as the language has it now, gives the
// starts to begin from. What is drawn is kept as a private draft until Done
// (decision 112), which makes a way with just this book in it, applied like
// any other way (core withBookBrokenUp). Pure.
import {
  bookParts, formatRef, parseRef, refId, renumberedParts,
  type TemplateBook, type TemplateDoc, type TemplateDocV2, type VersificationDoc
} from '@langquest-next/core';
import { isRecord } from '../drafts/draftModel';

/** A verse as "chapter:verse". */
export type At = string;
export const atOf = (chapter: number, verse: number): At => `${chapter}:${verse}`;
export function parseAt(at: At): { chapter: number; verse: number } {
  const [chapter, verse] = at.split(':').map(Number) as [number, number];
  return { chapter, verse };
}

/** Every verse of a book in order, from its numbering ("1:1" … "16:27"). */
export function verseOrder(maxVerses: readonly number[]): At[] {
  return maxVerses.flatMap((n, i) => Array.from({ length: n }, (_, v) => atOf(i + 1, v + 1)));
}

export interface Section {
  start: At;
  end: At;
  verses: number;
}

/** The sections the starts make, in order; the book's first verse always starts one. */
export function sectionsOf(order: readonly At[], starts: ReadonlySet<At>): Section[] {
  const out: Section[] = [];
  for (const at of order) {
    const last = out[out.length - 1];
    if (!last || starts.has(at)) out.push({ start: at, end: at, verses: 1 });
    else { last.end = at; last.verses++; }
  }
  return out;
}

/** "1:18–32", "1:18–2:5", "7:7". */
export function sectionLabel(s: Pick<Section, 'start' | 'end'>): string {
  if (s.start === s.end) return s.start;
  const a = parseAt(s.start);
  const b = parseAt(s.end);
  return a.chapter === b.chapter ? `${s.start}–${b.verse}` : `${s.start}–${s.end}`;
}

/**
 * Where a way (or the language's own template) starts this book's parts: each
 * chapter, each passage, or the whole book. Empty when it does not divide the book.
 */
export function startsOfWay(way: TemplateDoc | null, book: string, v11n: VersificationDoc | null): Set<At> {
  const parts = way ? bookParts(way, book) : null;
  const out = new Set<At>();
  if (!parts) return out;
  if (parts.divide === 'book') out.add('1:1');
  if (parts.divide === 'chapters') (v11n?.maxVerses[book] ?? []).forEach((_, i) => out.add(atOf(i + 1, 1)));
  if (parts.divide === 'passages') {
    for (const p of parts.passages ?? []) {
      const r = parseRef(p.ref, v11n ? (b, c) => v11n.maxVerses[b]?.[c - 1] : undefined);
      if (r) out.add(atOf(r.start.chapter, r.start.verse));
    }
  }
  return out;
}

/** The names a template gives this book's passages, by the verse each starts at. */
export function namesOfWay(way: TemplateDoc | null, book: string): Record<At, string> {
  const out: Record<At, string> = {};
  for (const p of (way ? bookParts(way, book)?.passages : undefined) ?? []) {
    const r = parseRef(p.ref);
    if (r && p.name) out[atOf(r.start.chapter, r.start.verse)] = p.name;
  }
  return out;
}

/**
 * A way with just this book in it, divided at `sections`, each with its name
 * if it has one. In a numbering other than English, the sections whose verses
 * differ from the same numbers in English are marked (`renumbered`, decision 80).
 */
export function ownWayDoc(c: {
  base: TemplateDoc; book: string; bookName: string; part: string; sections: readonly Section[]; names: Readonly<Record<At, string>>;
  v11n: VersificationDoc | null; english: VersificationDoc | null;
}): TemplateDocV2 {
  const passages = c.sections.map((s) => {
    const start = parseAt(s.start);
    const end = parseAt(s.end);
    const name = c.names[s.start]?.trim();
    return { ref: formatRef({ book: c.book, start, end }), ...(name ? { name } : {}) };
  });
  const out: TemplateBook = { book: c.book, name: c.bookName, divide: 'passages', part: c.part, passages };
  const numbering = c.base.format === 'template@2' ? c.base.bible?.numbering : undefined;
  if (numbering && c.v11n && c.english && c.v11n.code !== c.english.code) {
    const nodes = passages.map((p) => parseRef(p.ref)).filter((r): r is NonNullable<typeof r> => !!r).map(refId);
    const changed = renumberedParts(nodes, c.english, c.v11n);
    if (changed.length) out.renumbered = changed;
  }
  return {
    format: 'template@2', name: c.base.name, description: c.base.description, structure: 'bible', levels: c.base.levels,
    bible: { versification: c.base.bible!.versification, books: [out], ...(numbering ? { numbering } : {}) },
    deps: []
  };
}

/** The sections being drawn: the verses they start at, and the names given them. */
export interface Drawn {
  starts: ReadonlySet<At>;
  names: Readonly<Record<At, string>>;
}

/** What is drawn, kept on this phone until Done (useDraft, decision 112). Empty: nothing changed. */
export interface OwnWayDraft {
  starts: At[];
  names: Record<At, string>;
}

export const EMPTY_OWN_WAY: OwnWayDraft = { starts: [], names: {} };

export function isOwnWayDraft(x: unknown): x is OwnWayDraft {
  if (!isRecord(x) || !Array.isArray(x['starts']) || !isRecord(x['names'])) return false;
  return x['starts'].every((s) => typeof s === 'string') && Object.values(x['names']).every((n) => typeof n === 'string');
}

/** What the editor shows: the draft's sections when there is one, else the book as it was. */
export function drawnFrom(draft: OwnWayDraft, was: Drawn): Drawn {
  return draft.starts.length ? { starts: new Set(draft.starts), names: draft.names } : was;
}

/**
 * The draft for what is drawn now: empty when it is the book as it was, so
 * nothing is kept. The book's first verse always starts a section, so it is
 * kept as a start: a draft is never empty by accident.
 */
export function draftOf(now: Drawn, was: Drawn, firstVerse: At | undefined): OwnWayDraft {
  const starts = (s: ReadonlySet<At>) => (firstVerse ? new Set(s).add(firstVerse) : new Set(s));
  const a = starts(now.starts);
  const b = starts(was.starts);
  const sameStarts = a.size === b.size && [...a].every((at) => b.has(at));
  const sameNames = Object.keys({ ...now.names, ...was.names }).every((k) => (now.names[k] ?? '').trim() === (was.names[k] ?? '').trim());
  return sameStarts && sameNames ? EMPTY_OWN_WAY : { starts: [...a], names: { ...now.names } };
}
