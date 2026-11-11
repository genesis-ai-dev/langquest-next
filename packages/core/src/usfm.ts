import { BIBLE_BOOKS } from './catalogData';
import { readUsfm, usfmPlainText } from './usfmRead';
import { USFM_BOOKS, usfmOf } from './versification';

/**
 * Checking one USFM file (decision 208, docs/reference-material.md): what an
 * admin sees before a Bible is published as organization reference material.
 * Pure: text in, a book and what is wrong with it out.
 *
 * Only the words of each verse are kept in the check's result; the file's own
 * text travels with the book (`usfmBook@1.usfm`), and `usfmRead.ts`, which this
 * walks with, reads its paragraphs, headings and notes for the reader.
 */

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
  | { code: 'outOfOrder' | 'emptyVerses'; count: number }
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
export const cleanVerseText = usfmPlainText;

/** A book's file may be this big: the library keeps a document up to 4 MB and the book holds the file twice (text and verses). */
export const MAX_BOOK_BYTES = 1_800_000;
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3; }
  return n;
}

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

  // ---- body ----
  const read = readUsfm(src);
  let strayVerse = false;
  let outOfOrder = 0;
  for (const p of read.problems) {
    switch (p.code) {
      case 'strayVerse': strayVerse = true; break;
      case 'outOfOrder': outOfOrder++; break;
      case 'chapterOrder': warn({ code: 'chapterOrder', chapter: p.chapter, after: p.after }); break;
      default: fail(p);
    }
  }
  out.chapters = read.chapters.map((c) => ({ chapter: c.chapter, verses: c.verses.map((v): [number, number, string] => [v.start, v.end, v.text]) }));
  out.verseCount = read.chapters.reduce((n, c) => n + c.verses.length, 0);
  const emptyVerses = read.chapters.reduce((n, c) => n + c.verses.filter((v) => !v.text).length, 0);
  const names = read.names;

  if (strayVerse) fail({ code: 'strayVerse' });
  if (!out.chapters.length) fail({ code: 'noChapters' });
  else if (out.verseCount === 0) fail({ code: 'noVerses' });
  if (outOfOrder) fail({ code: 'outOfOrder', count: outOfOrder });
  if (emptyVerses && out.verseCount) warn({ code: 'emptyVerses', count: emptyVerses });
  const gaps = out.chapters.flatMap((c, i) => (i > 0 && c.chapter !== out.chapters[i - 1]!.chapter + 1 ? [c.chapter] : []));
  if (gaps.length && !out.errors.some((e) => e.code === 'chapterTwice')) warn({ code: 'missingChapters', chapter: gaps[0]! });

  out.name = names['toc2'] || names['h'] || names['toc1'] || names['mt'] || names['mt1'] || (out.book ? englishBookName(out.book) : '');
  return out;
}

/** The checks of several files together: one book per file, no book twice. */
export function checkUsfmFiles(files: readonly { name: string; text: string }[]): UsfmCheck[] {
  const checks = files.map((f) => checkUsfm(f.name, f.text));
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
    case 'emptyVerses': return `${p.count} verse${p.count === 1 ? ' has' : 's have'} no text.`;
    case 'duplicateBook': return `This is ${englishBookName(p.book)} again; ${p.other} already holds it.`;
  }
}
