// The passage's verses and how a verse label reads, for the recorder's
// verse gutter (decisions.md 82; core verses.ts does the numbering). Pure.
import type { VerseRange } from '@langquest-next/core';
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
