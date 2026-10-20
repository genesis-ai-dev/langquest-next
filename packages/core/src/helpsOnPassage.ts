import { helpPlace, helpQuestionId, type AlignmentDoc, type HelpBookDoc, type HelpRow, type HelpsDoc } from './helpDocs';
import type { QuestionSpec } from './record';
import { mapRange, type VerseRange, type VersificationDoc } from './versification';

/**
 * Which notes, questions and key words of a set sit on a passage, and which
 * words of a word-aligned Bible they are about (core helpDocs.ts). Pure.
 *
 * A Bible passage is a verse range in its template's numbering; the set's
 * places are in the set's, and the two meet through the versification
 * engine as guides do. A story of Open Bible Stories is its number, every
 * frame in it.
 */

/** Where a passage is, for its helps: a verse range (and its numbering), or a story. */
export type HelpsPassage =
  | { kind: 'bible'; range: VerseRange; versification: VersificationDoc | null }
  | { kind: 'story'; story: number };

/** A row on the passage, with where it sits there: the first verse it is on, or none for an introduction. */
export interface PlacedRow {
  row: HelpRow;
  /** `"3:16"`: the chapter and first verse in the set's numbering; absent for an introduction or a whole chapter. */
  at?: string;
  /** An introduction to the book or a chapter. */
  intro?: boolean;
}

const before = (a: { chapter: number; verse: number }, b: { chapter: number; verse: number }) =>
  a.chapter < b.chapter || (a.chapter === b.chapter && a.verse <= b.verse);

/**
 * The rows of one book of a set that sit on the passage, in the book's
 * order: those whose verses meet it, a chapter's introduction when the
 * passage starts that chapter, the book's when it starts the book, and a
 * whole chapter's when the passage is in it. `setV11n` is the set's
 * numbering; null reads the passage's verses as they are.
 */
export function rowsOnPassage(book: HelpBookDoc, passage: HelpsPassage, setV11n: VersificationDoc | null): PlacedRow[] {
  let range: VerseRange;
  if (passage.kind === 'story') {
    if (book.book !== 'OBS') return [];
    range = { book: 'OBS', start: { chapter: passage.story, verse: 0 }, end: { chapter: passage.story, verse: 999 } };
  } else {
    if (book.book !== passage.range.book) return [];
    const mapped = setV11n && passage.versification ? mapRange(passage.versification, setV11n, passage.range) : passage.range;
    if (!mapped) return [];
    range = mapped;
  }
  const out: PlacedRow[] = [];
  for (const row of book.rows) {
    const p = helpPlace(row.ref);
    if (!p) continue;
    if (p.kind === 'verses') {
      const start = { chapter: p.chapter, verse: p.verse };
      if (before(start, range.end) && before(range.start, { chapter: p.endChapter, verse: p.endVerse })) {
        out.push({ row, at: `${p.chapter}:${Math.max(p.verse, p.chapter === range.start.chapter ? range.start.verse : 0)}` });
      }
    } else if (p.kind === 'chapter') {
      if (p.chapter >= range.start.chapter && p.chapter <= range.end.chapter) out.push({ row });
    } else if (p.chapter === 'front') {
      if (range.start.chapter === 1 && range.start.verse <= 1) out.push({ row, intro: true });
    } else if (p.chapter >= range.start.chapter && p.chapter <= range.end.chapter && (p.chapter > range.start.chapter || range.start.verse <= 1)) {
      out.push({ row, intro: true });
    }
  }
  return out;
}

/** A passage's rows grouped by the verse they sit on (`"3:16"`), introductions under `""`, in order. */
export function rowsByVerse(rows: readonly PlacedRow[]): [string, HelpRow[]][] {
  const out = new Map<string, HelpRow[]>();
  for (const r of rows) {
    const k = r.at ?? '';
    out.set(k, [...(out.get(k) ?? []), r.row]);
  }
  const key = (k: string) => (k === '' ? -1 : Number(k.split(':')[0]) * 10000 + Number(k.split(':')[1]));
  return [...out].sort(([a], [b]) => key(a) - key(b));
}

/**
 * Where, in one verse of an aligned Bible, the words that stand for these
 * original words are: `[start, end)` spans in the verse's text, merged when
 * they touch or only a space parts them. Empty when the verse has no
 * alignment or none of the words are in it.
 */
export function alignedSpans(alignment: AlignmentDoc | null | undefined, chapter: number, verse: number, originals: readonly string[], text: string): [number, number][] {
  if (!alignment || originals.length === 0) return [];
  const v = alignment.chapters.find((c) => c.chapter === chapter)?.verses.find((x) => x.verse === verse);
  if (!v) return [];
  const want = new Set(originals);
  const indexes = new Set<number>();
  for (const [orig, words] of v.groups) if (orig.some((o) => want.has(o))) for (const i of words) indexes.add(i);
  const spans = [...indexes].sort((a, b) => a - b).map((i) => v.words[i]!).filter(Boolean).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = out[out.length - 1];
    if (last && /^\s*$/.test(text.slice(last[1], s))) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** A verse's text cut where `spans` mark it, for drawing the marked words. */
export function markSpans(text: string, spans: readonly [number, number][]): { text: string; marked: boolean }[] {
  const out: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (s < at || e > text.length || s >= e) continue;
    if (s > at) out.push({ text: text.slice(at, s), marked: false });
    out.push({ text: text.slice(s, e), marked: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), marked: false });
  return out;
}

/** A question from a set linked to a check, on the passage's verses, with the answer the checker compares against. */
export interface PassageQuestion {
  q: QuestionSpec;
  /** What someone who understood it would say. */
  answer: string;
  /** Where it is: `"3:16"`, or absent for the whole passage. */
  at?: string;
  /** The set it came from (a library item). */
  itemId: string;
}

/**
 * The questions of a set (`helps@1` kind `questions`) that sit on the
 * passage, one book at a time, each with an id that stays the same across
 * the set's versions (`helpQuestionId`), since answers are kept by it.
 */
export function passageQuestions(itemId: string, set: HelpsDoc, book: HelpBookDoc | null | undefined, passage: HelpsPassage, setV11n: VersificationDoc | null): PassageQuestion[] {
  if (set.kind !== 'questions' || !book) return [];
  return rowsOnPassage(book, passage, setV11n).filter((p) => !p.intro).map((p) => ({
    q: { id: helpQuestionId(itemId, book.book, p.row.id), text: p.row.text, type: 'text' },
    answer: p.row.answer ?? '',
    ...(p.at ? { at: p.at } : {}),
    itemId
  }));
}

/** The original words a row is about, for underlining (empty when its quote was not found). */
export const rowWords = (row: HelpRow): string[] => row.words ?? [];

/** A question of a library set asked of every passage, with an id that names its set: answers are kept by it. */
export const helpsQuestionSpec = (itemId: string, q: QuestionSpec): QuestionSpec => ({ ...q, id: `${itemId}/${q.id}` });
