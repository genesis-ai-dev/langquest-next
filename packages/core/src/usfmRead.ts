/**
 * Reading USFM into what a person reads (decision 208, LAN-230): chapters of
 * verses, each with its headings, its lines (a paragraph, a line of poetry)
 * and its notes. Pure: text in, a book out. One walk over the markers serves
 * the upload's check (`usfm.ts`) and the reader, so what was checked is what
 * shows.
 *
 * Three promises hold for any text at all (test/usfmRead.test.ts): it never
 * throws, no backslash code reaches a word a person reads, and a verse's plain
 * text is exactly the words of its lines, so a heading or a note never counts
 * as a verse's text.
 */

/** How a run of words looks. */
export type UsfmSpanStyle = 'italic' | 'bold' | 'boldItalic' | 'smallCaps';

export interface UsfmSpan {
  text: string;
  style?: UsfmSpanStyle;
  /** A run that is a mark in the text, not words: a note's letter, or a split verse's own number ("4b"). */
  mark?: 'note' | 'verse';
}

/** What a heading is: a major section, a section, a reference under it, a speaker, a Psalm's title. */
export type UsfmHeadingStyle = 'major' | 'section' | 'reference' | 'speaker' | 'title';

export type UsfmLineStyle = 'prose' | 'poetry' | 'center' | 'right' | 'list' | 'title';

/** One paragraph or one line of poetry; `gap` is a space before it (a new paragraph or a stanza). */
export interface UsfmLine { kind: 'line'; style: UsfmLineStyle; indent: number; gap: boolean; spans: UsfmSpan[] }
export interface UsfmHeading { kind: 'heading'; style: UsfmHeadingStyle; text: string }
export type UsfmPiece = UsfmHeading | UsfmLine;

export interface UsfmNote {
  /** The letter marked in the text; empty when nothing marks it (`\f -`, or a note on a heading). */
  call: string;
  kind: 'footnote' | 'crossref';
  /** The verse the file says it is on ("2:2"). */
  ref: string;
  spans: UsfmSpan[];
}

export interface UsfmVerse {
  start: number;
  end: number;
  /** The words alone: no heading, no note. */
  text: string;
  /** In reading order. Headings before the first line stand above the verse. */
  pieces: UsfmPiece[];
  notes: UsfmNote[];
}

export interface UsfmReadChapter {
  chapter: number;
  /** The file's own name for this chapter (`\cl`), when it has one. */
  label?: string;
  verses: UsfmVerse[];
}

/** What the walk found wrong; `usfm.ts` says these to the admin. */
export type UsfmReadProblem =
  | { code: 'strayVerse' }
  | { code: 'badChapter'; text: string }
  | { code: 'chapterTwice'; chapter: number }
  | { code: 'chapterOrder'; chapter: number; after: number }
  | { code: 'badVerse'; chapter: number; text: string }
  | { code: 'backward'; chapter: number; start: number; end: number }
  | { code: 'outOfOrder'; chapter: number; verse: number };

export interface UsfmRead {
  /** The first text of each naming marker (`h`, `toc1`, `toc2`, `toc3`, `mt`, `mt1`). */
  names: Record<string, string>;
  chapters: UsfmReadChapter[];
  problems: UsfmReadProblem[];
}

// ---- which marker does what ------------------------------------------------------

type LineLook = { style: UsfmLineStyle; indent: number; gap: boolean };

