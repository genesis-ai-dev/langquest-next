// Pure pieces of deciding something about a passage with its text open
// (design principles 13 and 14; demo ADR-042, src/simple/helps.tsx): which
// verses a note goes on, what each help says there, where a key word is in
// the verses, and how the organization's other languages say it. No React,
// no I/O, so the rules are tested in apps/mobile/test/helpsModel.test.ts.
import { parseRef, type KeyTermView, type VerseRange } from '@langquest-next/core';
import { markTerms } from '../recording/workspaceModel';
import { termWords } from '../config/model';
import type { VerseRow } from '../sources/model';

// ---- verses chosen on the text ----------------------------------------------------------

/** A run of verses chosen on the passage text, as row indexes `[from, to]`; null is the whole passage. */
export type VerseRun = readonly [number, number] | null;

/**
 * Tap a verse to choose it, tap another to run to it (demo ADR-042). A tap
 * on the one verse chosen goes back to the whole passage; a tap while a run
 * is chosen starts again from that verse.
 */
export function tapVerse(run: VerseRun, i: number): VerseRun {
  if (!run) return [i, i];
  const [a, b] = run;
  if (a !== b) return [i, i];
  if (a === i) return null;
  return [Math.min(a, i), Math.max(a, i)];
}

/**
 * The verse a note on this run is anchored to, in the form a verse row's
 * key already has for one verse or a bridge ("15:12", "15:12-13"), and
 * across a chapter "15:30-16:2". Null when the run is not on the rows.
 */
export function runKey(rows: readonly Pick<VerseRow, 'chapter' | 'verseStart' | 'verseEnd'>[], run: readonly [number, number]): string | null {
  const first = rows[Math.min(run[0], run[1])];
  const last = rows[Math.max(run[0], run[1])];
  if (!first || !last) return null;
  if (first.chapter !== last.chapter) return `${first.chapter}:${first.verseStart}-${last.chapter}:${last.verseEnd}`;
  return first.verseStart === last.verseEnd ? `${first.chapter}:${first.verseStart}` : `${first.chapter}:${first.verseStart}-${last.verseEnd}`;
}

interface Place { chapter: number; verse: number }

