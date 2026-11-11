// An uploaded Bible in the reader (LAN-230, decision 208): a passage's rows from
// a book's file, how the Bible's numbering sits against the passage, and how
// a verse's pieces stack up on screen. Pure: no React Native.
import { readUsfm, versesOf, type UsfmBookDoc, type UsfmHeading, type UsfmPiece, type UsfmRead, type UsfmVerse, type Verse, type VerseRange, type VersificationDoc } from '@langquest-next/core';
import { chaptersOf, rowKey, type VerseRow } from '../sources/model';

const reads = new WeakMap<UsfmBookDoc, UsfmRead>();

/** A book's file, read once however many times the screen draws. */
function readBook(book: UsfmBookDoc): UsfmRead {
  let read = reads.get(book);
  if (!read) {
    read = readUsfm(book.usfm);
    reads.set(book, read);
  }
  return read;
}

/**
 * The verses of a range that the file has, each with how it sets them out.
 * A chapter the file lacks is left out, not fatal (it is said by `versesNotIn`);
 * null when none of the range is there.
 */
export function usfmRows(range: VerseRange, book: UsfmBookDoc): VerseRow[] | null {
  const read = readBook(book);
  const out: VerseRow[] = [];
  for (const c of chaptersOf(range)) {
    const chapter = read.chapters.find((x) => x.chapter === c);
    if (!chapter) continue;
    const first = c === range.start.chapter ? range.start.verse : 1;
    const last = c === range.end.chapter ? range.end.verse : Infinity;
    let head: string | undefined = chapter.label ?? `${book.name} ${c}`;
    for (const verse of chapter.verses) {
      if (verse.end < first || verse.start > last || verse.start <= 0) continue;
      out.push({ key: rowKey(c, verse.start, verse.end), chapter: c, verseStart: verse.start, verseEnd: verse.end, text: verse.text, usfm: { verse, ...(head ? { chapterHead: head } : {}) } });
      head = undefined;
    }
  }
  return out.length ? out : null;
}

/** An uploaded Bible's numbering against a passage. */
export interface UsfmFit {
  /** How this Bible numbers the passage ("51:3-7"), when that differs from the passage's own. */
  renumbered: string | null;
  /** The passage's verses this Bible's file does not have ("1:7", "1:9-10"). */
  missing: string[];
}

const place = (r: VerseRange) => (r.start.chapter === r.end.chapter ? `${r.start.chapter}:${r.start.verse}-${r.end.verse}` : `${r.start.chapter}:${r.start.verse}-${r.end.chapter}:${r.end.verse}`);

/** The passage as the Bible numbers it, when it does so differently. */
export function renumberedAs(passage: VerseRange, inBible: VerseRange): string | null {
  const same = passage.start.chapter === inBible.start.chapter && passage.start.verse === inBible.start.verse
    && passage.end.chapter === inBible.end.chapter && passage.end.verse === inBible.end.verse;
  return same ? null : place(inBible);
}

/** Runs of verses in `wanted` no row holds. */
export function missingRuns(rows: readonly VerseRow[] | null, wanted: readonly Verse[]): string[] {
  const has = (v: Verse) => rows?.some((r) => r.chapter === v.chapter && r.verseStart <= v.verse && r.verseEnd >= v.verse);
  const runs: { chapter: number; from: number; to: number }[] = [];
  for (const v of wanted) {
    if (has(v)) continue;
    const last = runs[runs.length - 1];
    if (last && last.chapter === v.chapter && last.to === v.verse - 1) last.to = v.verse;
    else runs.push({ chapter: v.chapter, from: v.verse, to: v.verse });
  }
  return runs.map((r) => (r.from === r.to ? `${r.chapter}:${r.from}` : `${r.chapter}:${r.from}-${r.to}`));
}

/** The range's verses, as this Bible's numbering lists them, that its file does not have. Nothing to say until the numbering is here. */
export function versesNotIn(rows: readonly VerseRow[] | null, range: VerseRange, numbering: VersificationDoc | null): string[] {
  return numbering ? missingRuns(rows, versesOf(numbering, range)) : [];
}

/** A verse's pieces as they stack: the headings above it, then the rest (a heading inside a verse stays in its place). */
export function stackOf(verse: UsfmVerse): { above: UsfmHeading[]; body: UsfmPiece[] } {
  const firstLine = verse.pieces.findIndex((p) => p.kind === 'line');
  const cut = firstLine < 0 ? verse.pieces.length : firstLine;
  return { above: verse.pieces.slice(0, cut) as UsfmHeading[], body: verse.pieces.slice(cut) };
}
