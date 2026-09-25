import { BSB_HAYS_TIMINGS } from './bibleData/timings';
import { bibleBooks, bibleRangeFromUnit, verseAddress } from './dynamicBible';

export type VerseTiming = { verse: number; start: number; end?: number };
export type AudioBounds = { startSeconds: number; endSeconds: number };

/** Never infer an end from the beginning of the same verse or another track. */
export function passageAudioBounds(
  timings: VerseTiming[], first: number, last: number, duration?: number
): AudioBounds | null {
  if (!Number.isInteger(first) || !Number.isInteger(last) ||
    first < 1 || last < first) return null;
  const ordered = [...timings].sort((a, b) => a.verse - b.verse);
  if (new Set(ordered.map(t => t.verse)).size !== ordered.length ||
      ordered.some((t, i) => !Number.isInteger(t.verse) || t.verse < 1 ||
        !Number.isFinite(t.start) || t.start < 0 ||
        (t.end !== undefined && (!Number.isFinite(t.end) || t.end <= t.start)) ||
        (i > 0 && t.start < (ordered[i - 1]!.end ?? ordered[i - 1]!.start)))) return null;
  const selected = ordered.filter(t => t.verse >= first && t.verse <= last);
  if (selected.length !== last - first + 1) return null;
  const startSeconds = selected[0]!.start;
  const endSeconds = selected.at(-1)!.end ??
    ordered.find(t => t.verse === last + 1)?.start ?? duration;
  if (endSeconds === undefined || !Number.isFinite(endSeconds) ||
    endSeconds <= startSeconds ||
    endSeconds <= selected.at(-1)!.start ||
    (duration !== undefined && duration > 0 && endSeconds > duration)) return null;
  return { startSeconds, endSeconds };
}

export function bsbPassageBounds(unitId: string, chapter: number): AudioBounds | null {
  const range = bibleRangeFromUnit(unitId);
  if (!range) return null;
  const first = verseAddress(range.book, range.start)!;
  const last = verseAddress(range.book, range.end)!;
  if (chapter < first.chapter || chapter > last.chapter) return null;
  const book = bibleBooks.find(b => b.itemId === range.book)!;
  const startVerse = chapter === first.chapter ? first.verse : 1;
  const endVerse = chapter === last.chapter ? last.verse : book.verses[chapter - 1]!;
  const raw = BSB_HAYS_TIMINGS[range.book]?.[chapter] ?? [];
  const timings = raw.flatMap((span, i) => span ? [{ verse: i + 1, start: span[0], end: span[1] }] : []);
  return passageAudioBounds(timings, startVerse, endVerse);
}

export function bibleBrainBookId(book: string): string | undefined {
  const codes = ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH ' +
    'EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA ' +
    'JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL ' +
    'EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV').split(' ');
  return codes[bibleBooks.findIndex(b => b.itemId === book)];
}
