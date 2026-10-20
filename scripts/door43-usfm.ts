/**
 * A USFM reader for Door43's Bibles (scripts/door43-seed.ts): verse text
 * with every marker taken out, and, for word-aligned Bibles (unfoldingWord's
 * ULT and UST and the gateway Bibles made from them), which words of each
 * verse stand for which Hebrew or Greek words.
 *
 * Aligned USFM wraps each word in `\w word|attrs\w*` and each group of
 * words in `\zaln-s |x-content="Θεοῦ" x-occurrence="2" …\*` … `\zaln-e\*`
 * milestones, nested when several original words share the same words.
 * The text is the words and punctuation as written, with every run of
 * spaces and line breaks made one space. Footnotes, cross references,
 * headings, introductions and chunk marks are left out. A psalm's title
 * (`\d`) is the chapter's verse 0.
 *
 * Pure: no I/O.
 */

export interface UsfmVerse {
  verse: number;
  /** The last verse of a bridge (`\v 4-5`), else `verse`. */
  end: number;
  text: string;
  /** Where each word sits in `text`: `[start, end)`. Only words written as `\w`. */
  words: [number, number][];
  /** Original words (`"Θεοῦ:2"`) and the indexes in `words` that translate them. */
  groups: [string[], number[]][];
}

export interface UsfmBook {
  /** USFM code from `\id`. */
  book: string;
  /** `\h`, else `\toc2`, else `\toc1`. */
  name?: string;
  chapters: { chapter: number; verses: UsfmVerse[] }[];
}

/** Lines whose text is not the Bible's: headers, titles, headings, introductions, labels. Their whole line is left out. */
const LINE_SKIPPED = /^(id|usfm|ide|h\d?|toc\d|toca\d|mt\d?|mte\d?|ms\d?|mr|s\d?|sr|r|sp|cl|cd|rem|sts|restore|qa|i[a-z]*\d?|periph)$/;
/** Notes and figures: everything up to their closing marker is left out. */
const SPAN_SKIPPED = new Set(['f', 'fe', 'x', 'fig', 'ef', 'ex', 'rq']);
/** Paragraphs and poetry lines: a break between words, so a space. Every other marker is a character style, and its words run on. */
const PARAGRAPH = /^(p|m|pi\d?|q\d?|b|nb|pc|pm|pmo|pmc|pmr|mi|li\d?|lh|lf|qr|qc|qm\d?|qd|po|pr|cls|ph\d?|tr|tc\d|th\d|tcr\d|thr\d)$/;

interface Group { key: string; words: number[] }

const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|[\\s|])${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
};

