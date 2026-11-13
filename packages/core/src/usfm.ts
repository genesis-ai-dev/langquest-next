import { BIBLE_BOOKS } from './catalogData';
import { USFM_BOOKS, usfmOf } from './versification';

/**
 * Reading one USFM file (decision 253, docs/reference-material.md): the
 * check an admin sees before a Bible is published as organization
 * reference material. Pure: text in, a book and what is wrong with it out.
 *
 * Only the words of each verse are kept here, with markup, footnotes and
 * cross references taken out; the file's own text travels with the book
 * (`usfmBook@1.usfm`), so how paragraphs, headings and notes are shown
 * (LAN-230) needs no second upload.
 */

/** Markers whose whole span is not verse text: footnotes, cross references, study notes, figures, sidebars. */
/** Which reading of a file `checkUsfm` is. A change to what it keeps or drops is a new number, as Aquilla stamps its importers (its decision 0001). */
export const USFM_PARSER_VERSION = 1;

const SPAN_MARKERS = ['f', 'fe', 'x', 'ef', 'ex', 'esb', 'fig'];

export interface UsfmChapter {
  chapter: number;
  /** `[verseStart, verseEnd, text]`; a bridge such as `\v 3-4` is one row. */
  verses: [number, number, string][];
}

/**
 * What is wrong in a file, as a code and the facts that fill in its
 * sentence. The app says each in the reader's language; `usfmProblemText`
 * is the English for tests and logs.
 */
export type UsfmProblem =
  | { code: 'empty' | 'tooBig' | 'brokenLetters' | 'notUsfm' | 'noId' | 'noCode' | 'strayVerse' | 'noChapters' | 'noVerses' }
  | { code: 'frontBack' | 'unknownCode'; book: string }
  | { code: 'badChapter'; text: string }
  | { code: 'chapterTwice' | 'missingChapters'; chapter: number }
  | { code: 'chapterOrder'; chapter: number; after: number }
  | { code: 'badVerse'; chapter: number; text: string }
  | { code: 'backward'; chapter: number; start: number; end: number }
  | { code: 'outOfOrder' | 'emptyVerses' | 'missingVerses'; count: number }
  | { code: 'duplicateBook'; book: string; other: string };

export interface UsfmCheck {
  fileName: string;
  /** USFM book code from `\id`, when the file has a usable one. */
  book: string | null;
  /** The book's name as the file gives it (`\toc2`, `\h`, `\toc1`, `\mt`), else the standard English one. */
  name: string;
  chapters: UsfmChapter[];
  verseCount: number;
  /** Plain-word reasons the file cannot be published. Empty means it can. */
  errors: UsfmProblem[];
  /** Plain-word things worth a look that do not stop publishing. */
  warnings: UsfmProblem[];
}

const ENGLISH = new Map(BIBLE_BOOKS.map((b) => [usfmOf(b.itemId), b.label]));

/** The standard English name of a book code, or the code itself. */
export function englishBookName(book: string): string {
  return ENGLISH.get(book) ?? book;
}

const BOOK_SET = new Set<string>(USFM_BOOKS);
/** Files that are not a book of the Bible: front, back and helps matter. */
const NOT_A_BOOK = new Set(['FRT', 'BAK', 'INT', 'CNC', 'GLO', 'TDX', 'NDX', 'OTH', 'XXA', 'XXB', 'XXC', 'XXD', 'XXE', 'XXF', 'XXG']);

/** Remove character markers and notes from the text of a verse and tidy its spaces. */
export function cleanVerseText(raw: string): string {
  let s = raw;
  for (const m of SPAN_MARKERS) {
    // \f + \fr 1.1 \ft note \f*  (also \+f for nested use)
    s = s.replace(new RegExp(String.raw`\\\+?${m}\s[\s\S]*?\\\+?${m}\*`, 'g'), '');
  }
  // \w word|lemma="x"\w* keeps the word; every other attribute list after | is dropped.
  s = s.replace(/\\\+?([a-z]+)\d?\s([^\\]*?)\|[^\\]*?\\\+?\1\*/g, '$2');
  s = s.replace(/\\\+?[a-z]+\d*\*/g, '');
  s = s.replace(/\\\+?[a-z]+\d*(?=\s|$)/g, '');
  return s.replace(/~/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A book's file may be this big: the library keeps a document up to 4 MB and the book holds the file twice (text and verses). */
export const MAX_BOOK_BYTES = 1_800_000;
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3; }
  return n;
}

