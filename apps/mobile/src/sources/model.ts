// Sources beside the recorder, the study and the review (docs/reference-material.md):
// which ones a passage gets, which verses it shows, what plays, and what the
// record says was used. Pure: documents and answers in, decisions out. The
// hooks (useSources.ts), the player (player.ts) and the reader
// (SourceReader.tsx) do the I/O.
import {
  BIBLE_BOOKS, bookIdOf, FIA_PERICOPES, libraryUnitRange, mapRange, parseRef, segmentAt, segmentsFromStarts, testamentOf, usedSummary, usfmOf, verseSpan,
  type RecommendationSource, type SourceDoc, type SourceBookDoc, type TimingDoc, type UsedReference, type VerseRange, type VersificationDoc
} from '@langquest-next/core';
import type { BibleDetail } from './bibleBrain';

// ---- the options ---------------------------------------------------------------------

/** Where a source comes from: the library, Bible Brain explored outside it, or the text the app carries as a last resort. */
export type SourceKind = 'library' | 'biblebrain' | 'builtin';

/** Why a source is offered here, most authoritative first. */
export type SourceFrom = RecommendationSource | 'passage' | 'mine' | 'shared' | 'builtin';

export interface SourceOption {
  /** A library item id, `biblebrain.<bibleId>`, or `builtin.<code>`. */
  itemId: string;
  kind: SourceKind;
  from: SourceFrom;
  name: string;
  abbreviation: string;
  /** ISO 639-3. */
  language: string;
  /** library: the version this organization is at. */
  doc?: SourceDoc;
  docHash?: string;
  /** biblebrain: the Bible as the Worker describes it, when known. */
  bible?: BibleDetail;
  /** The organization that shares it (a shared source offered because nothing was recommended). */
  sharedBy?: string;
}

const FROM_ORDER: Record<SourceFrom, number> = { language: 0, organization: 1, passage: 2, mine: 3, shared: 4, builtin: 5 };

/** Recommended first (the language's own, then the organization's), then linked here, then the person's own, then shared and built in. One entry per item. */
export function orderOptions(list: SourceOption[]): SourceOption[] {
  const best = new Map<string, SourceOption>();
  for (const o of list) {
    const prior = best.get(o.itemId);
    if (!prior || FROM_ORDER[o.from] < FROM_ORDER[prior.from]) best.set(o.itemId, prior ? { ...prior, ...o, doc: o.doc ?? prior.doc, bible: o.bible ?? prior.bible } : o);
  }
  return [...best.values()].sort((a, b) => FROM_ORDER[a.from] - FROM_ORDER[b.from] || a.abbreviation.localeCompare(b.abbreviation) || (a.itemId < b.itemId ? -1 : 1));
}

/** Whether phones may keep a source's files (library documents say so; Bible Brain says so per fileset). */
export function offlineAllowed(o: SourceOption): boolean {
  if (o.kind === 'builtin') return false;
  if (o.doc) return o.doc.offline === 'allowed' && (o.doc.provider.kind === 'library' || o.bible?.offline.audio !== false);
  return !!o.bible?.offline.audio;
}

/** The Bible Brain filesets a source reads a book from, when it reads from Bible Brain. */
export function filesetsFor(o: SourceOption, book: string): { text: string | null; audio: string | null } {
  const t = testamentOf(book);
  if (o.doc?.provider.kind === 'biblebrain') return { text: o.doc.provider.text?.[t] ?? null, audio: o.doc.provider.audio?.[t] ?? null };
  if (o.kind === 'biblebrain' && o.bible) {
    const has = o.bible.books.length === 0 || o.bible.books.some((b) => b.book === book);
    return { text: has ? o.bible.text[t] ?? null : null, audio: has ? o.bible.audio[t] ?? null : null };
  }
  return { text: null, audio: null };
}

/**
 * What a source has for a book before its chapters are loaded: text,
 * audio. A library book's own document refines this once it arrives
 * (`bookOffers`).
 */
export function offersFor(o: SourceOption, book: string, builtinHasText = false): { text: boolean; audio: boolean } {
  if (o.kind === 'builtin') return { text: builtinHasText, audio: o.itemId === 'builtin.BSB' && builtinHasText };
  if (o.doc) {
    if (!o.doc.books.some((b) => b.book === book)) return { text: false, audio: false };
    if (o.doc.provider.kind === 'biblebrain') {
      const f = filesetsFor(o, book);
      return { text: !!f.text, audio: !!f.audio };
    }
    return { text: true, audio: true };
  }
  const f = filesetsFor(o, book);
  return { text: !!f.text, audio: !!f.audio };
}

