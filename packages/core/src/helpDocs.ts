/**
 * Translation helps as library documents: notes, questions and key-word
 * links placed on verses (or a story's frames), the word alignment of one
 * Bible book to the Hebrew or Greek, and the contents of a set of articles
 * (key words, a translation manual, a grammar, stories).
 *
 * Notes, questions and key-word links share one shape: a set is one
 * library item whose version is a `helps@1` listing its books, the way a
 * `source@1` lists its `sourceBook@1`s, and each book is a `helpBook@1` of
 * rows placed by coordinates. A phone reads the index, then fetches only
 * the book a passage needs, by its hash (`loadDocs`). A question's id is
 * stable across versions (the set's item, the book and the row's own id),
 * since answers are recorded against it.
 *
 * Places inside a book (`ref`): `"3:16"`, `"3:16-18"`, `"3:1-4:2"`, a
 * chapter's introduction `"3:intro"`, the book's `"front:intro"`, a whole
 * chapter `"3"`. In Open Bible Stories the chapter is the story and the
 * verse the frame (`"1:3"`), and `"1:0"` is the story's title.
 *
 * Pure: shapes and validation, like libraryDocs.ts.
 */

/** One note, question or key word, on one place in a book. */
export interface HelpRow {
  /** The publisher's id for the row (stable across their versions), else one made from its place. */
  id: string;
  ref: string;
  /** The words it is about, as the publisher wrote them (Hebrew or Greek; a gateway Bible's words in older sets). */
  quote?: string;
  /** Which time those words occur in the verse, from 1. */
  occurrence?: number;
  /** The Hebrew or Greek words it is about, found in the verse when it was converted: `"Θεοῦ:2"` is the second Θεοῦ. */
  words?: string[];
  /** A note's text, or a question. Markdown; links are `ta:<manual>/<article>`, `tw:<section>/<word>`, `bible:<BOOK> <c>:<v>`. */
  text: string;
  /** A question's answer: what someone who understood the passage would say. */
  answer?: string;
  /** A key word's article in a key-word set (`contents@1` kind `words`): `"kt/god"`. */
  article?: string;
  /** The manual's article a note cites: `"translate/figs-metaphor"`. */
  support?: string;
  tags?: string;
}

/** One book of a set of helps. */
export interface HelpBookDoc {
  format: 'helpBook@1';
  /** USFM code, or `OBS`. */
  book: string;
  rows: HelpRow[];
  deps: string[];
}

export type HelpsKind = 'notes' | 'questions' | 'wordLinks';
export const HELPS_KINDS: readonly HelpsKind[] = ['notes', 'questions', 'wordLinks'];

/**
 * A set of notes, questions or key-word links, book by book. Places are in
 * `versification` for a Bible, or are a story and frame of the outline
 * template `template` (a library item id) for stories.
 */
export interface HelpsDoc {
  format: 'helps@1';
  kind: HelpsKind;
  title: string;
  /** ISO 639-3. */
  language: string;
  description?: string;
  /** A license id (license.ts). */
  license: string;
  credit: string;
  versification?: string;
  template?: string;
  /**
   * Each book's document, or a big book in parts by chapter (`chapters`,
   * first and last, the book's introduction with its first part), so a
   * phone fetches only the chapters a passage is in.
   */
  books: { book: string; doc: string; chapters?: [number, number] }[];
  deps: string[];
}

/**
 * Which words of one Bible book stand for which Hebrew or Greek words. Per
 * verse, `words` are where each word sits in that verse's text in `text`
 * (`[start, end)` in UTF-16 code units, as JavaScript strings count), and
 * each group joins original words (`"Θεοῦ:2"`) to the indexes of the words
 * that translate them. A `source@1` names each book's alignment beside its
 * text (`books[].alignment`).
 */
export interface AlignmentDoc {
  format: 'alignment@1';
  book: string;
  /** The `sourceBook@1` whose verse texts the spans are in. */
  text: string;
  /** ISO 639-3 of the original words: `hbo`, `grc`. */
  original: string;
  chapters: { chapter: number; verses: { verse: number; words: [number, number][]; groups: [string[], number[]][] }[] }[];
  deps: string[];
}

export type ContentsKind = 'words' | 'academy' | 'grammar' | 'stories';
export const CONTENTS_KINDS: readonly ContentsKind[] = ['words', 'academy', 'grammar', 'stories'];