/** Lines that are headings and titles, not verse text; a verse or chapter marker later on the same line stays. */
const HEADING_LINE = /^\\(?:s\d?|ms\d?|mr|r|sr|rem|sts|d|mt\d?|imt\d?|is\d?|ip|ipi|im|imi|ili\d?|iot|io\d?|iq\d?|ib|ie|iex|imq|ipq|ipr|imte\d?|toc\d|h\d?|cl|cd|sp|lit|periph|usfm|ide|id)\b([^\n]*)$/gm;

/**
 * The text of a file with what is not verse words taken out: milestones
 * (`\zaln-s |x-strong="G1"\*`, `\ts\*`, `\qt-s |sid="q1"\*`, from aligned
 * unfoldingWord files), notes, and heading lines.
 */
function prepareBody(src: string): string {
  let s = src.replace(/\\z?[a-z]+-[se](?:\s[^\\]*)?\\\*/g, '').replace(/\\ts\\\*/g, '');
  for (const m of SPAN_MARKERS) s = s.replace(new RegExp(String.raw`\\\+?${m}\s(?:(?!\\[cv]\s)[\s\S])*?\\\+?${m}\*`, 'g'), ' ');
  return s.replace(HEADING_LINE, (_all, rest: string) => {
    const at = rest.search(/\\[cv]\s/);
    return at >= 0 ? rest.slice(at) : '';
  });
}

const MARKER_LINE = /^\\([a-z]+\d*)\*?(?:\s+(.*))?$/;

/** Read one USFM file. Never throws: every problem is in `errors` or `warnings`. */
export function checkUsfm(fileName: string, text: string): UsfmCheck {
  const out: UsfmCheck = { fileName, book: null, name: '', chapters: [], verseCount: 0, errors: [], warnings: [] };
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fail = (p: UsfmProblem) => out.errors.push(p);
  const warn = (p: UsfmProblem) => out.warnings.push(p);

  if (!src.trim()) { fail({ code: 'empty' }); return out; }
  if (utf8Bytes(src) > MAX_BOOK_BYTES) { fail({ code: 'tooBig' }); return out; }
  if (src.includes('\uFFFD')) fail({ code: 'brokenLetters' });
  if (!/^\s*\\[a-z]/.test(src) && !/\\id\s/.test(src)) { fail({ code: 'notUsfm' }); return out; }

  // ---- \id ----
  const idLine = src.split('\n').find((l) => /^\\id(\s|$)/.test(l.trim()));
  if (!idLine) fail({ code: 'noId' });
  else {
    const code = (idLine.trim().split(/\s+/)[1] ?? '').toUpperCase();
    if (!code) fail({ code: 'noCode' });
    else if (NOT_A_BOOK.has(code)) fail({ code: 'frontBack', book: code });
    else if (!BOOK_SET.has(code)) fail({ code: 'unknownCode', book: code });
    else out.book = code;
  }

  // ---- names from the header lines ----
  const names: Record<string, string> = {};
  for (const line of src.split('\n')) {
    const m = MARKER_LINE.exec(line.trim());
    if (m && ['h', 'toc1', 'toc2', 'toc3', 'mt', 'mt1'].includes(m[1]!)) names[m[1]!] ??= cleanVerseText(m[2] ?? '');
  }

  // ---- body: \c and \v are found anywhere in the text, not only at a line's start ("\q1 \v 1 ..." is common in poetry) ----
  const body = prepareBody(src);
  let chapter = 0;
  let current: UsfmChapter | null = null;
  let lastVerseEnd = 0;
  const seenChapters = new Set<number>();
  let strayVerse = false;
  let outOfOrder = 0;
  let emptyVerses = 0;
  let missingVerses = 0;
  const marks = [...body.matchAll(/\\([cv])[ \t\n]+(\S+)[ \t]*/g)];
  marks.forEach((m, i) => {
    const kind = m[1]!;
    const value = m[2]!;
    const stop = marks[i + 1]?.index ?? body.length;
    if (kind === 'c') {
      const n = /^\d+$/.test(value) ? Number(value) : 0;
      if (n < 1) { fail({ code: 'badChapter', text: value.slice(0, 20) }); current = null; return; }
      if (seenChapters.has(n)) fail({ code: 'chapterTwice', chapter: n });
      else if (n < chapter) warn({ code: 'chapterOrder', chapter: n, after: chapter });
      seenChapters.add(n);
      chapter = n;
      lastVerseEnd = 0;
      current = { chapter: n, verses: [] };
      out.chapters.push(current);
      return;
    }
    if (!current) { strayVerse = true; return; }
    const vm = /^(\d+)[a-z]?(?:[-\u2013\u2014](\d+)[a-z]?)?$/.exec(value);
    if (!vm) { fail({ code: 'badVerse', chapter, text: value.slice(0, 20) }); return; }
    const start = Number(vm[1]);
    const end = vm[2] ? Number(vm[2]) : start;
    if (end < start) { fail({ code: 'backward', chapter, start, end }); return; }
    if (start <= lastVerseEnd && lastVerseEnd > 0) outOfOrder++;
    else if (start > lastVerseEnd + 1 && lastVerseEnd > 0) missingVerses += start - lastVerseEnd - 1;
    lastVerseEnd = Math.max(lastVerseEnd, end);
    const text = cleanVerseText(body.slice(m.index! + m[0].length, stop));
    if (!text) emptyVerses++;
    current.verses.push([start, end, text]);
    out.verseCount++;
  });

  if (strayVerse) fail({ code: 'strayVerse' });
  if (!out.chapters.length) fail({ code: 'noChapters' });
  else if (out.verseCount === 0) fail({ code: 'noVerses' });
  if (outOfOrder) fail({ code: 'outOfOrder', count: outOfOrder });
  if (missingVerses) warn({ code: 'missingVerses', count: missingVerses });
  if (emptyVerses && out.verseCount) warn({ code: 'emptyVerses', count: emptyVerses });
  const gaps = out.chapters.flatMap((c, i) => (i > 0 && c.chapter !== out.chapters[i - 1]!.chapter + 1 ? [c.chapter] : []));
  if (gaps.length && !out.errors.some((e) => e.code === 'chapterTwice')) warn({ code: 'missingChapters', chapter: gaps[0]! });

  out.name = names['toc2'] || names['h'] || names['toc1'] || names['mt'] || names['mt1'] || (out.book ? englishBookName(out.book) : '');
  return out;
}

