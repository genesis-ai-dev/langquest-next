import { BIBLE_BOOKS } from './catalogData';
import { BIBLE_SECTIONS } from './bibleData/sections';
import { BSB_VERSES } from './bibleData/text';
import { BSB_STATISTICS } from './bibleData/statistics';
import { rankTerms, termsAtDensity, type RankedTerm } from './keyTermScoring';
import { sqlBlank } from './sqlText';
import type { ProjectState } from './state';

export const DYNAMIC_BIBLE_TEMPLATE = 'dynamic';
export const BIBLE_DATA_VERSION = 1;
export const bibleBooks = BIBLE_BOOKS;
export type BibleRange = { book: string; start: number; end: number };
export type BibleSettings = {
  laneId: string;
  density: number;
  sourceId: 'bsb';
  /** Optional additional reference audio. BSB remains the term text. */
  audioFilesetId?: string;
};
export type BibleEvents = {
  'v1.BibleSettingsSet': BibleSettings;
  'v1.BiblePassageSelected': BibleRange & { laneId: string };
};

export function bibleSettings(state: ProjectState, laneId: string): BibleSettings {
  return state.bibleSettings[laneId]?.value ?? { laneId, density: 35, sourceId: 'bsb' };
}
export function bibleVerseCount(book: string): number {
  return BIBLE_BOOKS.find(b => b.itemId === book)?.verses.reduce((a, b) => a + b, 0) ?? 0;
}
export function validBibleRange(range: BibleRange): boolean {
  return Number.isInteger(range.start) && Number.isInteger(range.end) &&
    range.start >= 1 && range.end >= range.start && range.end <= bibleVerseCount(range.book);
}
export function verseAddress(bookId: string, ordinal: number) {
  const book = BIBLE_BOOKS.find(b => b.itemId === bookId);
  if (!book || !Number.isInteger(ordinal) || ordinal < 1) return null;
  let rest = ordinal;
  for (let i = 0; i < book.verses.length; i++) {
    if (rest <= book.verses[i]!) return { chapter: i + 1, verse: rest };
    rest -= book.verses[i]!;
  }
  return null;
}
export function bibleRangeLabel(range: BibleRange): string {
  const book = BIBLE_BOOKS.find(b => b.itemId === range.book);
  const start = verseAddress(range.book, range.start), end = verseAddress(range.book, range.end);
  if (!book || !start || !end) return '';
  return `${book.label} ${start.chapter}:${start.verse}` +
    (range.start === range.end ? '' : `–${end.chapter === start.chapter ? '' : `${end.chapter}:`}${end.verse}`);
}
export function bibleUnitId(laneId: string, range: BibleRange): string {
  return `dynamic@1/${encodeURIComponent(laneId)}/${range.book}/${range.start}-${range.end}`;
}
export function bibleRangeFromUnit(unitId: string): (BibleRange & { laneId: string }) | null {
  const match = /^dynamic@1\/([^/]+)\/([^/]+)\/(\d+)-(\d+)$/.exec(unitId);
  if (!match) return null;
  try {
    const range = { laneId: decodeURIComponent(match[1]!), book: match[2]!, start: Number(match[3]), end: Number(match[4]) };
    return validBibleRange(range) && bibleUnitId(range.laneId, range) === unitId ? range : null;
  } catch { return null; }
}
export function bibleText(range: BibleRange): string[] {
  return validBibleRange(range) ? BSB_VERSES[range.book]!.slice(range.start - 1, range.end) : [];
}
const rankings = new Map<string, RankedTerm[]>();
export function bibleRankedTerms(range: BibleRange): RankedTerm[] {
  const key = `${range.book}:${range.start}-${range.end}`;
  let ranked = rankings.get(key);
  if (!ranked) {
    ranked = rankTerms(bibleText(range), BSB_STATISTICS, 1189);
    if (rankings.size >= 128) rankings.delete(rankings.keys().next().value!);
    rankings.set(key, ranked);
  }
  return ranked;
}
export function bibleTermId(laneId: string, term: string): string {
  return `bsb-terms@1/${encodeURIComponent(laneId)}/${encodeURIComponent(term)}`;
}
export function bibleShortlist(state: ProjectState, laneId: string, unitId: string): RankedTerm[] {
  const range = bibleRangeFromUnit(unitId);
  if (!range || range.laneId !== laneId) return [];
  return termsAtDensity(bibleRankedTerms(range), bibleSettings(state, laneId).density);
}

/** Selected ranges reserve coverage; they never imply translation completion. */
export function nextBiblePassages(book: string, reserved: BibleRange[]) {
  const ranges = reserved.filter(r => r.book === book && validBibleRange(r))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let start = 1;
  for (const range of ranges) {
    if (range.start > start) break;
    start = Math.max(start, range.end + 1);
  }
  const total = bibleVerseCount(book);
  if (start > total || total === 0) return [];
  const nextReserved = ranges.find(r => r.start > start)?.start ?? total + 1;
  const unique = new Map<number, number>();
  for (const [first, end, count] of BIBLE_SECTIONS[book] ?? []) {
    if (first === start && end! < nextReserved) unique.set(end!, Math.max(count!, unique.get(end!) ?? 0));
  }
  // Gaps exist in the observed boundaries. Use the nearest following boundary,
  // explicitly marked as a fallback, rather than silently skipping verses.
  if (!unique.size) {
    const boundary = (BIBLE_SECTIONS[book] ?? []).map(r => r[0]!)
      .filter(n => n > start).sort((a, b) => a - b)[0] ?? total + 1;
    unique.set(Math.min(boundary, nextReserved) - 1, 0);
  }
  return [...unique].map(([end, count]) => ({ book, start, end, count }))
    .sort((a, b) => b.count - a.count || a.end - b.end);
}
export function validateBibleEvent(type: string, p: Record<string, unknown>): string | null {
  if (typeof p.laneId !== 'string' || sqlBlank(p.laneId)) return 'Bible lane required';
  if (type === 'v1.BibleSettingsSet') {
    if (p.sourceId !== 'bsb' || typeof p.density !== 'number' ||
      !Number.isInteger(p.density) || p.density < 0 || p.density > 100 ||
      (p.audioFilesetId !== undefined && (typeof p.audioFilesetId !== 'string' ||
        !/^[A-Za-z0-9_-]{6,64}$/.test(p.audioFilesetId)))) return 'Invalid Bible settings';
    return null;
  }
  return typeof p.book === 'string' && typeof p.start === 'number' &&
    typeof p.end === 'number' && validBibleRange(p as BibleRange) ? null : 'Invalid Bible passage';
}
