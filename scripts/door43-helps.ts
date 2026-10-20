/**
 * Readers for Door43's translation helps (scripts/door43-seed.ts): notes,
 * questions and key-word links in their TSV and older markdown layouts,
 * key-word articles, manuals' articles, and finding the Hebrew or Greek
 * words a note quotes in a verse.
 *
 * Every reader gives rows of one shape, whatever the layout:
 * `{ id, ref, quote?, occurrence?, text, answer?, article?, support?, tags? }`,
 * where `ref` is a place in the book as core helpDocs.ts reads it.
 *
 * Pure: no I/O.
 */

export interface HelpRow {
  id: string;
  ref: string;
  quote?: string;
  occurrence?: number;
  /** The original words found for `quote` (`"Θεοῦ:2"`), when the verse's Hebrew or Greek was at hand. */
  words?: string[];
  /** The note, or the question. Markdown. */
  text: string;
  /** A question's answer. */
  answer?: string;
  /** A key word's article: `"kt/god"`. */
  article?: string;
  /** The manual's article a note cites: `"translate/figs-metaphor"`. */
  support?: string;
  tags?: string;
}

// ---- TSV ------------------------------------------------------------------------------------

/** One TSV field as written: `"quoted ""like this"""` fields unquoted, `\n` and `<br>` as line breaks. */
export function tsvField(raw: string): string {
  let s = raw;
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"');
  return s.replace(/\\n/g, '\n').replace(/<br\s*\/?>/gi, '\n').trim();
}

/** Rows by the header line's names. Blank lines are skipped; a short row gets empty fields. */
export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const header = (lines.shift() ?? '').split('\t').map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = tsvField(cells[i] ?? ''); });
    out.push(row);
  }
  return out;
}

const int = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s.trim());
  return Number.isInteger(n) ? n : undefined;
};

/** `"1"`, `"01"`, `"front"`, `"intro"` → the part of a ref they make. */
const part = (s: string) => (/^\d+$/.test(s) ? String(Number(s)) : s.toLowerCase());

/** A TSV's `Reference`, or the older `Chapter` and `Verse`, as a ref. */
function refOf(row: Record<string, string>): string | null {
  const r = row['Reference'];
  if (r !== undefined && r !== '') {
    const t = r.replace(/[–—]/g, '-').replace(/\s+/g, '');
    if (t === 'front') return 'front:intro';
    const m = /^(front|\d+):(.+)$/.exec(t);
    if (!m) return /^\d+$/.test(t) ? part(t) : null;
    // A list of verses ("2:3,5") is placed on its first.
    return `${part(m[1]!)}:${part(m[2]!.split(',')[0]!)}`;
  }
  const c = row['Chapter'];
  const v = row['Verse'];
  if (c === undefined || v === undefined || c === '') return null;
  return `${part(c)}:${part(v === '' ? 'intro' : v)}`;
}

const supportOf = (s: string | undefined): string | undefined => {
  if (!s) return undefined;
  const m = /ta\/man\/([^\]\s)]+)/.exec(s);
  if (m) return m[1];
  return /^[a-z0-9-]+\/[a-z0-9-]+$/i.test(s.trim()) ? s.trim() : s.trim() ? `translate/${s.trim()}` : undefined;
};

const articleOf = (s: string | undefined): string | undefined => {
  const m = /tw\/dict\/bible\/([a-z]+\/[^\s/]+?)(?:\.md)?$/i.exec(s?.trim() ?? '');
  return m ? m[1] : undefined;
};

/** A row without its empty fields. */
const withOptional = (row: Record<string, unknown>): HelpRow =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== '')) as unknown as HelpRow;

/** Translation Notes and story notes in TSV: the 7-column layout and the older 9-column one. */
export function tsvNotes(text: string): HelpRow[] {
  const out: HelpRow[] = [];
  for (const row of parseTsv(text)) {
    const ref = refOf(row);
    const note = row['Note'] ?? row['OccurrenceNote'] ?? '';
    if (!ref || !note) continue;
    out.push(withOptional({
      id: row['ID'] || `${ref}#${out.length}`,
      ref,
      quote: row['Quote'] ?? row['OrigQuote'],
      occurrence: int(row['Occurrence']),
      text: links(note),
      support: supportOf(row['SupportReference']),
      tags: row['Tags']
    }));
  }
  return out;
}

