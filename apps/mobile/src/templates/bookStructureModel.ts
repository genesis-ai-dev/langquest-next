// What the Divide a Book screen derives from the open language: the book's
// parts, which are recorded, the words under each verse, and the chapter
// jump grid. Pure: no React, no I/O (decision 105; TPL-5, ADR-027).
import { languageLines, languageName, type Indexes, type LanguageState, type OrgState, type PassageLines } from '@langquest-next/core';
import { bookRows, bookSegments, fiaStarts, type BibleBook, type Segment } from './contentTemplatesModel';
import { bookName } from '../i18n/coreText';
import { t } from '../i18n';
import { readingsFor } from '../passage/scripture';
import { lower } from './model';

export interface BookStructureData {
  language: string;
  label: string;
  segments: Segment[];
  recorded: Set<string>;
  textOf: (c: number, v: number) => string | undefined;
  translation: Map<number, string>;
  fia: Set<number>;
}

/** The book as the open language divides it, with the words of each verse where the app has them. */
export function bookStructureData(
  state: LanguageState, idx: Indexes, book: BibleBook, org: OrgState | null, languageId: string, lines: PassageLines = languageLines(state, idx)
): BookStructureData {
  const segments = bookSegments(state, idx, book);
  // Which are recorded, read off the passages' lines (decisions.md 143).
  const recorded = new Set(segments.filter((s) => lines.get(s.unitId).recorded).map((s) => s.unitId));
  // The words, where the app has them (scripture.ts); verse numbers otherwise.
  const text = new Map<string, string>();
  const translation = new Map<number, string>();
  for (const s of segments) {
    const reading = readingsFor(state, s.unitId)[0];
    if (!reading) continue;
    for (const v of reading.verses) {
      text.set(`${v.chapter}:${v.verse}`, v.text);
      translation.set(v.chapter, reading.code);
    }
  }
  // FIA's breaks show only where the language divides differently (TPL-5): where a part starts there, no mark.
  const textOf = (c: number, v: number) => text.get(`${c}:${v}`);
  const label = bookRows(state, idx).find((r) => r.book.itemId === book.itemId)?.label ?? bookName(book.itemId);
  return { language: languageName(org, languageId), label, segments, recorded, textOf, translation, fia: fiaStarts(book) };
}

/** Chapter numbers 1..n, one per list row. */
export const chapterNumbers = (book: BibleBook): number[] => book.verses.map((_, i) => i + 1);

/** How many parts start in a chapter. */
export const partsStartingIn = (segments: Segment[], c: number): number => segments.filter((s) => s.from.c === c).length;

/** The spoken label of a chapter tile: "Chapter 3", or "Chapter 3, 2 stories" when several parts start there. */
export function chapterTileLabel(c: number, n: number, part: string, parts: string): string {
  return n > 1 ? t('content.book.chapterParts', { chapter: c, count: n, part: lower(part), parts }) : t('content.book.chapter', { chapter: c });
}
