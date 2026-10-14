import { BIBLE_BREAKS } from './bibleBreaksData';
import { verseFromOrg, verseToOrg, type VersificationDoc } from './versification';

/**
 * Where English Bibles start their sections (OpenBible.info's counts of 20
 * Bibles, CC BY 4.0; scripts/bible-breaks.ts). Dividing a book your own way
 * marks the verses where many of them do, and a section's first verse says
 * how many start one there too (docs/breaking-up-the-bible.md). Pure.
 */

/** How many Bibles the counts are of: "18 of 20 Bibles". */
export const BIBLES_COUNTED = 20;

const parsed = new Map<string, Map<string, number>>();

/** "chapter:verse" -> how many of the 20 Bibles start a section there, in English numbering. */
export function bibleBreaks(book: string): Map<string, number> {
  let out = parsed.get(book);
  if (!out) {
    out = new Map();
    for (const part of (BIBLE_BREAKS[book] ?? '').split(' ')) {
      const [at, n] = part.split('=');
      if (at && n) out.set(at, Number(n));
    }
    parsed.set(book, out);
  }
  return out;
}

/**
 * The same counts in a language's numbering: each English verse taken to the
 * Original numbering and back out into `into` (decision 80). English, or
 * numbering documents not at hand, give the counts as they are.
 */
export function bibleBreaksIn(book: string, english: VersificationDoc | null, into: VersificationDoc | null): Map<string, number> {
  const counts = bibleBreaks(book);
  if (!english || !into || into.code === english.code) return counts;
  const out = new Map<string, number>();
  for (const [at, n] of counts) {
    const [chapter, verse] = at.split(':').map(Number) as [number, number];
    for (const org of verseToOrg(english, { book, chapter, verse })) {
      const mine = verseFromOrg(into, org)[0];
      if (!mine || mine.book !== book) continue;
      const k = `${mine.chapter}:${mine.verse}`;
      out.set(k, Math.max(out.get(k) ?? 0, n));
      break;
    }
  }
  return out;
}