/** Translation Questions and story questions in TSV. Rows without a question (a guide's introduction) are left out. */
export function tsvQuestions(text: string): HelpRow[] {
  const out: HelpRow[] = [];
  for (const row of parseTsv(text)) {
    const ref = refOf(row);
    const question = row['Question'] ?? '';
    if (!ref || !question) continue;
    out.push(withOptional({
      id: row['ID'] || `${ref}#${out.length}`,
      ref,
      quote: row['Quote'],
      occurrence: int(row['Occurrence']),
      text: links(question),
      answer: links(row['Response'] ?? ''),
      tags: row['Tags']
    }));
  }
  return out;
}

/** Translation Words Links in TSV: each key word's place and its article. */
export function tsvWordLinks(text: string): HelpRow[] {
  const out: HelpRow[] = [];
  for (const row of parseTsv(text)) {
    const ref = refOf(row);
    const article = articleOf(row['TWLink']);
    if (!ref || !article) continue;
    out.push(withOptional({
      id: row['ID'] || `${ref}#${out.length}`,
      ref,
      quote: row['OrigWords'],
      occurrence: int(row['Occurrence']),
      text: '',
      article,
      tags: row['Tags']
    }));
  }
  return out;
}

// ---- markdown layouts --------------------------------------------------------------------------

/** `# heading` then its text, as pairs; text before the first heading is dropped. */
export function headingPairs(md: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^#\s+(.*)$/.exec(line);
    if (m) {
      if (current) out.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      current = { heading: m[1]!.trim(), lines: [] };
    } else current?.lines.push(line);
  }
  if (current) out.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  return out;
}

export interface SourceFile { path: string; text: string }

/**
 * Where an older markdown help sits: `<book>/<chapter>/<verse>.md`, with
 * or without a `content/` folder first, and the book left out for stories
 * (`content/<story>/<frame>.md`). `front` and `intro` read as introductions.
 */
function placeOfPath(path: string, stories: boolean): { book?: string; ref: string } | null {
  const parts = path.replace(/^content\//, '').replace(/\.(md|txt)$/, '').split('/');
  if (stories) {
    if (parts.length !== 2) return null;
    const [story, frame] = parts as [string, string];
    if (!/^\d+$/.test(story)) return null;
    if (frame === 'intro' || frame === 'title') return { ref: `${Number(story)}:0` };
    return /^\d+$/.test(frame) ? { ref: `${Number(story)}:${Number(frame)}` } : null;
  }
  if (parts.length !== 3) return null;
  const [book, chapter, verse] = parts as [string, string, string];
  if (!/^[a-z0-9]{3}$/i.test(book)) return null;
  const c = /^\d+$/.test(chapter) ? String(Number(chapter)) : chapter === 'front' ? 'front' : null;
  if (!c) return null;
  if (verse === 'intro') return { book: book.toUpperCase(), ref: `${c}:intro` };
  if (!/^\d+$/.test(verse) || c === 'front') return null;
  // A chapter's "00" file is its introduction.
  return { book: book.toUpperCase(), ref: Number(verse) === 0 ? `${c}:intro` : `${c}:${Number(verse)}` };
}

/**
 * Notes or questions in the older layout, one file per chunk or verse, as
 * rows by book. A note's heading is the words it is about (in the gateway
 * Bible); a question's heading is the question and its text the answer.
 * An introduction file is one note, its heading part of its text.
 */
export function markdownHelps(files: SourceFile[], kind: 'notes' | 'questions', opts: { stories?: boolean } = {}): Map<string, HelpRow[]> {
  const out = new Map<string, HelpRow[]>();
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const f of sorted) {
    const at = placeOfPath(f.path, !!opts.stories);
    if (!at) continue;
    const book = opts.stories ? 'OBS' : at.book!;
    const rows = out.get(book) ?? [];
    const intro = at.ref.endsWith(':intro') || at.ref.endsWith(':0');
    if (intro && kind === 'notes') {
      const text = links(f.text.trim());
      if (text) rows.push({ id: `${at.ref}#${rows.length}`, ref: at.ref, text });
    } else {
      for (const p of headingPairs(f.text)) {
        if (!p.heading) continue;
        rows.push(kind === 'notes'
          ? withOptional({ id: `${at.ref}#${rows.length}`, ref: at.ref, quote: p.heading, text: links(p.body) })
          : withOptional({ id: `${at.ref}#${rows.length}`, ref: at.ref, text: links(p.heading), answer: links(p.body) }));
      }
    }
    if (rows.length) out.set(book, rows);
  }
  return out;
}