/** Read one book of USFM. Throws only when there is no `\id`. */
export function parseUsfm(source: string): UsfmBook {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const idMatch = /\\id\s+([A-Z0-9]{3})/.exec(text);
  if (!idMatch) throw new Error('USFM without an \\id line');
  const book: UsfmBook = { book: idMatch[1]!, chapters: [] };
  const header = (m: string) => new RegExp(`\\\\${m}\\s+([^\\n\\\\]+)`).exec(text)?.[1]?.trim();
  const name = header('h') ?? header('toc2') ?? header('toc1');
  if (name) book.name = name;

  let chapter: { chapter: number; verses: UsfmVerse[] } | null = null;
  let verse: UsfmVerse | null = null;
  let groups = new Map<string, Group>();
  let pendingSpace = false;
  /** Open `\zaln-s` milestones, outermost first. */
  const aligned: string[] = [];
  let skipLine = false;
  let skipSpan: string | null = null;

  const close = () => {
    if (!verse || !chapter) return;
    verse.text = verse.text.trimEnd();
    verse.groups = [...groups.values()].map((g) => [g.key.split('\u0001'), g.words]);
    if (verse.text || verse.verse > 0) chapter.verses.push(verse);
    verse = null;
    groups = new Map();
  };
  const open = (n: number, end: number) => {
    close();
    verse = { verse: n, end, text: '', words: [], groups: [] };
    pendingSpace = false;
  };
  const put = (s: string, isWord: boolean) => {
    if (!verse || skipLine || skipSpan) return;
    if (!s) return;
    if (pendingSpace && verse.text.length > 0) verse.text += ' ';
    pendingSpace = false;
    const start = verse.text.length;
    verse.text += s;
    if (!isWord) return;
    const index = verse.words.length;
    verse.words.push([start, verse.text.length]);
    if (aligned.length) {
      const key = aligned.join('\u0001');
      const g = groups.get(key) ?? { key, words: [] };
      g.words.push(index);
      groups.set(key, g);
    }
  };
  const plain = (s: string) => {
    if (skipLine || skipSpan || !verse) return;
    const parts = s.split(/(\s+)/);
    for (const p of parts) {
      if (!p) continue;
      if (/^\s+$/.test(p)) pendingSpace = true;
      else put(p, false);
    }
  };

  const marker = /\\(\+?)([a-z][a-z0-9]*(?:-[se])?)(\*)?/g;
  let i = 0;
  while (i < text.length) {
    marker.lastIndex = i;
    const m = marker.exec(text);
    const next = m ? m.index : text.length;
    if (next > i) {
      const chunk = text.slice(i, next);
      // A skipped line ends at its line break.
      if (skipLine) {
        const nl = chunk.indexOf('\n');
        if (nl >= 0) {
          skipLine = false;
          plain(chunk.slice(nl));
        }
      } else plain(chunk);
    }
    if (!m) break;
    i = marker.lastIndex;
    const tag = m[2]!;
    const closing = !!m[3];

    if (skipSpan) {
      if (closing && tag === skipSpan) skipSpan = null;
      continue;
    }
    if (closing) continue; // the end of a character style: its words stay
    if (tag === 'c') {
      const n = /^\s+(\d+)/.exec(text.slice(i));
      if (!n) continue;
      i += n[0].length;
      close();
      chapter = { chapter: Number(n[1]), verses: [] };
      book.chapters.push(chapter);
      skipLine = false;
      continue;
    }
    if (tag === 'v') {
      const n = /^\s+(\d+)(?:[-–](\d+))?[a-z]?\s?/.exec(text.slice(i));
      if (!n || !chapter) continue;
      i += n[0].length;
      skipLine = false;
      open(Number(n[1]), n[2] ? Number(n[2]) : Number(n[1]));
      continue;
    }
    if (tag === 'd') {
      // A psalm's title: the text before verse 1, kept as verse 0.
      if (chapter && !verse) open(0, 0);
      continue;
    }
    if (tag === 'w') {
      const end = text.indexOf('\\', i);
      const body = text.slice(i, end < 0 ? text.length : end);
      const word = body.split('|')[0]!.trim();
      put(word, true);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (tag === 'zaln-s') {
      const end = text.indexOf('\\*', i);
      const attrs = text.slice(i, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end + 2;
      const content = attr(attrs, 'x-content');
      const occ = attr(attrs, 'x-occurrence');
      aligned.push(`${content ?? ''}:${occ ?? '1'}`);
      continue;
    }
    if (tag === 'zaln-e') {
      aligned.pop();
      if (text.startsWith('\\*', i)) i += 2;
      continue;
    }
    if (tag === 'k-s' || tag === 'k-e' || tag === 'ts' || tag.endsWith('-s') || tag.endsWith('-e')) {
      // Milestones carry no text.
      const end = text.indexOf('\\*', i);
      const nl = text.indexOf('\n', i);
      if (end >= 0 && (nl < 0 || end < nl)) i = end + 2;
      continue;
    }
    if (SPAN_SKIPPED.has(tag)) {
      skipSpan = tag;
      continue;
    }
    if (LINE_SKIPPED.test(tag)) {
      skipLine = true;
      continue;
    }
    if (PARAGRAPH.test(tag)) pendingSpace = true;
  }
  close();
  return book;
}

/** The words of a verse's text that `\w` marked, in order. */
export function verseWords(v: Pick<UsfmVerse, 'text' | 'words'>): string[] {
  return v.words.map(([s, e]) => v.text.slice(s, e));
}