/** A library book document's chapters say exactly which have text and audio. */
export function bookOffers(book: SourceBookDoc, chapters: number[]): { text: boolean; audio: boolean } {
  const of = (c: number) => book.chapters.find((x) => x.chapter === c);
  return {
    text: chapters.every((c) => (of(c)?.verses?.length ?? 0) > 0),
    audio: chapters.every((c) => !!of(c)?.audio)
  };
}

// ---- chips ------------------------------------------------------------------------------

export interface ChipFacts {
  text: boolean;
  audio: boolean;
  /** Phones may keep it (library `offline: 'allowed'`, Bible Brain `/download`). */
  offlineAllowed: boolean;
  /** Every chapter of the passage has its text on this phone. */
  textOnPhone: boolean;
  /** Every chapter of the passage has its audio on this phone. */
  audioOnPhone: boolean;
}

/**
 * What a version chip says about this passage, so nobody is surprised in
 * the field: "no audio" when there is nothing to hear; then where it works,
 * "offline ✓" when all of it is on the phone, "text only" when only the text
 * is (the audio streams), "needs connection" otherwise.
 */
export function chipMarks(f: ChipFacts): string[] {
  const out: string[] = [];
  if (!f.audio) out.push('no audio');
  const textOk = !f.text || f.textOnPhone;
  const audioOk = !f.audio || f.audioOnPhone;
  if ((f.text || f.audio) && textOk && audioOk) out.push('offline ✓');
  else if (f.text && f.textOnPhone && f.audio) out.push('text only');
  else out.push('needs connection');
  return out;
}

// ---- where the passage is ---------------------------------------------------------------------

type VersesIn = (book: string, chapter: number) => number | undefined;

/** Verses per chapter from the app's Bible catalog, when no versification document is at hand. */
export const catalogVerses: VersesIn = (book, chapter) => BIBLE_BOOKS.find((b) => b.itemId === bookIdOf(book))?.verses[chapter - 1];

/**
 * The verses a unit covers, from its id alone, never its label: a library
 * template's unit (`<item>/GEN.1.1-2.3`), or the older catalog ids
 * (`bible@1/gen-1`, `fia@1/gen-p1`, `book@1/gen`) that core's
 * `sourceChapters` also reads.
 */
export function unitCoordinates(unitId: string, versesIn: VersesIn = catalogVerses): VerseRange | null {
  const lib = libraryUnitRange(unitId, versesIn);
  if (lib) return clampEnd(lib, versesIn);
  const m = /^(bible|fia|book)@1\/(.+)$/.exec(unitId);
  if (!m) return null;
  const [, template, item] = m;
  if (template === 'fia') {
    const p = FIA_PERICOPES.find((x) => x.itemId === item);
    if (!p) return null;
    const r = parseRef(`${usfmOf(normalBook(p.book))} ${p.verseRange.replace(/[–]/g, '-')}`, versesIn);
    return r ? clampEnd(r, versesIn) : null;
  }
  if (template === 'bible') {
    const ch = /^(.+)-(\d+)$/.exec(item!);
    if (!ch) return null;
    const book = usfmOf(normalBook(ch[1]!));
    const c = Number(ch[2]);
    const last = versesIn(book, c);
    return last ? { book, start: { chapter: c, verse: 1 }, end: { chapter: c, verse: last } } : null;
  }
  const book = usfmOf(normalBook(item!));
  const chapters = BIBLE_BOOKS.find((b) => b.itemId === bookIdOf(book))?.verses.length ?? 0;
  const last = chapters ? versesIn(book, chapters) : undefined;
  return chapters && last ? { book, start: { chapter: 1, verse: 1 }, end: { chapter: chapters, verse: last } } : null;
}

/** FIA's seeds spell Mark and John their own way. */
const normalBook = (b: string) => (b === 'mrk' ? 'mar' : b === 'jhn' ? 'joh' : b);

/** A whole book reads as chapter 999 in parseRef; bound it by what the catalog knows. */
function clampEnd(r: VerseRange, versesIn: VersesIn): VerseRange {
  if (r.end.chapter < 999) return r;
  const chapters = BIBLE_BOOKS.find((b) => b.itemId === bookIdOf(r.book))?.verses.length;
  if (!chapters) return r;
  return { ...r, end: { chapter: chapters, verse: versesIn(r.book, chapters) ?? 999 } };
}