/**
 * Study questions written one story to a file (`content/01.md`): numbered
 * questions, each followed by its answer, under headings. Placed on the
 * whole story.
 */
export function storyQuestionFiles(files: SourceFile[]): HelpRow[] {
  const out: HelpRow[] = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const m = /(?:^|\/)(\d+)\.md$/.exec(f.path);
    if (!m) continue;
    const story = String(Number(m[1]));
    let q: { text: string; answer: string[] } | null = null;
    const flush = () => {
      if (q && q.text) out.push(withOptional({ id: `${story}#${out.length}`, ref: story, text: links(q.text), answer: links(q.answer.join('\n').trim()) }));
      q = null;
    };
    for (const line of f.text.replace(/\r\n?/g, '\n').split('\n')) {
      const n = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (n) {
        flush();
        q = { text: n[1]!.trim(), answer: [] };
      } else if (/^#/.test(line)) flush();
      else q?.answer.push(line);
    }
    flush();
  }
  return out;
}

// ---- links ---------------------------------------------------------------------------------

/**
 * Door43's links in help text, as the app opens them: an Academy article
 * `ta:translate/figs-metaphor`, a key word `tw:kt/god`, a Bible place
 * `bible:1JN 1:7`. `[[rc://…/ta/man/translate/x]]` gets the article id as
 * its words. Pictures are left out; other links keep their words only.
 */
export function links(md: string): string {
  const target = (url: string): string | null => {
    const u = url.trim();
    let m = /ta\/man\/([a-z0-9-]+)\/([a-z0-9-]+)/i.exec(u);
    if (m) return `ta:${m[1]}/${m[2]}`;
    m = /tw\/dict\/bible\/([a-z]+)\/([a-z0-9-]+)/i.exec(u);
    if (m) return `tw:${m[1]}/${m[2]}`;
    m = /(?:^|\/)(kt|names|other)\/([a-z0-9-]+)\.md$/i.exec(u);
    if (m) return `tw:${m[1]}/${m[2]}`;
    m = /tn\/help\/([a-z0-9]{3})\/(\d+)\/(\d+)/i.exec(u);
    if (m) return `bible:${m[1]!.toUpperCase()} ${Number(m[2])}:${Number(m[3])}`;
    m = /^(?:\.\.\/)*\.\.\/([a-z0-9-]+)\/01\.md$/i.exec(u);
    if (m) return `ta:${m[1]}`;
    m = /^(?:\.\.\/)+([a-z0-9-]+)\/([a-z0-9-]+)\/01\.md$/i.exec(u);
    if (m) return `ta:${m[1]}/${m[2]}`;
    return null;
  };
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[(rc:\/\/[^\]]+)\]\]/g, (all, url: string) => {
      const t = target(url);
      return t ? `[${t.replace(/^[a-z]+:/, '')}](${t})` : '';
    })
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (all, words: string, url: string) => {
      const t = target(url);
      return t ? `[${words}](${t})` : words;
    })
    .trim();
}

// ---- articles -------------------------------------------------------------------------------

export interface Article { id: string; title: string; body: string; section?: string }

