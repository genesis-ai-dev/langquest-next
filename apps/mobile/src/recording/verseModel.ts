// The passage's verses and how a verse label reads, for the recorder's
// verse gutter (decisions.md 82; core verses.ts does the numbering). Pure.
import { derivePartVerses, type PartLabel, type PartMark, type VerseRange } from '@langquest-next/core';
import { t } from '../i18n';

/** Every verse of the passage in order, as "chapter:verse"; empty for a unit with no verses. */
export function passageVerseKeys(range: VerseRange | null, versesIn: (book: string, chapter: number) => number | undefined): string[] {
  if (!range) return [];
  const out: string[] = [];
  for (let c = range.start.chapter; c <= range.end.chapter; c++) {
    const first = c === range.start.chapter ? range.start.verse : 1;
    const last = c === range.end.chapter ? range.end.verse : versesIn(range.book, c);
    if (last === undefined) return [];
    for (let v = first; v <= last; v++) out.push(`${c}:${v}`);
  }
  return out;
}

/**
 * The passage's first chapter: the verse number alone ("4"); a later
 * chapter, chapter and verse ("2:3"), so Genesis 1:1–2:3 reads 1 … 31, 2:1 … 2:3.
 */
export function verseName(keys: readonly string[], i: number): string {
  const key = keys[i] ?? '';
  const [chapter, verse] = key.split(':');
  return chapter === keys[0]?.split(':')[0] ? verse ?? key : key;
}

/** "4", "4–5" for a badge. */
export function spanShort(keys: readonly string[], s: number, e: number): string {
  return s === e ? verseName(keys, s) : `${verseName(keys, s)}–${verseName(keys, e)}`;
}

/** "Verse 4", "Verses 4–5". */
export function spanName(keys: readonly string[], s: number, e: number): string {
  return s === e ? t('recording.verses.verse', { verse: verseName(keys, s) })
    : t('recording.verses.range', { first: verseName(keys, s), last: verseName(keys, e) });
}

/** What a part now holds, said once it is labelled: "Part 4 is verse 4.", "Part 5 is more of verse 4." */
export function partIs(part: string, keys: readonly string[], s: number, e: number, more = false): string {
  if (s === e) return t(more ? 'recording.verses.moreOfOne' : 'recording.verses.isOne', { part, verse: verseName(keys, s) });
  return t(more ? 'recording.verses.moreOfRange' : 'recording.verses.isRange', { part, first: verseName(keys, s), last: verseName(keys, e) });
}

/**
 * A version's parts as a page shows them: each part's verses, and whether
 * they are the verses of the part above (one verse said in pieces, drawn
 * hollow). Read from the stored marks, so a part with the same verses
 * chosen twice reads as more of the verse above too.
 */
export function readPartVerses(marks: readonly PartMark[], count: number): { label: PartLabel | null; same: boolean }[] {
  const { labels } = derivePartVerses(marks, count);
  return labels.map((l, i) => {
    const above = i > 0 ? labels[i - 1] : null;
    return { label: l, same: !!l && !!above && (l.kind === 'join' || (l.s === above.s && l.e === above.e)) };
  });
}

/**
 * The verses a list of parts holds, first to last ("Verse 1", "Verses 1–4"),
 * or null when none of them has one. Verses are never required: a version
 * with none simply says nothing about them.
 */
export function versesHeld(marks: readonly PartMark[], keys: readonly string[]): string | null {
  const labels = derivePartVerses(marks, keys.length).labels.filter((l): l is PartLabel => !!l && l.s >= 0 && l.e < keys.length);
  if (labels.length === 0) return null;
  return spanName(keys, Math.min(...labels.map((l) => l.s)), Math.max(...labels.map((l) => l.e)));
}

/** The verse spaces' width, down the start of every part row. */
export const VERSE_GUTTER = 64;

/**
 * Whether a finger at x (on the screen) starts in the verse spaces of the
 * part list that spans left to left + width: they run down the row's start,
 * the left side, or the right side when the app reads right to left (where
 * the left side holds each part's grip).
 */
export function inVerseGutter(x: number, left: number, width: number, rtl: boolean): boolean {
  const from = rtl ? left + width - x : x - left;
  return from >= 0 && from < VERSE_GUTTER;
}