/** The passage in the source's numbering, when both systems are known and differ (core `mapRange`); as is otherwise. */
export function inSourceNumbering(range: VerseRange, template: VersificationDoc | null, source: VersificationDoc | null): VerseRange {
  if (!template || !source) return range;
  return mapRange(template, source, range) ?? range;
}

/** The chapters a range touches. */
export function chaptersOf(r: VerseRange): number[] {
  const out: number[] = [];
  for (let c = r.start.chapter; c <= r.end.chapter && out.length < 200; c++) out.push(c);
  return out;
}

/** "GEN 1:1-2:3" for the record. */
export function refText(r: VerseRange): string {
  if (r.start.chapter === r.end.chapter) return `${r.book} ${r.start.chapter}:${r.start.verse}-${r.end.verse}`;
  return `${r.book} ${r.start.chapter}:${r.start.verse}-${r.end.chapter}:${r.end.verse}`;
}

// ---- verses ------------------------------------------------------------------------------------

export interface VerseRow {
  /** "1:3", or "1:38-39" for a bridge; also how notes name a verse. */
  key: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  text: string;
}

const rowKey = (c: number, vs: number, ve: number) => (vs === ve ? `${c}:${vs}` : `${c}:${vs}-${ve}`);

/**
 * The passage's verses from each chapter's `[verseStart, verseEnd, text]`
 * rows: a bridge is one row, kept whole when it touches the range. Null
 * when a chapter the passage needs has no text.
 */
export function passageRows(range: VerseRange, chapters: ReadonlyMap<number, readonly [number, number, string][]>): VerseRow[] | null {
  const out: VerseRow[] = [];
  for (const c of chaptersOf(range)) {
    const verses = chapters.get(c);
    if (!verses || verses.length === 0) return null;
    const first = c === range.start.chapter ? range.start.verse : 1;
    const last = c === range.end.chapter ? range.end.verse : Infinity;
    for (const [vs, ve, text] of verses) {
      if (ve < first || vs > last || vs <= 0) continue;
      out.push({ key: rowKey(c, vs, ve), chapter: c, verseStart: vs, verseEnd: ve, text });
    }
  }
  return out.length ? out : null;
}

/** The row a timing segment falls in. */
export function rowFor(rows: readonly VerseRow[], chapter: number, verse: number): VerseRow | undefined {
  return rows.find((r) => r.chapter === chapter && r.verseStart <= verse && r.verseEnd >= verse);
}

// ---- timings ------------------------------------------------------------------------------------

export type Timing = Pick<TimingDoc, 'introEndMs' | 'segments'>;
export type TimingSource = 'library' | 'fcbh' | 'none';

/**
 * A chapter's verse timings, in order of preference: the `timing@1` its
 * source book names (an aligner's, FCBH's copied in, or a person's
 * correction), then FCBH's live `/timestamps`, else none, and then the
 * audio plays without highlighting. Never simulated. A library timing for
 * a different recording (its SHA-256 differs from the audio's) is not used.
 */
export function resolveTiming(c: {
  bookTiming?: TimingDoc | null;
  audioHash?: string | null;
  fcbhRows?: { verse: number; seconds: number }[] | null;
  durationMs?: number | null;
}): { timing: Timing | null; source: TimingSource } {
  const t = c.bookTiming;
  if (t && t.segments.length > 0 && (!c.audioHash || t.audio.sha256 === c.audioHash)) return { timing: { introEndMs: t.introEndMs, segments: t.segments }, source: 'library' };
  if (c.fcbhRows && c.fcbhRows.some((r) => r.verse > 0)) {
    // Without the file's length, the last verse runs "to the end": the player stops at the file's end anyway.
    return { timing: segmentsFromStarts(c.fcbhRows, c.durationMs ?? Number.MAX_SAFE_INTEGER), source: 'fcbh' };
  }
  return { timing: null, source: 'none' };
}

// ---- what plays ------------------------------------------------------------------------------------

export interface ChapterAudio {
  chapter: number;
  timing: Timing | null;
}

/** One file's share of the passage: from `fromMs` to `toMs` (null: to the end of the file). */
export interface PlayPart {
  chapter: number;
  fromMs: number;
  toMs: number | null;
  timing: Timing | null;
}