const LINES: Record<string, { style: UsfmLineStyle; indent: number; joined?: true }> = {
  p: { style: 'prose', indent: 0 }, m: { style: 'prose', indent: 0 }, po: { style: 'prose', indent: 0 }, pm: { style: 'prose', indent: 1 },
  pmo: { style: 'prose', indent: 0 }, pmc: { style: 'prose', indent: 0 }, cls: { style: 'prose', indent: 0 }, lh: { style: 'prose', indent: 0 }, lf: { style: 'prose', indent: 0 },
  mi: { style: 'prose', indent: 1 }, nb: { style: 'prose', indent: 0, joined: true }, pc: { style: 'center', indent: 0 }, pr: { style: 'right', indent: 0 }, pmr: { style: 'right', indent: 0 },
  qc: { style: 'center', indent: 0 }, qr: { style: 'right', indent: 0 }, qd: { style: 'poetry', indent: 0 }, tr: { style: 'list', indent: 0, joined: true }
};
/** Numbered lines: `\q2`, `\pi1`, `\li3`. The number says how far in. */
const NUMBERED_LINES: Record<string, UsfmLineStyle> = { q: 'poetry', qm: 'poetry', pi: 'prose', ph: 'prose', li: 'list', lim: 'list' };

const HEADINGS: Record<string, UsfmHeadingStyle> = {
  ms: 'major', s: 'section', sd: 'section', mr: 'reference', sr: 'reference', r: 'reference', cd: 'reference', sp: 'speaker', qa: 'speaker', d: 'title'
};

/** Lines that are not the Bible's to read here: the file's own facts, the book's names, its introduction. */
const SKIP_LINE = /^(id|ide|usfm|sts|rem|h\d*|toc\d*|toca\d*|mt\d*|mte\d*|cp|periph|restore)$/;
const INTRODUCTION = /^i[a-z]+\d*$/;
const NAME_MARKERS = new Set(['h', 'toc1', 'toc2', 'toc3', 'mt', 'mt1']);

/** Character markers whose words are not read: an alternate verse or chapter number, a picture, a quoted reference, a category. */
const DROPPED = new Set(['va', 'vp', 'ca', 'fig', 'rq', 'cat', 'fm', 'xop']);
/** A character marker's look; every other one keeps its words plain. */
const LOOKS: Record<string, UsfmSpanStyle> = {
  it: 'italic', em: 'italic', add: 'italic', tl: 'italic', bk: 'italic', sls: 'italic', qs: 'italic', dc: 'italic', fq: 'italic', fqa: 'italic', xq: 'italic',
  bd: 'bold', no: 'bold', fk: 'bold', xk: 'bold', k: 'bold', qac: 'bold', bdit: 'boldItalic', nd: 'smallCaps', sc: 'smallCaps'
};
const NOTES: Record<string, UsfmNote['kind']> = { f: 'footnote', fe: 'footnote', ef: 'footnote', x: 'crossref', ex: 'crossref' };
const NOTE_REF = new Set(['fr', 'xo']);

// ---- the words --------------------------------------------------------------------

/** One marker: `\p`, `\nd`, `\nd*`, `\+nd`; also a bare `\*` or `\`, which say nothing. */
const TOKEN = /\\\+?([A-Za-z][A-Za-z0-9-]*)(\*?)|\\\*|\\/g;
const VERSE = /^\s*(\d+)([a-z]?)(?:\s*[-–—]\s*(\d+)([a-z]?))?(?=\s|$)/;
/** A note's caller: `+`, `-` or the mark the file chose. */
const CALLER = /^\s*([^\s\\])(?=\s|\\|$)/;

