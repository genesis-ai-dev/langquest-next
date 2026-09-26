/**
 * Study text: one step's document, broken into tappable sections. Ported
 * from the UX reference (`ng-langquest-ux` src/studyText.ts, branch
 * caleb-spoken-mobbin-overhaul). Study material is one markdown document per
 * step (FIA's API sends `textAsMarkdown`). The UI breaks it up by line
 * breaks, so any paragraph, list item or "Stop here" box can be pointed at,
 * and each keeps its inline links to media, maps and glossary terms. Section
 * ids come from the order of the sections, so they are stable for as long as
 * the text is.
 *
 * Also here: `passageReading`, the verses of a passage with their real BSB
 * (Hays) audio timings, for the study screens' Passage view. Pure: no I/O.
 */
import { BIBLE_BOOKS, FIA_PERICOPES } from './catalogData';
import { BSB_HAYS_TIMINGS } from './bibleData/timings';
import { bibleRangeFromUnit, bibleText, verseAddress, type BibleRange } from './dynamicBible';

export type StudySectionKind = 'para' | 'item' | 'action' | 'heading';

export interface StudySection {
  id: string;
  kind: StudySectionKind;
  /** Inline markdown: bold and links are kept for rendering. */
  text: string;
  /** A numbered list item's number. */
  n?: number;
}

export function studySections(md: string): StudySection[] {
  const out: Omit<StudySection, 'id'>[] = [];
  let para: string[] = [];
  let action: string[] | null = null;
  const flushPara = () => {
    if (para.length) out.push({ kind: 'para', text: para.join(' ').trim() });
    para = [];
  };
  const flushAction = () => {
    if (action) {
      const text = action.join(' ').replace(/^\[!action\]\s*/i, '').trim();
      if (text) out.push({ kind: 'action', text });
    }
    action = null;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('>')) {
      flushPara();
      const body = line.replace(/^>\s?/, '');
      if (/^\[!action\]/i.test(body) || action === null) { flushAction(); action = []; }
      if (body && !/^\[!action\]$/i.test(body)) action!.push(body);
      continue;
    }
    flushAction();
    if (!line) { flushPara(); continue; }
    const numbered = /^(\d+)\.\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (numbered) { flushPara(); out.push({ kind: 'item', text: numbered[2]!, n: Number(numbered[1]) }); continue; }
    if (bullet) { flushPara(); out.push({ kind: 'item', text: bullet[1]! }); continue; }
    if (heading) { flushPara(); out.push({ kind: 'heading', text: heading[1]! }); continue; }
    para.push(line);
  }
  flushPara();
  flushAction();
  return out.map((s, i) => ({ ...s, id: `s${i}` }));
}

export type InlinePart =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  /** `ref` is the link target without its "#": "m387" media, "c47" map, "t63" glossary term. */
  | { type: 'link'; text: string; ref: string };

/** `__bold__`, `**bold**` and `[label](#ref)`: all FIA's step text uses. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const re = /\[([^\]]+)\]\(#?([^)]+)\)|__([^_]+)__|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ type: 'text', text: text.slice(last, i) });
    if (m[1]) parts.push({ type: 'link', text: m[1], ref: m[2]! });
    else parts.push({ type: 'bold', text: (m[3] ?? m[4])! });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

export function plainText(text: string): string {
  return inlineParts(text).map((p) => p.text).join('');
}

/** The id of the first section containing `phrase`, for anchoring to a known sentence. */
export function sectionIdFor(md: string, phrase: string): string {
  return studySections(md).find((s) => plainText(s.text).includes(phrase))?.id ?? 's0';
}

/** A short label for a section, for anchors and history ("Stop here and discuss…"). */
export function sectionLabel(s: StudySection, max = 44): string {
  const t = plainText(s.text);
  return t.length > max ? `${t.slice(0, max - 2).trimEnd()}…` : t;
}

/** A question section ends in "?": the reference answers it rather than noting it. */
export function isQuestionSection(s: StudySection): boolean {
  return plainText(s.text).trim().endsWith('?');
}

/** "m:ss" → seconds. */
export function secondsOf(t: string): number {
  const [m, s] = t.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
}

/** Seconds → "m:ss". */
export function clock(s: number): string {
  const n = Math.max(0, Math.floor(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

// ---- the passage beside the study ------------------------------------------

export interface ReadingVerse {
  chapter: number;
  verse: number;
  text: string;
  /** Seconds into that chapter's BSB (Hays) recording, when timed. */
  startSeconds?: number;
  endSeconds?: number;
}

/**
 * A FIA pericope's verse range ("2:4-25", "1:1-2:3") as BSB verse ordinals.
 * FIA seeds spell Mark and John differently from our book ids.
 */
function fiaRange(itemId: string): BibleRange | null {
  const p = FIA_PERICOPES.find((x) => x.itemId === itemId);
  if (!p) return null;
  const book = p.book === 'mrk' ? 'mar' : p.book === 'jhn' ? 'joh' : p.book;
  const m = /^(\d+):(\d+)(?:[–-](?:(\d+):)?(\d+))?$/.exec(p.verseRange.trim());
  const b = BIBLE_BOOKS.find((x) => x.itemId === book);
  if (!m || !b) return null;
  const ordinal = (chapter: number, verse: number) =>
    b.verses.slice(0, chapter - 1).reduce((a, n) => a + n, 0) + verse;
  const c1 = Number(m[1]), v1 = Number(m[2]);
  const c2 = m[3] ? Number(m[3]) : c1, v2 = m[4] ? Number(m[4]) : v1;
  if (c1 < 1 || c2 < c1 || c2 > b.verses.length || v1 < 1 || v1 > b.verses[c1 - 1]! ||
    v2 < 1 || v2 > b.verses[c2 - 1]!) return null;
  const start = ordinal(c1, v1), end = ordinal(c2, v2);
  return end >= start ? { book, start, end } : null;
}

/**
 * The passage's BSB verses, each with its real Hays timing when the timing
 * data has it (never estimated from verse length). Dynamic passages and FIA
 * pericopes resolve; any other unit has no reading (empty list), so the
 * screen says so instead of guessing from a label.
 */
export function passageReading(unitId: string): { book: string; verses: ReadingVerse[] } | null {
  const dynamic = bibleRangeFromUnit(unitId);
  const fia = /^fia@\d+\/(.+)$/.exec(unitId);
  const range = dynamic ?? (fia ? fiaRange(fia[1]!) : null);
  if (!range) return null;
  const texts = bibleText(range);
  if (!texts.length) return null;
  const verses = texts.map((text, i): ReadingVerse => {
    const at = verseAddress(range.book, range.start + i)!;
    const span = BSB_HAYS_TIMINGS[range.book]?.[at.chapter]?.[at.verse - 1];
    return { chapter: at.chapter, verse: at.verse, text,
      ...(span ? { startSeconds: span[0], endSeconds: span[1] } : {}) };
  });
  return { book: range.book, verses };
}