/**
 * A set of articles, each its own document fetched when someone opens it:
 * key words, a translation manual or a grammar (`material@1` kind
 * `document`), or stories placed on an outline template (`study@2`, the
 * entry's id the template's node).
 */
export interface ContentsDoc {
  format: 'contents@1';
  kind: ContentsKind;
  title: string;
  language: string;
  description?: string;
  license: string;
  credit: string;
  /** For stories: the outline template (library item id) whose nodes the entries are. */
  template?: string;
  entries: { id: string; title: string; doc: string; section?: string }[];
  deps: string[];
}

export type HelpDoc = HelpBookDoc | HelpsDoc | AlignmentDoc | ContentsDoc;

export const HELP_FORMATS = ['helpBook@1', 'helps@1', 'alignment@1', 'contents@1'] as const;

// ---- places -------------------------------------------------------------------------

/** A help's place, read: a verse range, an introduction, or a whole chapter. */
export type HelpPlace =
  | { kind: 'verses'; chapter: number; verse: number; endChapter: number; endVerse: number }
  | { kind: 'intro'; chapter: number | 'front' }
  | { kind: 'chapter'; chapter: number };

const PLACE = /^(?:(front):intro|(\d+):intro|(\d+)|(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?)$/;

/** Where a help's `ref` points, or null when it does not read. En dashes read as hyphens. */
export function helpPlace(ref: string): HelpPlace | null {
  const m = PLACE.exec(ref.trim().replace(/[–—]/g, '-'));
  if (!m) return null;
  if (m[1]) return { kind: 'intro', chapter: 'front' };
  if (m[2]) return { kind: 'intro', chapter: Number(m[2]) };
  if (m[3]) return { kind: 'chapter', chapter: Number(m[3]) };
  const chapter = Number(m[4]);
  const verse = Number(m[5]);
  const endChapter = m[6] ? Number(m[6]) : chapter;
  const endVerse = m[7] ? Number(m[7]) : verse;
  if (endChapter < chapter || (endChapter === chapter && endVerse < verse)) return null;
  return { kind: 'verses', chapter, verse, endChapter, endVerse };
}

// ---- validation ----------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string' && v !== '';
const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const isHash = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const BOOK = /^[A-Z0-9]{3}$/;
const wordsOk = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((w) => typeof w === 'string' && /^.+:\d+$/.test(w)));

function rowError(r: unknown): string | null {
  if (!isObj(r) || !str(r['id']) || typeof r['ref'] !== 'string' || !helpPlace(r['ref'])) return 'rows need an id and a place that reads';
  if (typeof r['text'] !== 'string') return 'rows need their text';
  if (!optStr(r['quote']) || !optStr(r['answer']) || !optStr(r['article']) || !optStr(r['support']) || !optStr(r['tags'])) return 'row fields are text';
  if (r['occurrence'] !== undefined && !Number.isInteger(r['occurrence'])) return 'occurrence is a whole number';
  if (!wordsOk(r['words'])) return 'words are "word:occurrence"';
  return null;
}