const tidy = (s: string) => s.replace(/\/\//g, ' ').replace(/~/g, ' ').replace(/[ \t\r\n\f\v ]+/g, ' ');

function pushWords(spans: UsfmSpan[], text: string, style: UsfmSpanStyle | undefined): void {
  const last = spans[spans.length - 1];
  const clean = tidy(text);
  // A space ending one run and a space starting the next are one space.
  const words = last && !last.mark && last.text.endsWith(' ') ? clean.replace(/^ /, '') : clean;
  if (!words) return;
  if (last && !last.mark && last.style === style) last.text += words;
  else spans.push(style ? { text: words, style } : { text: words });
}

function trimmed(spans: readonly UsfmSpan[]): UsfmSpan[] {
  const out = spans.map((s) => ({ ...s }));
  while (out.length && !out[0]!.mark) {
    out[0]!.text = out[0]!.text.replace(/^ +/, '');
    if (out[0]!.text) break;
    out.shift();
  }
  while (out.length && !out[out.length - 1]!.mark) {
    const end = out[out.length - 1]!;
    end.text = end.text.replace(/ +$/, '');
    if (end.text) break;
    out.pop();
  }
  return out;
}

const wordsOf = (spans: readonly UsfmSpan[]) => spans.filter((s) => !s.mark).map((s) => s.text).join('').replace(/ +/g, ' ').trim();

/** a, b, … z, aa, ab: the letters of a chapter's notes. */
function callAt(i: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return i < letters.length ? letters[i]! : letters[Math.floor(i / letters.length) - 1]! + letters[i % letters.length]!;
}

// ---- the walk ----------------------------------------------------------------------

/** Where words go now. */
type Into =
  | { kind: 'verse' }
  | { kind: 'skip'; marker: string }
  | { kind: 'heading'; style: UsfmHeadingStyle; spans: UsfmSpan[] }
  | { kind: 'chapterLabel'; text: string };

type Look = { marker: string; style?: UsfmSpanStyle };

const lookOf = (looks: readonly Look[]): UsfmSpanStyle | undefined => {
  for (let i = looks.length - 1; i >= 0; i--) if (looks[i]!.style) return looks[i]!.style;
  return undefined;
};

class Walk {
  readonly out: UsfmRead = { names: {}, chapters: [], problems: [] };
  private chapter: UsfmReadChapter | null = null;
  private verse: UsfmVerse | null = null;
  private line: UsfmLine | null = null;
  private into: Into = { kind: 'skip', marker: '' };
  private lineLook: LineLook = { style: 'prose', indent: 0, gap: false };
  private looks: Look[] = [];
  private dropping: string | null = null;
  private inSidebar = false;
  /** Headings waiting for what comes after them: the next verse, or more of this one. */
  private waiting: UsfmPiece[] = [];
  /** Notes on a heading waiting with it. */
  private waitingNotes: UsfmNote[] = [];
  private note: { note: UsfmNote; part: string; looksOutside: Look[]; ref: string } | null = null;
  private notesInChapter = 0;
  /** The number a split verse's next line starts with ("4b"). */
  private verseMark = '';
  private lastEnd = 0;
  private split = false;
  private readonly seen = new Set<number>();
  private highest = 0;
  private nameOpen: string | null = null;

  words(raw: string): void {
    if (this.inSidebar || this.dropping) return;
    // A word's attributes (`\w word|lemma="x"\w*`) run from its bar to the next marker.
    const s = (this.looks.length > 0 || this.note) && raw.includes('|') ? raw.slice(0, raw.indexOf('|')) : raw;
    const note = this.note;
    if (note) {
      if (NOTE_REF.has(note.part)) note.ref += s;
      else pushWords(note.note.spans, s, lookOf(this.looks));
      return;
    }
    const into = this.into;
    if (into.kind === 'skip') this.nameWords(into.marker, s);
    else if (into.kind === 'chapterLabel') into.text += s;
    else if (into.kind === 'heading') pushWords(into.spans, s, lookOf(this.looks));
    else if (this.verse && (s.trim() || this.line)) pushWords(this.openLine().spans, s, lookOf(this.looks));
  }

  private nameWords(marker: string, s: string): void {
    const n = tidy(s).trim();
    if (!n || !NAME_MARKERS.has(marker)) return;
    const names = this.out.names;
    if (names[marker] === undefined) { names[marker] = n; this.nameOpen = marker; }
    else if (this.nameOpen === marker) names[marker] += ` ${n}`;
  }

  /** A line starts where its first word falls, so a `\p` before a `\v`, or at a verse's end, leaves no empty line. */
  private openLine(): UsfmLine {
    if (this.line) return this.line;
    const line: UsfmLine = { kind: 'line', ...this.lineLook, spans: [] };
    if (this.verseMark) { line.spans.push({ text: this.verseMark, mark: 'verse' }); this.verseMark = ''; }
    this.lineLook = { ...this.lineLook, gap: false };
    this.verse!.pieces.push(...this.waiting, line);
    this.waiting = [];
    this.line = line;
    return line;
  }

  private closeLine(): void {
    if (this.line) this.line.spans = trimmed(this.line.spans);
    this.line = null;
  }

  private closeVerse(): void {
    this.closeLine();
    const v = this.verse;
    this.verse = null;
    if (!v || !this.chapter) return;
    v.text = v.pieces.flatMap((p) => (p.kind === 'line' ? [wordsOf(p.spans)] : [])).filter(Boolean).join(' ');
    this.chapter.verses.push(v);
  }

  /** End what a heading or a chapter's name was gathering. */
  private closeGathering(): void {
    const into = this.into;
    if (into.kind === 'heading') {
      const text = wordsOf(into.spans);
      if (text) this.waiting.push({ kind: 'heading', style: into.style, text });
      // `\d \v 1 words`: the title is the verse's own line; `\d words`: it stood alone, and what follows is not a title.
      if (text && this.lineLook.style === 'title') this.lineLook = { style: 'prose', indent: 0, gap: false };
      this.into = { kind: 'verse' };
    } else if (into.kind === 'chapterLabel') {
      if (this.chapter && into.text.trim()) this.chapter.label = tidy(into.text).trim();
      this.into = { kind: 'verse' };
    }
  }

  private closeNote(): void {
    const open = this.note;
    if (!open) return;
    this.note = null;
    this.looks = open.looksOutside;
    this.dropping = null;
    const n = open.note;
    n.ref = tidy(open.ref).trim().replace(/[.:]\s*$/, '');
    n.spans = trimmed(n.spans);
    if (!n.spans.length) return;
    if (this.into.kind === 'heading' || !this.verse) this.waitingNotes.push({ ...n, call: '' });
    else this.verse.notes.push(n);
  }

  /** Close whatever is open inside a line, for a marker that starts something new. */
  private endInline(): void {
    this.closeNote();
    this.looks = [];
    this.dropping = null;
  }

  openNote(name: string, after: string): number {
    this.closeNote();
    const caller = CALLER.exec(after);
    const mark = caller?.[1];
    const call = mark === '-' ? '' : !mark || mark === '+' ? callAt(this.notesInChapter++) : mark;
    this.note = { note: { call, kind: NOTES[name]!, ref: '', spans: [] }, part: 'ft', looksOutside: this.looks, ref: '' };
    this.looks = [];
    if (call && this.into.kind === 'verse' && this.verse && !this.dropping) this.openLine().spans.push({ text: call, mark: 'note' });
    return caller?.[0].length ?? 0;
  }

  /** A marker inside a note. True when the note took it. */
  noteMarker(name: string): boolean {
    const note = this.note;
    if (!note) return false;
    // A verse, chapter or new paragraph ends a note left open, so it never swallows them.
    if (name === 'v' || name === 'c' || /^(p|m|q\d*|s\d*)$/.test(name)) { this.closeNote(); return false; }
    if (DROPPED.has(name)) { this.dropping = name; return true; }
    if (/^[fx][a-z]+$/.test(name)) {
      note.part = name;
      this.dropping = null;
      this.looks = this.looks.filter((l) => l.marker !== 'part');
      if (LOOKS[name]) this.looks.push({ marker: 'part', style: LOOKS[name]! });
      return true;
    }
    this.looks.push({ marker: name, ...(LOOKS[name] ? { style: LOOKS[name]! } : {}) });
    return true;
  }

  closer(name: string): void {
    if (this.inSidebar) return;
    if (this.note && NOTES[name]) { this.closeNote(); return; }
    if (this.dropping) { if (this.dropping === name) this.dropping = null; return; }
    const i = this.looks.map((l) => l.marker).lastIndexOf(name);
    if (i >= 0) this.looks = this.looks.slice(0, i);
    else if (this.note) {
      this.note.part = 'ft';
      this.looks = this.looks.filter((l) => l.marker !== 'part');
    }
  }

  /** `\c 3`: returns the words after the number. */
  startChapter(arg: string): string {
    this.closeGathering();
    this.endInline();
    this.closeVerse();
    this.lastEnd = 0;
    this.split = false;
    this.into = { kind: 'verse' };
    this.lineLook = { style: 'prose', indent: 0, gap: false };
    const m = /^\s*(\S*)/.exec(arg)!;
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isInteger(n) || n < 1) {
      this.out.problems.push({ code: 'badChapter', text: arg.trim().slice(0, 20) });
      return '';
    }
    if (this.seen.has(n)) this.out.problems.push({ code: 'chapterTwice', chapter: n });
    else if (n < this.highest) this.out.problems.push({ code: 'chapterOrder', chapter: n, after: this.highest });
    this.seen.add(n);
    this.highest = Math.max(this.highest, n);
    this.notesInChapter = 0;
    this.chapter = { chapter: n, verses: [] };
    this.out.chapters.push(this.chapter);
    return arg.slice(m[0].length);
  }

  /** `\v 4a`: returns the words after the number. */
  startVerse(arg: string): string {
    this.closeGathering();
    this.endInline();
    if (this.into.kind !== 'verse') this.into = { kind: 'verse' };
    const chapter = this.chapter;
    if (!chapter) {
      this.out.problems.push({ code: 'strayVerse' });
      return '';
    }
    const m = VERSE.exec(arg);
    if (!m) {
      this.closeVerse();
      this.out.problems.push({ code: 'badVerse', chapter: chapter.chapter, text: arg.trim().slice(0, 20) });
      return '';
    }
    const start = Number(m[1]);
    const end = m[3] ? Number(m[3]) : start;
    if (end < start) {
      this.closeVerse();
      this.out.problems.push({ code: 'backward', chapter: chapter.chapter, start, end });
      return '';
    }
    const part = !!m[2] || !!m[4];
    const label = `${m[1]}${m[2] ?? ''}${m[3] ? `-${m[3]}${m[4] ?? ''}` : ''}`;
    const rest = arg.slice(m[0].length);
    // `\v 4a … \v 4b`, `\v 4b-5a … \v 5b`: parts of one row, each keeping its own number in the text.
    if (this.verse && part && this.split && start <= this.lastEnd) {
      this.closeLine();
      this.verse.end = Math.max(this.verse.end, end);
      this.lastEnd = Math.max(this.lastEnd, end);
      this.verseMark = label;
      return rest;
    }
    this.closeVerse();
    if (start <= this.lastEnd && this.lastEnd > 0) this.out.problems.push({ code: 'outOfOrder', chapter: chapter.chapter, verse: start });
    this.lastEnd = Math.max(this.lastEnd, end);
    this.split = part;
    this.verseMark = part ? label : '';
    this.verse = { start, end, text: '', pieces: [], notes: this.waitingNotes };
    this.waitingNotes = [];
    return rest;
  }

  /** Every other opening marker. */
  marker(name: string): void {
    if (this.inSidebar) { if (name === 'esbe') this.inSidebar = false; return; }
    const shape = /^([a-z]+?)(\d*)$/.exec(name);
    const base = shape?.[1] ?? name;
    const number = shape?.[2] ? Number(shape[2]) : null;
    if (name === 'esb') { this.startBlock(); this.inSidebar = true; return; }
    if (name === 'b') { this.startBlock(); this.lineLook = { ...this.lineLook, gap: true }; return; }
    if (name === 'cl') {
      this.startBlock();
      if (this.chapter) this.into = { kind: 'chapterLabel', text: '' };
      else this.into = { kind: 'skip', marker: 'cl' };
      return;
    }
    if (HEADINGS[base]) {
      this.startBlock();
      if (base === 'd') this.lineLook = { style: 'title', indent: 0, gap: false };
      this.into = { kind: 'heading', style: HEADINGS[base]!, spans: [] };
      return;
    }
    if (SKIP_LINE.test(name) || (INTRODUCTION.test(name) && !LOOKS[name])) {
      this.startBlock();
      this.nameOpen = null;
      this.into = { kind: 'skip', marker: name };
      return;
    }
    const fixed = LINES[base];
    const numbered = NUMBERED_LINES[base];
    if (fixed || numbered) {
      this.startBlock();
      this.into = { kind: 'verse' };
      const style = numbered ?? fixed!.style;
      const indent = numbered ? Math.max(0, (number ?? 1) - (style === 'poetry' ? 1 : 0)) : fixed!.indent;
      // Poetry's lines follow one another; a stanza break (`\b`) or coming into poetry makes a space.
      const gap = fixed?.joined ? false : style === 'poetry' ? this.lineLook.gap || this.lineLook.style !== 'poetry' : true;
      this.lineLook = { style, indent, gap };
      return;
    }
    if (DROPPED.has(name)) { this.dropping = name; return; }
    // Any other marker is a character marker: its words stay and its code never shows.
    this.looks.push({ marker: name, ...(LOOKS[name] ? { style: LOOKS[name]! } : {}) });
  }

  private startBlock(): void {
    this.closeGathering();
    this.endInline();
    this.closeLine();
  }

  finish(): UsfmRead {
    this.startBlock();
    this.closeVerse();
    return this.out;
  }
}