/** A verse key as one span ("15:12-13" is 15:12 to 15:13, "15:30-16:2" crosses a chapter); null when it is not one. */
export function keySpan(key: string): { start: Place; end: Place } | null {
  const m = /^(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/.exec(key.trim());
  if (!m) return null;
  const start = { chapter: Number(m[1]), verse: Number(m[2]) };
  const end = { chapter: m[3] ? Number(m[3]) : start.chapter, verse: m[4] ? Number(m[4]) : start.verse };
  return { start, end };
}

const atOrBefore = (a: Place, b: Place) => a.chapter < b.chapter || (a.chapter === b.chapter && a.verse <= b.verse);

/** Is a note on `key` on this verse row (one verse of a run counts)? */
export function keyTouches(key: string, row: Pick<VerseRow, 'chapter' | 'verseStart' | 'verseEnd'>): boolean {
  const span = keySpan(key);
  if (!span) return false;
  return atOrBefore(span.start, { chapter: row.chapter, verse: row.verseEnd }) && atOrBefore({ chapter: row.chapter, verse: row.verseStart }, span.end);
}

/** The first row a note on `key` is on: where its mark goes. */
export function firstTouched(rows: readonly Pick<VerseRow, 'chapter' | 'verseStart' | 'verseEnd'>[], key: string): number {
  return rows.findIndex((r) => keyTouches(key, r));
}

/** "15:12–13" as people read it: an en dash between numbers. */
export function keyLabel(key: string): string {
  return key.replace(/-/g, '–');
}

// ---- what a help says here ----------------------------------------------------------------

/** Text with its markdown marks and line breaks taken out, for a one- or two-line preview. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>\s*\[![a-z]+\]\s*/gim, '')
    .replace(/^\s*(?:#{1,6}|>|[-*]|\d+\.)\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Where a note's verse links meet the passage, as a short label ("15:20",
 * "15:20–24", "15:30–16:2"): the first link in the passage's book whose
 * verses overlap it, read plainly. Null when none does.
 */
export function refInPassage(refs: readonly string[], range: VerseRange | null): string | null {
  if (!range) return null;
  for (const ref of refs) {
    const r = parseRef(ref);
    if (!r || r.book !== range.book) continue;
    if (!atOrBefore(r.start, range.end) || !atOrBefore(range.start, r.end)) continue;
    if (r.start.chapter !== r.end.chapter) return `${r.start.chapter}:${r.start.verse}–${r.end.chapter}:${r.end.verse}`;
    return r.start.verse === r.end.verse || r.end.verse >= 999 ? `${r.start.chapter}:${r.start.verse}` : `${r.start.chapter}:${r.start.verse}–${r.end.verse}`;
  }
  return null;
}

// ---- a key word in the verses ---------------------------------------------------------------

export interface WordHit {
  row: VerseRow;
  /** The verse's text, with the word's places marked. */
  parts: { text: string; hit: boolean }[];
}

/**
 * The verses where a key word is, with the word marked: whole words, as
 * the recorder underlines them (`markTerms`), for each word the term is
 * found by ("Word (Logos)" is found by "word" and "logos").
 */
export function wordHits(rows: readonly VerseRow[] | null, term: string): WordHit[] {
  const words = termWords(term).map((w, i) => ({ termId: String(i), term: w }));
  if (!rows || words.length === 0) return [];
  const out: WordHit[] = [];
  for (const row of rows) {
    const parts = markTerms(row.text, words).map((p) => ({ text: p.text, hit: !!p.termId }));
    if (parts.some((p) => p.hit)) out.push({ row, parts });
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The same key term in another language's list: the same id (FIA's, or one taken from there), else the same word. */
export function sameTerm<T extends Pick<KeyTermView, 'termId' | 'term'>>(terms: readonly T[], term: Pick<KeyTermView, 'termId' | 'term'>): T | null {
  return terms.find((x) => x.termId === term.termId) ?? terms.find((x) => norm(x.term) === norm(term.term) && norm(term.term) !== '') ?? null;
}

/** A language's key terms, as this phone holds them, and the format of each recording of a word ("m4a"). */
export interface LanguageTerms { languageId: string; name: string; terms: KeyTermView[]; formats?: Record<string, string> }

/** How one other language says a key term: its latest word, what it means, and its latest recording of it. */
export interface OtherSays {
  languageId: string;
  name: string;
  termId: string;
  word: string;
  /** What the word means or when it is used, as that language wrote it; '' when it wrote nothing. */
  means: string;
  /** The latest voice recording of the word, and its file's format when the language's log says. */
  voice?: string;
  voiceFormat?: string;
}

/** The latest recording among a term's adjustments. */
function voiceOf(term: KeyTermView): string | undefined {
  return [...term.adjustments].reverse().find((a) => a.blobHash)?.blobHash;
}

/**
 * How the organization's other languages say a key term (principle 14):
 * each language that has the term and has said or written it, by name.
 */
export function othersSay(languages: readonly LanguageTerms[], term: Pick<KeyTermView, 'termId' | 'term'>): OtherSays[] {
  const out: OtherSays[] = [];
  for (const l of languages) {
    const theirs = sameTerm(l.terms, term);
    if (!theirs) continue;
    const latest = theirs.renderings[theirs.renderings.length - 1];
    const voice = voiceOf(theirs);
    if (!latest?.rendering.trim() && !voice) continue;
    out.push({
      languageId: l.languageId, name: l.name, termId: theirs.termId, word: latest?.rendering.trim() ?? '',
      means: (latest?.context.trim() || theirs.gloss.trim()), ...(voice ? { voice } : {}),
      ...(voice && l.formats?.[voice] ? { voiceFormat: l.formats[voice] } : {})
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A key word other languages have in these verses and this language does not yet. */
export interface WordSuggestion { termId: string; term: string; gloss: string; languages: string[] }

/**
 * Key words the organization's other languages use in these verses that
 * this language has not added (principle 14), most used first.
 */
export function suggestedWords(languages: readonly LanguageTerms[], rows: readonly VerseRow[] | null, own: readonly Pick<KeyTermView, 'termId' | 'term'>[]): WordSuggestion[] {
  if (!rows?.length) return [];
  const text = rows.map((r) => r.text).join(' ');
  const by = new Map<string, WordSuggestion>();
  for (const l of languages) {
    for (const term of l.terms) {
      if (sameTerm(own, term)) continue;
      if (wordHits([{ key: '', chapter: 0, verseStart: 0, verseEnd: 0, text }], term.term).length === 0) continue;
      const k = norm(term.term);
      const hit = by.get(k);
      if (hit) { if (!hit.languages.includes(l.name)) hit.languages.push(l.name); continue; }
      by.set(k, { termId: term.termId, term: term.term.trim(), gloss: term.gloss.trim(), languages: [l.name] });
    }
  }
  return [...by.values()].sort((a, b) => b.languages.length - a.languages.length || a.term.localeCompare(b.term));
}