/** The checks of several files together: one book per file, no book twice. */
export function checkUsfmFiles(files: readonly { name: string; text: string }[]): UsfmCheck[] {
  // A file may hold several books (each starts at its own \\id): each becomes its own check.
  const checks = files.flatMap((f) => {
    const parts = f.text.split(/^(?=\\id[ \t])/m).filter((p) => p.trim());
    const books = parts.filter((p) => /^\\id[ \t]/.test(p));
    if (books.length < 2) return [checkUsfm(f.name, f.text)];
    return books.map((p) => checkUsfm(`${f.name} (${p.slice(4, 7).toUpperCase()})`, p));
  });
  const first = new Map<string, string>();
  for (const c of checks) {
    if (!c.book || c.errors.length) continue;
    const seen = first.get(c.book);
    if (seen) c.errors.push({ code: 'duplicateBook', book: c.book, other: seen });
    else first.set(c.book, c.fileName);
  }
  return checks;
}

/** A problem in English, for tests, logs and scripts; the app says it in the reader's language. */
export function usfmProblemText(p: UsfmProblem): string {
  switch (p.code) {
    case 'empty': return 'The file is empty.';
    case 'tooBig': return 'The file is too big for one book. Split it into smaller books.';
    case 'brokenLetters': return 'Some letters are broken. Save the file as UTF-8 text and upload it again.';
    case 'notUsfm': return 'This does not look like a USFM file. It has no backslash markers.';
    case 'noId': return 'The file has no \\id line, so we cannot tell which book it is.';
    case 'noCode': return 'The \\id line has no book code.';
    case 'strayVerse': return 'The file has verses before its first chapter.';
    case 'noChapters': return 'The file has no chapters.';
    case 'noVerses': return 'The file has chapters but no verses.';
    case 'frontBack': return `The book code ${p.book} is front or back matter, not a book of the Bible.`;
    case 'unknownCode': return `The book code ${p.book} is not one we know.`;
    case 'badChapter': return `A chapter line reads "\\c ${p.text}". A chapter needs a number.`;
    case 'chapterTwice': return `Chapter ${p.chapter} appears twice.`;
    case 'missingChapters': return `Chapters are missing before chapter ${p.chapter}.`;
    case 'chapterOrder': return `Chapter ${p.chapter} comes after chapter ${p.after}.`;
    case 'badVerse': return `In chapter ${p.chapter} a verse line reads "\\v ${p.text}". A verse needs a number.`;
    case 'backward': return `In chapter ${p.chapter}, verse range ${p.start}-${p.end} runs backward.`;
    case 'outOfOrder': return `${p.count} verse${p.count === 1 ? ' is' : 's are'} out of order or repeated inside a chapter.`;
    case 'missingVerses': return `${p.count} verse${p.count === 1 ? ' is' : 's are'} missing between the verses the file has.`;
    case 'emptyVerses': return `${p.count} verse${p.count === 1 ? ' has' : 's have'} no text.`;
    case 'duplicateBook': return `This is ${englishBookName(p.book)} again; ${p.other} already holds it.`;
  }
}