/** Read one USFM file. Never throws: what is wrong is in `problems`. */
export function readUsfm(text: string): UsfmRead {
  const src = text.replace(/^﻿/, '');
  const walk = new Walk();
  const token = new RegExp(TOKEN);
  /** A marker's argument: the words up to the next marker. */
  const argFrom = (from: number): { arg: string; next: number } => {
    const next = src.indexOf('\\', from);
    return next < 0 ? { arg: src.slice(from), next: src.length } : { arg: src.slice(from, next), next };
  };
  let at = 0;
  for (;;) {
    token.lastIndex = at;
    const tk = token.exec(src);
    if (!tk) { walk.words(src.slice(at)); break; }
    if (tk.index > at) walk.words(src.slice(at, tk.index));
    at = token.lastIndex;
    const name = tk[1]?.toLowerCase();
    if (!name) continue;

    // Milestones are read and gone: `\zaln-s |x="y"\*`, `\qt-e\*`, `\ts\*`.
    if (/-[se]$/.test(name) || src.startsWith('\\*', at)) {
      const end = src.indexOf('\\*', at);
      const eol = src.indexOf('\n', at);
      if (end >= 0 && (eol < 0 || end < eol)) at = end + 2;
      else if (/-[se]$/.test(name)) at = eol >= 0 ? eol : src.length;
      continue;
    }
    if (tk[2] === '*') { walk.closer(name); continue; }
    // One space ends a marker; more are the text's own.
    at += /^(\r\n|\s)/.exec(src.slice(at, at + 2))?.[0].length ?? 0;
    if (NOTES[name] && !tk[0].startsWith('\\+')) { at += walk.openNote(name, src.slice(at, at + 8)); continue; }
    if (walk.noteMarker(name)) continue;
    const chapterAt = /^c(\d*)$/.exec(name);
    const verseAt = /^v(\d+[a-z]?)?$/.exec(name);
    if (chapterAt || verseAt) {
      const { arg, next } = argFrom(at);
      walk.words(chapterAt ? walk.startChapter(`${chapterAt[1]}${arg}`) : walk.startVerse(`${verseAt![1] ?? ''}${arg}`));
      at = next;
      continue;
    }
    walk.marker(name);
  }
  return walk.finish();
}

/** A verse's plain words from any USFM inside it: no markup, no note. */
export function usfmPlainText(raw: string): string {
  return readUsfm(`\\c 1\n\\v 1 ${raw}`).chapters[0]?.verses.map((v) => v.text).join(' ') ?? '';
}