/** Why a help document is not valid, or null; undefined when it is not a help format at all. */
export function helpDocError(d: Record<string, unknown>): string | null | undefined {
  switch (d['format']) {
    case 'helpBook@1': {
      if (!BOOK.test(String(d['book']))) return 'a book of helps names its book';
      if (!Array.isArray(d['rows'])) return 'rows must be an array';
      const ids = new Set<string>();
      for (const r of d['rows'] as unknown[]) {
        const e = rowError(r);
        if (e) return e;
        const id = (r as { id: string }).id;
        if (ids.has(id)) return `row ${id} is repeated`;
        ids.add(id);
      }
      return null;
    }
    case 'alignment@1': {
      if (!BOOK.test(String(d['book']))) return 'an alignment names its book';
      if (!isHash(d['text']) || !str(d['original'])) return 'an alignment names its text and the language it is aligned to';
      if (!Array.isArray(d['chapters'])) return 'chapters must be an array';
      for (const c of d['chapters'] as unknown[]) {
        if (!isObj(c) || !Number.isInteger(c['chapter']) || !Array.isArray(c['verses'])) return 'chapters need a number and verses';
        for (const v of c['verses'] as unknown[]) {
          if (!isObj(v) || !Number.isInteger(v['verse']) || !Array.isArray(v['words']) || !Array.isArray(v['groups'])) return 'verses need a number, words and groups';
          const words = v['words'] as unknown[];
          if (!words.every((w) => Array.isArray(w) && w.length === 2 && Number.isInteger(w[0]) && Number.isInteger(w[1]) && (w[0] as number) <= (w[1] as number))) return 'words are [start, end]';
          for (const g of v['groups'] as unknown[]) {
            if (!Array.isArray(g) || g.length !== 2 || !wordsOk(g[0]) || !Array.isArray(g[1]) ||
              !(g[1] as unknown[]).every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < words.length)) return 'groups join original words to word indexes';
          }
        }
      }
      return null;
    }
    case 'helps@1': {
      if (!(HELPS_KINDS as readonly unknown[]).includes(d['kind'])) return 'kind must be notes, questions or wordLinks';
      if (!str(d['title']) || !str(d['language'])) return 'a set needs a title and a language';
      if (!str(d['license']) || !str(d['credit'])) return 'a set needs its license and credit';
      if (!optStr(d['description'])) return 'description must be text';
      if ((d['versification'] === undefined) === (d['template'] === undefined)) return 'a set is placed by a versification or a template, not both';
      if (d['versification'] !== undefined && !isHash(d['versification'])) return 'versification must be a hash';
      if (d['template'] !== undefined && !str(d['template'])) return 'template must be an item id';
      if (!Array.isArray(d['books'])) return 'books must be listed';
      const parts = new Map<string, ([number, number] | null)[]>();
      for (const b of d['books'] as unknown[]) {
        if (!isObj(b) || !BOOK.test(String(b['book'])) || !isHash(b['doc'])) return 'books need a USFM code and a document';
        const c = b['chapters'];
        if (c !== undefined && !(Array.isArray(c) && c.length === 2 && c.every((n) => Number.isInteger(n) && n >= 0) && (c[0] as number) <= (c[1] as number))) return 'chapters are [first, last]';
        const list = parts.get(b['book'] as string) ?? [];
        const mine = (c as [number, number] | undefined) ?? null;
        if (list.some((o) => !o || !mine || (o[0] <= mine[1] && mine[0] <= o[1]))) return `book ${String(b['book'])} is listed twice`;
        parts.set(b['book'] as string, [...list, mine]);
      }
      return null;
    }
    case 'contents@1': {
      if (!(CONTENTS_KINDS as readonly unknown[]).includes(d['kind'])) return 'kind must be words, academy, grammar or stories';
      if (!str(d['title']) || !str(d['language'])) return 'contents need a title and a language';
      if (!str(d['license']) || !str(d['credit'])) return 'contents need their license and credit';
      if (!optStr(d['description']) || !optStr(d['template'])) return 'description and template must be text';
      if (d['kind'] === 'stories' && !str(d['template'])) return 'stories name their template';
      if (!Array.isArray(d['entries'])) return 'entries must be listed';
      const seen = new Set<string>();
      for (const e of d['entries'] as unknown[]) {
        if (!isObj(e) || !str(e['id']) || !str(e['title']) || !isHash(e['doc']) || !optStr(e['section'])) return 'entries need an id, a title and a document';
        if (seen.has(e['id'] as string)) return `entry ${String(e['id'])} is listed twice`;
        seen.add(e['id'] as string);
      }
      return null;
    }
    default:
      return undefined;
  }
}

/** Every hash a help document refers to (what its `deps` lists). */
export function helpReferencedDocs(doc: HelpDoc): string[] {
  switch (doc.format) {
    case 'alignment@1': return [doc.text];
    case 'helps@1': return [...(doc.versification ? [doc.versification] : []), ...doc.books.map((b) => b.doc)];
    case 'contents@1': return doc.entries.map((e) => e.doc);
    default: return [];
  }
}

/**
 * The documents of a set a passage needs: its book's, or the parts whose
 * chapters it is in (the book's first part too when it starts at the
 * book's beginning, for the introduction).
 */
export function helpBookDocs(set: HelpsDoc, book: string, chapters: [number, number]): string[] {
  return set.books.filter((b) => b.book === book && (!b.chapters || (b.chapters[0] <= chapters[1] && chapters[0] <= b.chapters[1]))).map((b) => b.doc);
}

/** A question's id in a review's answers: stable across the set's versions. */
export const helpQuestionId = (itemId: string, book: string, rowId: string) => `${itemId}/${book}/${rowId}`;
