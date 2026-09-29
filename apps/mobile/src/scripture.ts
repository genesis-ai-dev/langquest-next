// Passage text for the workspace, the review screens and the study's
// passage reader (the UX demo's src/bible.ts and src/chapterText.ts,
// STUDY-5, ADR-019). Public-domain text ships with the app for the passages
// the demo covers: the study guides' passages in BSB, WEB and KJV, and whole
// WEB chapters for Genesis 1–3, Luke 14–16 and John 2–4. Elsewhere there is
// none yet and screens say so. There is no recorded reading of this text
// yet, so each verse's start is simulated from its length: playback can
// still highlight the verse being read, and a paused note knows its verse.
import type { ProjectState } from '@langquest-next/core';
import { CHAPTER_TEXT } from './study/chapterText';
import { PASSAGE_TEXTS } from './study/passageTexts';
import { unitRange, versesOf, type VerseRange } from './study/range';

export interface Verse {
  /** "15:11" */
  ref: string;
  chapter: number;
  verse: number;
  text: string;
  /** Seconds into the reading's audio where this verse starts, when known. */
  start?: number;
}

export interface Reading {
  /** "Berean Standard Bible" */
  translation: string;
  /** "BSB" */
  code: string;
  verses: Verse[];
  /** The reading aloud, when there is one. */
  audioUrl?: string;
}

export const TRANSLATIONS: { code: string; name: string }[] = [
  { code: 'BSB', name: 'Berean Standard Bible' },
  { code: 'WEB', name: 'World English Bible' },
  { code: 'KJV', name: 'King James Version' }
];

/** Read aloud at a steady pace: about 14 characters a second, with a short pause between verses. */
const CHARS_PER_SECOND = 14;
const VERSE_GAP = 0.6;

const verseSeconds = (text: string) => text.length / CHARS_PER_SECOND + VERSE_GAP;

function verseText(code: string, book: string, chapter: number, verse: number): string | undefined {
  for (const p of PASSAGE_TEXTS) {
    if (p.book !== book || p.chapter !== chapter) continue;
    const hit = p.by[code]?.find(([n]) => n === verse);
    if (hit) return hit[1];
  }
  return code === 'WEB' ? CHAPTER_TEXT[`${book} ${chapter}`]?.[verse - 1] : undefined;
}

/** The translations that have every verse of a range, with simulated timings. */
export function readingsForRange(range: VerseRange): Reading[] {
  const verses = versesOf(range, (c) => CHAPTER_TEXT[`${range.book} ${c}`]?.length);
  if (!verses || verses.length === 0) return [];
  const out: Reading[] = [];
  for (const t of TRANSLATIONS) {
    let at = 0;
    const list: Verse[] = [];
    for (const { chapter, verse } of verses) {
      const text = verseText(t.code, range.book, chapter, verse);
      if (text === undefined) break;
      list.push({ ref: `${chapter}:${verse}`, chapter, verse, text, start: at });
      at += verseSeconds(text);
    }
    if (list.length === verses.length) out.push({ translation: t.name, code: t.code, verses: list });
  }
  return out;
}

const cache = new Map<string, Reading[]>();

/** Translations of a passage the app can show, first is the default (STUDY-5). */
export function readingsFor(state: ProjectState, unitId: string): Reading[] {
  const range = unitRange(state, unitId);
  if (!range) return [];
  const key = `${range.book} ${range.start.chapter}:${range.start.verse}-${range.end.chapter}:${range.end.verse ?? ''}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = readingsForRange(range);
    cache.set(key, hit);
  }
  return hit;
}

/** How long a reading takes aloud, in seconds (its last verse's start plus that verse). */
export function readingSeconds(r: Reading): number {
  const last = r.verses[r.verses.length - 1];
  return last ? (last.start ?? 0) + verseSeconds(last.text) : 0;
}

/** The verse being read at `t` seconds; the last verse once past the end. */
export function verseAt(r: Reading, t: number): Verse | undefined {
  if (t <= 0) return undefined;
  let current: Verse | undefined;
  for (const v of r.verses) {
    if ((v.start ?? 0) <= t) current = v;
    else break;
  }
  return current;
}

/** The passage's source text as one paragraph (for key-term matching and the workspace), or null. */
export function sourceText(state: ProjectState, unitId: string): string | null {
  const first = readingsFor(state, unitId)[0];
  return first ? first.verses.map((v) => v.text).join(' ') : null;
}
