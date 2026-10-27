// What the Guides and notes screen shows (screens/reference.tsx;
// docs/reference-material.md): the items it lists, its filters and their
// count, the order the rows come in and each row's line. Pure: no React, so
// it is tested.
import type { LanguageState, Register } from '@langquest-next/core';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { sourceLine } from '../library/model';
import { list } from './biblesModel';
import { itemReaches, type Reach } from './coverage';
import { docLanguage, languagesLine } from './languages';
import { booksOf, recLabel, recOn, recState, refKindLabel, type Level } from './model';
import type { RefItem } from './useReference';

export type KindFilter = 'all' | 'guide' | 'note' | 'words' | 'other';
export const KIND_FILTERS: KindFilter[] = ['all', 'guide', 'note', 'words', 'other'];
export function kindFilterLabel(k: KindFilter): string {
  switch (k) {
    case 'all': return t('reference.guides.kindAll');
    case 'guide': return t('reference.guides.kindGuides');
    case 'note': return t('reference.guides.kindNotes');
    case 'words': return t('reference.guides.kindWords');
    case 'other': return t('reference.guides.kindOther');
  }
}

/** The filters on the list: what kind, in which language, about which book, and whether it reaches the open language's passages. */
export interface GuideFilters { kind: KindFilter; language: string | null; book: string | null; covers: boolean }

/** The items the screen lists: guides, notes, key-word lists (decision 172) and other material that are not archived. */
export function guideItems(rows: RefItem[]): RefItem[] {
  return rows.filter((r) => r.kind === 'guide' || r.kind === 'note' || r.kind === 'words' || r.kind === 'other').filter((r) => !r.it.archived);
}

/** The languages and books the filter sheet offers: those the items have. */
export function filterOptions(items: RefItem[]): { languages: string[]; books: string[] } {
  return {
    languages: [...new Set(items.map((r) => docLanguage(r.doc)).filter((l): l is string => !!l))].sort(),
    books: [...new Set(items.flatMap((r) => booksOf(r.doc)))]
  };
}

/** The items that pass the filters; `reach` (when covering is on and worked out) keeps only those reaching a passage. */
export function filterGuides(items: RefItem[], f: GuideFilters, reach: Map<string, Reach[]> | null): RefItem[] {
  return items.filter((r) => (f.kind === 'all' || r.kind === f.kind)
    && (!f.language || docLanguage(r.doc) === f.language)
    && (!f.book || booksOf(r.doc).includes(f.book))
    && (!reach || itemReaches(reach, r.it.itemId) > 0));
}

/** How many filters are set, for the Filter chip. */
export function activeFilterCount(f: GuideFilters): number {
  return [f.kind !== 'all', !!f.language, !!f.book, f.covers].filter(Boolean).length;
}

/** The listed items with their recommendation at this level, recommended first, then by name. */
export function guideRows(shown: RefItem[], orgRecs: Record<string, Register<boolean>> | undefined, state: LanguageState | null, level: Level) {
  return shown.map((r) => {
    const st = recState(orgRecs, state, level, r.it.itemId);
    return { r, st, label: recLabel(st, level) };
  }).sort((a, b) => Number(!recOn(a.st)) - Number(!recOn(b.st)) || a.r.it.name.localeCompare(b.r.it.name));
}

/** A row's line: kind, language, books, passages or words, and how many passages it reaches when that is known. */
export function guideLine(r: RefItem, reaches: number | null): string {
  const doc = r.doc;
  // Every item says its language, or that it gives none, so whoever chooses knows whether the team can read it (decision 84).
  const parts: string[] = [refKindLabel(r.kind ?? 'other'), languagesLine([docLanguage(doc)])];
  if (doc?.format === 'collection@1') parts.push(t('reference.passages', { count: doc.entries.length }));
  // A key-word list says how many words it has; its words' verses span the Bible, so no books.
  else if (doc?.format === 'material@1' && doc.kind === 'key_terms') parts.push(t('reference.words', { count: doc.terms?.length ?? 0 }));
  else {
    const books = booksOf(doc);
    if (books.length) parts.push(books.length > 3 ? t('reference.guides.booksMore', { books: list(books.slice(0, 3)), more: formatNumber(books.length - 3) }) : list(books));
    if (doc && 'links' in doc && doc.links?.some((l) => 'node' in l)) parts.push(t('reference.guides.templateParts'));
  }
  if (reaches !== null) parts.push(t('reference.guides.reaches', { count: reaches }));
  parts.push(sourceLine(r.it));
  return parts.join(' · ');
}