/** A key-word article (`bible/kt/god.md`): its first heading is its title (`# God`, `# Abraham, Abram`). */
export function wordArticle(path: string, md: string): Article | null {
  const m = /(?:^|\/)(kt|names|other)\/([^/]+)\.md$/.exec(path);
  if (!m) return null;
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => /^#\s+/.test(l));
  const title = first >= 0 ? lines[first]!.replace(/^#\s+/, '').trim() : m[2]!;
  const body = links(lines.slice(first + 1).join('\n'));
  return { id: `${m[1]}/${m[2]}`, title: title || m[2]!, body, section: m[1]! };
}

/** A manual's article from its folder (`translate/figs-metaphor/`): `title.md`, `sub-title.md` (a question it answers) and `01.md`. */
export function manualArticle(manual: string, slug: string, files: { title?: string | undefined; subTitle?: string | undefined; body?: string | undefined }): Article | null {
  const title = files.title?.trim();
  if (!title || files.body === undefined) return null;
  const sub = files.subTitle?.trim();
  const body = links(`${sub ? `*${sub}*\n\n` : ''}${files.body}`);
  return { id: `${manual}/${slug}`, title, body, section: manual };
}

/** A manual's `toc.yaml` (sections with `title`, `link`, nested `sections`) as article slugs in reading order. */
export function tocOrder(toc: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (typeof n['link'] === 'string' && !out.includes(n['link'])) out.push(n['link']);
    if (n['sections']) walk(n['sections']);
  };
  walk((toc as Record<string, unknown> | null)?.['sections'] ?? toc);
  return out;
}

// ---- finding quoted words ---------------------------------------------------------------------

/** A word as compared: no cantillation, punctuation, word joiners or maqaf, in NFC. */
export function wordKey(w: string): string {
  return w.normalize('NFC')
    .replace(/[֑-ֽֿ֯׀׃׆⁠‌‍]/g, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

/**
 * The original words a note or key word quotes, in a verse whose words
 * are `verse` (in order): `"Θεοῦ:2"`, counting each exact word as the
 * alignment does. A quote may have parts joined by `&`; `occurrence` is
 * which time its first part occurs, and each later part is the next match
 * after the one before. Null when the words are not all found.
 */
export function findQuote(quote: string, occurrence: number, verse: string[]): string[] | null {
  const tokens = (s: string) => s.split(/[\s־]+/).map(wordKey).filter(Boolean);
  const parts = quote.split(/\s*&\s*|\s*…\s*/).map(tokens).filter((p) => p.length);
  if (!parts.length || verse.length === 0) return null;
  const keys = verse.map(wordKey);
  // Hebrew joins a word and its prefixes with a maqaf or a word joiner; the quote may write them as one word or two.
  const matchAt = (p: string[], at: number): number => {
    let i = at;
    for (const t of p) {
      if (i >= keys.length) return -1;
      if (keys[i] === t) { i++; continue; }
      // the quote writes as one word what the verse has as several
      let joined = '';
      let j = i;
      while (j < keys.length && joined.length < t.length) joined += keys[j++];
      if (joined === t) { i = j; continue; }
      return -1;
    }
    return i;
  };
  const want = Math.max(1, occurrence);
  let found = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < keys.length; i++) {
    const e = matchAt(parts[0]!, i);
    if (e > i && ++found === want) { start = i; end = e; break; }
  }
  if (start < 0) return null;
  const indexes: number[] = [];
  for (let i = start; i < end; i++) indexes.push(i);
  let from = end;
  for (const p of parts.slice(1)) {
    let hit = -1;
    for (let i = from; i < keys.length && hit < 0; i++) {
      const e = matchAt(p, i);
      if (e > i) { hit = i; for (let k = i; k < e; k++) indexes.push(k); from = e; }
    }
    if (hit < 0) return null;
  }
  const seen = new Map<string, number>();
  const occ = verse.map((w) => {
    const n = (seen.get(w) ?? 0) + 1;
    seen.set(w, n);
    return n;
  });
  return indexes.map((i) => `${verse[i]}:${occ[i]}`);
}