export interface PlayPlan {
  parts: PlayPart[];
  /** A chapter the passage only partly covers has no timings, so all of it plays. */
  wholeChapters: boolean;
  /** Chapters of the passage with no audio in this source. */
  missing: number[];
}

/**
 * Play only the passage: from its first verse's start to its last verse's
 * end, across chapter files. With timings a chapter plays from where the
 * passage starts in it to where it ends; without, a chapter the passage
 * covers only in part plays whole, and the plan says so.
 */
export function playPlan(range: VerseRange, audio: readonly ChapterAudio[]): PlayPlan {
  const parts: PlayPart[] = [];
  const missing: number[] = [];
  let wholeChapters = false;
  for (const c of chaptersOf(range)) {
    const a = audio.find((x) => x.chapter === c);
    if (!a) { missing.push(c); continue; }
    const first = c === range.start.chapter ? range.start.verse : 1;
    const lastVerse = c === range.end.chapter ? range.end.verse : Infinity;
    const partial = first > 1 || lastVerse !== Infinity;
    if (!a.timing) {
      if (partial) wholeChapters = true;
      parts.push({ chapter: c, fromMs: 0, toMs: null, timing: null });
      continue;
    }
    const segs = a.timing.segments;
    const finalVerse = segs.length ? Math.max(...segs.map((s) => s.verseEnd)) : 0;
    const span = verseSpan(a.timing, first, Number.isFinite(lastVerse) ? lastVerse : finalVerse);
    if (!span) { wholeChapters = wholeChapters || partial; parts.push({ chapter: c, fromMs: 0, toMs: null, timing: a.timing }); continue; }
    // Running to the chapter's last verse: play to the end of the file, not to a guessed end.
    const toEnd = !Number.isFinite(lastVerse) || lastVerse >= finalVerse;
    parts.push({ chapter: c, fromMs: span.startMs, toMs: toEnd ? null : span.endMs, timing: a.timing });
  }
  return { parts, wholeChapters, missing };
}

/** The verse row playing at `ms` in part `i`; none before the first verse (the spoken heading). */
export function rowAt(plan: PlayPlan, i: number, ms: number, rows: readonly VerseRow[]): VerseRow | undefined {
  const part = plan.parts[i];
  if (!part?.timing) return undefined;
  const seg = segmentAt(part.timing, ms);
  return seg ? rowFor(rows, part.chapter, seg.verseStart) ?? rowFor(rows, part.chapter, seg.verseEnd) : undefined;
}

/** Where tapping a verse jumps to: its part and its start; null when there is no timing for it. */
export function seekTargetFor(plan: PlayPlan, row: VerseRow): { part: number; ms: number } | null {
  const i = plan.parts.findIndex((p) => p.chapter === row.chapter);
  const part = plan.parts[i];
  if (!part?.timing) return null;
  const span = verseSpan(part.timing, row.verseStart, row.verseEnd);
  return span ? { part: i, ms: Math.max(part.fromMs, span.startMs) } : null;
}

// ---- the record of what was used ------------------------------------------------------------------

/** One source as the record names it. */
export function sourceUsed(o: SourceOption, c: { ref: string; opened: boolean; filesets?: string[] }): UsedReference {
  const copyright = [o.doc?.copyright.text ?? o.bible?.copyright.text, o.doc?.copyright.audio ?? o.bible?.copyright.audio]
    .filter((x, i, all): x is string => !!x && all.indexOf(x) === i).join(' · ');
  const detail = (c.filesets ?? []).filter(Boolean).join(' ');
  return {
    itemId: o.itemId, name: o.name, kind: 'source', opened: c.opened, ref: c.ref,
    ...(o.docHash ? { docHash: o.docHash } : {}), ...(detail ? { detail } : {}), ...(copyright ? { copyright } : {})
  };
}

/** What was offered, with `opened` set for what was played, chosen or opened. Offered order is kept. */
export function usedItems(offered: ReadonlyMap<string, UsedReference>, opened: ReadonlySet<string>): UsedReference[] {
  return [...offered.values()].map((u) => ({ ...u, opened: u.opened || opened.has(u.itemId) }));
}

/** "Made with Berean Standard Bible (opened), FIA" (core `usedSummary`): opened items first, and marked. */
export function madeWithLine(items: Pick<UsedReference, 'name' | 'opened'>[], limit = 3): string {
  if (items.length === 0) return '';
  return `Made with ${usedSummary(items.map((i) => ({ name: i.opened ? `${i.name} (opened)` : i.name, opened: i.opened })), limit)}`;
}
