/**
 * unfoldingWord's published material from Door43, built into LangQuest's
 * library (`npm run library:seed -- --door43 [--dry-run] [--share-door43]`).
 *
 * Reads the catalog's published releases (stage `prod`, never a branch),
 * chooses what LangQuest takes (door43-catalog.ts), downloads each release's
 * zipball once into the OS temp directory, and turns it into documents:
 * Bibles as `source@1` with a `sourceBook@1` and, where the Bible is
 * word-aligned, an alignment per book; notes, questions and key-word links
 * book by book; key words, manuals and grammars as articles with a contents
 * list; Open Bible Stories as an outline template and each language's
 * stories placed on it. Each published release is one library item of the
 * LangQuest organization, unshared until unfoldingWord's written OK
 * (`--share-door43` shares them).
 *
 * A dry run builds every document without storing any, and reports how
 * many there are and how big, by resource and language.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { bookOrder, canonicalJson, USFM_BOOKS, validateDoc, verseToOrg, type VersificationDoc } from '@langquest-next/core';
import {
  abbreviationOf, CATALOG_URL, catalogEntry, choose, creditOf, itemIdOf, itemName, languageLabel, licenseOf, plainTitle, publisherName,
  ROLE_NAMES, type CatalogEntry, type Choice, type Role
} from './door43-catalog';
import { findQuote, manualArticle, markdownHelps, storyQuestionFiles, tocOrder, tsvNotes, tsvQuestions, tsvWordLinks, wordArticle, type Article, type HelpRow, type SourceFile } from './door43-helps';
import { folderStories, formationStory, markdownStory, rstTitle, rstToctree, rstToMarkdown, type Story } from './door43-reading';
import { checkingFlow, checkingManual, formQuestions, withFlowLanguage, type CheckId, type CheckingManual, type FlowHelps } from './door43-flows';
import { parseUsfm, verseWords } from './door43-usfm';
import { readZip } from './door43-zip';

/** The outline template every language's stories are placed on. */
export const OBS_TEMPLATE_ID = 'langquest.door43.obs';
/** Door43's pictures for the stories: Sweet Publishing's, under their own license. */
export const OBS_PICTURE_CREDIT = 'Pictures © Sweet Publishing (www.sweetpublishing.com), CC BY-SA 3.0, from Door43.';
const PICTURE_SIZES = { phone: '360px', full: '2160px' } as const;

type Taken = Extract<Choice, { role: Role }>;

export interface BuiltItem {
  itemId: string;
  name: string;
  description: string;
  docHash: string;
  role: Role;
  language: string;
  publisher: string;
  entry: string;
}

/** Where documents go: counted (a dry run), or also kept on disk for publishing. */
export interface DocSink {
  put(doc: Record<string, unknown>): string;
}

/** A sink that only names and counts documents, each once. */
export function countingSink(): DocSink & { unique: { docs: number; bytes: number } } {
  const seen = new Set<string>();
  const unique = { docs: 0, bytes: 0 };
  return {
    unique,
    put(doc) {
      const text = canonicalJson(doc);
      const hash = hashOf(text);
      if (!seen.has(hash)) { seen.add(hash); unique.docs++; unique.bytes += Buffer.byteLength(text); }
      return hash;
    }
  };
}

/**
 * A sink that keeps each document on disk by its hash (`<dir>/<hash>.json`),
 * in the order they were made, which puts every document after the ones it
 * depends on: the order the server needs them in.
 */
export function diskSink(dir: string): DocSink & { order: string[]; unique: { docs: number; bytes: number } } {
  mkdirSync(dir, { recursive: true });
  const seen = new Set<string>();
  const order: string[] = [];
  const unique = { docs: 0, bytes: 0 };
  return {
    order,
    unique,
    put(doc) {
      const text = canonicalJson(doc);
      const hash = hashOf(text);
      if (!seen.has(hash)) {
        seen.add(hash);
        order.push(hash);
        unique.docs++;
        unique.bytes += Buffer.byteLength(text);
        const file = join(dir, `${hash}.json`);
        if (!existsSync(file)) writeFileSync(file, text);
      }
      return hash;
    }
  };
}


interface Stats { docs: number; bytes: number; largest: number }

export interface BuildReport {
  items: (BuiltItem & Stats & { zipBytes: number; kind?: 'flow' })[];
  /** Flows whose checks took a name from the English manual, since their own manual has no article for it. */
  flowsFromEnglish: { item: string; checks: CheckId[] }[];
  skipped: { entry: string; subject: string; reason: string }[];
  pictures: { count: number; phoneBytes: number; fullBytes: number };
  /** Door43's addresses of the story pictures the stories use, at phone size. */
  pictureUrls: string[];
  formationPictures: { count: number; bytes: number };
}

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

// ---- downloads ------------------------------------------------------------------------------------

const CACHE = join(tmpdir(), 'langquest-door43');
/** Where a real build keeps its documents between building and publishing. */
export const DOC_DIR = join(CACHE, 'docs');

async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < 3) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
      return res;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/** Every published entry of the catalog, page by page. */
export async function fetchCatalog(log: (m: string) => void): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  for (let page = 1; page < 100; page++) {
    const res = await fetchRetry(`${CATALOG_URL}?stage=prod&limit=100&page=${page}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`catalog page ${page}: ${res.status}`);
    const rows = ((await res.json()) as { data?: Record<string, unknown>[] }).data ?? [];
    out.push(...rows.map(catalogEntry));
    if (rows.length < 100) break;
  }
  log(`door43: ${out.length} published entries in the catalog`);
  return out;
}

/** A release's zipball, downloaded once into the OS temp directory. */
async function zipOf(e: CatalogEntry): Promise<string> {
  const dir = join(CACHE, 'zips', e.owner);
  const file = join(dir, `${e.name}@${e.tag}.zip`);
  if (existsSync(file) && statSync(file).size > 0) return file;
  if (!/^https:\/\/git\.door43\.org\/[^/]+\/[^/]+\/archive\/[^/]+\.zip$/.test(e.zipball)) throw new Error(`${e.owner}/${e.name}: not a release zipball (${e.zipball})`);
  const res = await fetchRetry(e.zipball);
  if (!res.ok) throw new Error(`${e.owner}/${e.name}@${e.tag}: ${res.status}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${file}.part`, file);
  return file;
}

// ---- building -----------------------------------------------------------------------------------

/** The Hebrew and Greek words of each verse (`GEN` → `1:1` → words), from the originals, for finding quotes. */
type Originals = Map<string, Map<string, string[]>>;

interface Ctx {
  sink: DocSink;
  versifications: { eng: string; org: string; engDoc: VersificationDoc };
  originals: Originals;
  log: (m: string) => void;
  stats: Stats;
  /** Picture URL → its hashes, filled when pictures are fetched; empty in a dry run. */
  pictures: Map<string, { hash?: string; lowHash?: string }>;
  /** The largest document of the item being built. */
  itemLargest: number;
}

const put = (ctx: Ctx, doc: Record<string, unknown>) => {
  // Every document is checked as phones and the server check it, in a dry run too.
  const invalid = validateDoc(doc);
  if (invalid) throw new Error(`a ${String(doc['format'])} that is not valid: ${invalid}`);
  const text = canonicalJson(doc);
  const bytes = Buffer.byteLength(text);
  ctx.stats.docs++;
  ctx.stats.bytes += bytes;
  ctx.itemLargest = Math.max(ctx.itemLargest, bytes);
  if (bytes > MAX_DOC) throw new Error(`a ${String(doc['format'])} of ${(bytes / 1048576).toFixed(1)} MB is over the server's 4 MB`);
  return ctx.sink.put(doc);
};

/** The server's limit on one document (`_library_store`). */
const MAX_DOC = 4 * 1024 * 1024;

interface Release {
  /** Paths inside the release's top folder. */
  files: string[];
  read: (p: string) => string | undefined;
  bytes: (p: string) => Buffer | undefined;
  manifest: Record<string, unknown>;
}

/** A release's files, read from its zipball in memory, by their paths inside its one top folder. */
function release(zip: string): Release & { done: () => void } {
  const z = readZip(readFileSync(zip));
  const tops = new Set(z.names.map((n) => n.split('/')[0]!));
  const prefix = tops.size === 1 && z.names.every((n) => n.includes('/')) ? `${[...tops][0]}/` : '';
  const files = z.names.map((n) => n.slice(prefix.length)).filter(Boolean).sort();
  const bytes = (p: string) => z.bytes(prefix + p);
  const read = (p: string) => bytes(p)?.toString('utf8');
  const raw = read('manifest.yaml');
  let manifest: Record<string, unknown> = {};
  try { manifest = raw ? (parseYaml(raw) as Record<string, unknown>) ?? {} : {}; } catch { manifest = {}; }
  return { files, read, bytes, manifest, done: () => undefined };
}

const dublin = (r: Release) => ((r.manifest['dublin_core'] ?? {}) as Record<string, unknown>);
const projects = (r: Release) => (Array.isArray(r.manifest['projects']) ? r.manifest['projects'] as Record<string, unknown>[] : []);
const isBook = (b: string) => (USFM_BOOKS as readonly string[]).includes(b) && bookOrder(b) < 1000;
const isOT = (b: string) => bookOrder(b) < bookOrder('MAT');

/** The words of a verse of the originals, in their own numbering, for a place the helps give in English numbering. */
function originalWords(ctx: Ctx, book: string, ref: string): string[] | null {
  const m = /^(\d+):(\d+)/.exec(ref);
  if (!m) return null;
  const chapter = Number(m[1]);
  const verse = Number(m[2]);
  const byVerse = ctx.originals.get(book);
  if (!byVerse) return null;
  // A psalm's title is verse 0 in English numbering and verse 1 in the Hebrew.
  const mapped = verse === 0 ? [{ book, chapter, verse: 1 }] : isOT(book) ? verseToOrg(ctx.versifications.engDoc, { book, chapter, verse }) : [{ book, chapter, verse }];
  const words = mapped.flatMap((v) => byVerse.get(`${v.chapter}:${v.verse}`) ?? []);
  return words.length ? words : byVerse.get(`${chapter}:${verse}`) ?? null;
}

/** Rows with the original words their quotes are about, where the verse is at hand. */
function withWords(ctx: Ctx, book: string, rows: HelpRow[]): { rows: HelpRow[]; found: number; quoted: number } {
  let found = 0;
  let quoted = 0;
  const out = rows.map((r) => {
    if (!r.quote || !r.occurrence || r.occurrence < 1) return r;
    quoted++;
    const verse = originalWords(ctx, book, r.ref);
    const words = verse ? findQuote(r.quote, r.occurrence, verse) : null;
    if (!words) return r;
    found++;
    return { ...r, words };
  });
  return { rows: out, found, quoted };
}

interface Built { docHash: string; description: string; nameHint?: string; manual?: CheckingManual }

/** A Bible: each book's text, its alignment when it is word-aligned, and the source that lists them. */
function buildBible(ctx: Ctx, c: Taken, r: Release, meta: { license: string; credit: string; name: string }): Built {
  const original = c.role === 'original';
  const books: { book: string; name: string; doc: string; alignment?: string }[] = [];
  let aligned = 0;
  const paths = projects(r).map((p) => String(p['path'] ?? '').replace(/^\.\//, '')).filter((p) => p.endsWith('.usfm'));
  for (const path of paths.length ? paths : r.files.filter((f) => f.endsWith('.usfm'))) {
    const text = r.read(path);
    if (!text) continue;
    let parsed;
    try { parsed = parseUsfm(text); } catch { continue; }
    if (!isBook(parsed.book)) continue;
    const chapters = parsed.chapters.filter((ch) => ch.verses.length).map((ch) => ({
      chapter: ch.chapter,
      verses: ch.verses.map((v) => [v.verse, v.end, v.text] as [number, number, string])
    }));
    if (!chapters.length) continue;
    const doc = put(ctx, { format: 'sourceBook@1', book: parsed.book, chapters, deps: [] });
    if (original) {
      ctx.originals.set(parsed.book, new Map(parsed.chapters.flatMap((ch) => ch.verses.map((v) => [`${ch.chapter}:${v.verse}`, verseWords(v)] as const))));
    }
    let alignment: string | undefined;
    if (!original && parsed.chapters.some((ch) => ch.verses.some((v) => v.groups.length))) {
      alignment = put(ctx, {
        format: 'alignment@1', book: parsed.book, text: doc, original: isOT(parsed.book) ? 'hbo' : 'grc',
        chapters: parsed.chapters.filter((ch) => ch.verses.length).map((ch) => ({
          chapter: ch.chapter,
          verses: ch.verses.filter((v) => v.words.length).map((v) => ({ verse: v.verse, words: v.words, groups: v.groups }))
        })),
        deps: [doc]
      });
      aligned++;
    }
    const projectTitle = projects(r).find((p) => String(p['identifier'] ?? '').toUpperCase() === parsed.book)?.['title'];
    books.push({ book: parsed.book, name: String(projectTitle ?? parsed.name ?? parsed.book), doc, ...(alignment ? { alignment } : {}) });
  }
  books.sort((a, b) => bookOrder(a.book) - bookOrder(b.book));
  const description = `${aligned ? 'Word-aligned to the Hebrew and Greek. ' : ''}${meta.credit}`;
  const docHash = put(ctx, {
    format: 'source@1', name: meta.name, abbreviation: abbreviationOf(c.entry), language: c.language, description,
    versification: original ? ctx.versifications.org : ctx.versifications.eng,
    provider: { kind: 'library' }, offline: 'allowed', copyright: { text: `${meta.credit} ${meta.license.replace(/-/g, ' ').replace(/ (\d)/, ' $1')}` },
    license: meta.license, books, deps: [...new Set([ctx.versifications[original ? 'org' : 'eng'], ...books.map((b) => b.doc)])].sort()
  });
  ctx.log(`    ${books.length} books${aligned ? `, ${aligned} aligned` : ''}`);
  return { docHash, description };
}

type HelpKind = 'notes' | 'questions' | 'wordLinks';

/** About how big one part of a book of helps may be before the book is split by chapter. */
const PART_BYTES = 1024 * 1024;

/**
 * A book's rows in parts of whole chapters, each about PART_BYTES at most;
 * one part when it is small. The book's introduction goes with the first.
 */
export function partsByChapter(rows: HelpRow[]): { chapters: [number, number]; rows: HelpRow[] }[] {
  const chapterOf = (r: HelpRow) => { const m = /^(\d+)/.exec(r.ref); return m ? Number(m[1]) : 0; };
  const byChapter = new Map<number, HelpRow[]>();
  for (const r of rows) byChapter.set(chapterOf(r), [...(byChapter.get(chapterOf(r)) ?? []), r]);
  const chapters = [...byChapter.keys()].sort((a, b) => a - b);
  const out: { chapters: [number, number]; rows: HelpRow[]; bytes: number }[] = [];
  for (const c of chapters) {
    const its = byChapter.get(c)!;
    const bytes = Buffer.byteLength(canonicalJson(its));
    const last = out[out.length - 1];
    if (last && (last.bytes + bytes <= PART_BYTES || c === 0 || last.chapters[1] === 0)) {
      last.rows.push(...its);
      last.bytes += bytes;
      last.chapters[1] = c;
    } else out.push({ chapters: [c, c], rows: [...its], bytes });
  }
  return out.map((p) => ({ chapters: p.chapters, rows: p.rows }));
}

/** Row ids as the publisher wrote them, with a repeat (a copy-and-paste in a TSV) told apart by its place in the book. */
function uniqueIds(rows: HelpRow[]): HelpRow[] {
  const seen = new Set<string>();
  return rows.map((r, i) => {
    if (!seen.has(r.id)) { seen.add(r.id); return r; }
    const id = `${r.id}#${i}`;
    seen.add(id);
    return { ...r, id };
  });
}

/** A set of notes, questions or key-word links: one document per book, and the index that lists them. */
function buildBookHelps(ctx: Ctx, c: Taken, r: Release, kind: HelpKind, meta: { license: string; credit: string; name: string; languageName: string }): Built {
  const stories = c.role.startsWith('story');
  const byBook = new Map<string, HelpRow[]>();
  const tsvs = r.files.filter((f) => /(?:^|[-_/])[A-Z0-9]{3}\.tsv$/i.test(f));
  for (const f of tsvs) {
    const book = (/([A-Z0-9]{3})\.tsv$/i.exec(f)?.[1] ?? '').toUpperCase();
    if (!(stories ? book === 'OBS' : isBook(book))) continue;
    const text = r.read(f) ?? '';
    const rows = kind === 'notes' ? tsvNotes(text) : kind === 'questions' ? tsvQuestions(text) : tsvWordLinks(text);
    if (rows.length) byBook.set(book, rows);
  }
  if (!byBook.size && kind !== 'wordLinks') {
    const md = r.files.filter((f) => f.endsWith('.md') && !/^(README|LICENSE)/i.test(f));
    const files: SourceFile[] = md.map((p) => ({ path: p, text: r.read(p) ?? '' }));
    if (stories && kind === 'questions' && files.some((f) => /^content\/\d+\.md$/.test(f.path))) {
      const rows = storyQuestionFiles(files);
      if (rows.length) byBook.set('OBS', rows);
    } else {
      for (const [book, rows] of markdownHelps(files, kind, { stories })) if (stories ? book === 'OBS' : isBook(book)) byBook.set(book, rows);
    }
  }
  let found = 0;
  let quoted = 0;
  const books: { book: string; doc: string }[] = [];
  for (const [book, rows0] of [...byBook].sort(([a], [b]) => bookOrder(a) - bookOrder(b))) {
    const resolved = stories ? { rows: rows0, found: 0, quoted: 0 } : withWords(ctx, book, rows0);
    found += resolved.found;
    quoted += resolved.quoted;
    const rows = uniqueIds(resolved.rows);
    const parts = partsByChapter(rows);
    for (const p of parts) {
      const doc = put(ctx, { format: 'helpBook@1', book, rows: p.rows, deps: [] });
      books.push({ book, doc, ...(parts.length > 1 ? { chapters: p.chapters } : {}) });
    }
  }
  if (!books.length) throw new Error('no notes, questions or links read');
  const description = `${ROLE_NAMES[c.role]} in ${meta.languageName}, book by book. ${meta.credit}`;
  const docHash = put(ctx, {
    format: 'helps@1', kind, title: meta.name, language: c.language, description, license: meta.license, credit: meta.credit,
    ...(stories ? { template: OBS_TEMPLATE_ID } : { versification: ctx.versifications.eng }),
    books, deps: [...new Set([...(stories ? [] : [ctx.versifications.eng]), ...books.map((b) => b.doc)])].sort()
  });
  ctx.log(`    ${books.length} books, ${[...byBook.values()].reduce((n, r) => n + r.length, 0)} rows${quoted ? `, ${found} of ${quoted} quotes found in the Hebrew or Greek` : ''}`);
  return { docHash, description };
}

/** Articles (key words, a manual, a grammar), each its own `material@1`, and the contents that list them. */
function buildArticles(ctx: Ctx, c: Taken, r: Release, meta: { license: string; credit: string; name: string; languageName: string }): Built {
  const articles: Article[] = [];
  let nameHint: string | undefined;
  let manualFound: CheckingManual | undefined;
  if (c.role === 'words') {
    for (const f of r.files) {
      if (!/(?:^|\/)bible\/(kt|names|other)\/[^/]+\.md$/.test(f)) continue;
      const a = wordArticle(f, r.read(f) ?? '');
      if (a && a.body) articles.push(a);
    }
    articles.sort((a, b) => (a.title.localeCompare(b.title)));
  } else if (c.role === 'academy') {
    let checking: CheckingManual | undefined;
    try {
      const toc = r.read('checking/toc.yaml');
      checking = checkingManual(toc ? parseYaml(toc) : null, (slug) => ({ title: r.read(`checking/${slug}/title.md`), body: r.read(`checking/${slug}/01.md`) }));
    } catch { checking = undefined; }
    if (checking) manualFound = checking;
    for (const manual of ['intro', 'process', 'translate', 'checking']) {
      const toc = r.read(`${manual}/toc.yaml`);
      let order: string[] = [];
      try { order = toc ? tocOrder(parseYaml(toc)) : []; } catch { order = []; }
      const slugs = [...new Set(r.files.filter((f) => f.startsWith(`${manual}/`) && f.endsWith('/01.md')).map((f) => f.split('/')[1]!))];
      const sorted = [...order.filter((s) => slugs.includes(s)), ...slugs.filter((s) => !order.includes(s)).sort()];
      for (const slug of sorted) {
        const a = manualArticle(manual, slug, { title: r.read(`${manual}/${slug}/title.md`), subTitle: r.read(`${manual}/${slug}/sub-title.md`), body: r.read(`${manual}/${slug}/01.md`) });
        if (a) articles.push(a);
      }
    }
  } else {
    const index = r.read('content/index.rst') ?? '';
    nameHint = rstTitle(index) ?? undefined;
    const order = rstToctree(index);
    const all = r.files.filter((f) => /^content\/[^/]+\.rst$/.test(f) && f !== 'content/index.rst').map((f) => f.slice('content/'.length, -'.rst'.length));
    const sorted = [...order.filter((s) => all.includes(s)), ...all.filter((s) => !order.includes(s)).sort()];
    for (const slug of sorted) {
      const rst = r.read(`content/${slug}.rst`) ?? '';
      const title = rstTitle(rst);
      if (!title) continue;
      const body = rstToMarkdown(rst, (p) => r.read(`content/${p}`));
      if (body) articles.push({ id: slug, title, body });
    }
  }
  const entries = articles.map((a) => ({
    id: a.id, title: a.title,
    doc: put(ctx, { format: 'material@1', kind: 'document', title: a.title, language: c.language, body: a.body, deps: [] }),
    ...(a.section ? { section: a.section } : {})
  }));
  if (!entries.length) throw new Error('no articles read');
  const description = `${c.role === 'words' ? 'Key words, each with an article' : c.role === 'academy' ? 'Articles on translating and checking' : 'A grammar of the original language'}, in ${meta.languageName}. ${meta.credit}`;
  const kind = c.role === 'words' ? 'words' : c.role === 'academy' ? 'academy' : 'grammar';
  const docHash = put(ctx, {
    format: 'contents@1', kind, title: meta.name, language: c.language, description, license: meta.license, credit: meta.credit,
    entries, deps: [...new Set(entries.map((e) => e.doc))].sort()
  });
  ctx.log(`    ${entries.length} articles${manualFound ? `, checks ${Object.keys(manualFound.names).join(' ')}` : ''}`);
  return { docHash, description, ...(nameHint ? { nameHint } : {}), ...(manualFound ? { manual: manualFound } : {}) };
}

/** Door43's address of a story picture at phone size, the same however a story writes it. */
export function pictureUrl(written: string): string {
  const m = /obs-en-(\d+)-(\d+)\.jpe?g/i.exec(written);
  if (m) return `https://cdn.door43.org/obs/jpg/${PICTURE_SIZES.phone}/obs-en-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}.jpg`;
  return written.replace(/[?#].*$/, '');
}

/** A picture as a study guide's media: its address, and its blob hashes once stored (full size, and the phone's copy). */
function pictureFile(ctx: Ctx, url: string) {
  const known = ctx.pictures.get(url);
  if (!ctx.pictures.has(url)) ctx.pictures.set(url, {});
  return { url, ...(known?.hash ? { hash: known.hash } : {}), ...(known?.lowHash ? { lowHash: known.lowHash } : {}), format: 'jpg' };
}

/**
 * Door43's story pictures in our blob store, by hash: each at full size
 * and at phone size, downloaded once into the OS temp directory and put
 * through the Worker (`put`, as `langquest/_org/<hash>.jpg`), so a story
 * names both and a phone takes the small one (study/guideMatch.ts).
 */
export function storePictures(put: (key: string, bytes: Uint8Array) => Promise<void>, log: (m: string) => void) {
  const stored = new Set<string>();
  const fetchOnce = async (url: string): Promise<Buffer> => {
    const file = join(CACHE, 'pictures', url.replace(/^https:\/\//, '').replace(/[^a-z0-9._-]/gi, '_'));
    if (existsSync(file)) return readFileSync(file);
    const res = await fetchRetry(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(join(CACHE, 'pictures'), { recursive: true });
    writeFileSync(file, bytes);
    return bytes;
  };
  const keep = async (bytes: Buffer) => {
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (!stored.has(hash)) { await put(`langquest/_org/${hash}.jpg`, bytes); stored.add(hash); }
    return hash;
  };
  return async (ctx: { pictures: Map<string, { hash?: string; lowHash?: string }> }, urls: string[]) => {
    const todo = [...new Set(urls)].filter((u) => !ctx.pictures.get(u)?.hash);
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(todo.slice(i, i + 6).map(async (url) => {
        try {
          const phone = await keep(await fetchOnce(url));
          const full = await keep(await fetchOnce(url.replace(`/${PICTURE_SIZES.phone}/`, `/${PICTURE_SIZES.full}/`)));
          ctx.pictures.set(url, { hash: full, lowHash: phone });
        } catch (e) {
          log(`  picture ${url}: ${e instanceof Error ? e.message : String(e)}; named by its address`);
        }
      }));
    }
    if (todo.length) log(`  ${todo.length} pictures stored`);
  };
}

/** A release's stories, in either layout, in order. */
function readStories(r: Release): Story[] {
  let stories: Story[] = [];
  const md = r.files.filter((f) => /^(?:content\/)?\d{2}\.md$/.test(f));
  if (md.length) {
    for (const f of md) {
      const n = Number(/(\d{2})\.md$/.exec(f)![1]);
      if (n < 1 || n > 50) continue;
      const s = markdownStory(n, r.read(f) ?? '');
      if (s) stories.push(s);
    }
  } else {
    stories = folderStories(r.files.filter((f) => /(?:^|\/)\d{2}\/[a-z0-9]+\.txt$/i.test(f)).map((p) => ({ path: p, text: r.read(p) ?? '' })));
  }
  return stories.sort((a, b) => a.story - b.story);
}

/** Open Bible Stories in one language: each story a `study@2` placed on the template's story, and the contents that list them. */
function buildStories(ctx: Ctx, c: Taken, stories: Story[], meta: { license: string; credit: string; name: string; languageName: string; publisher: string }): Built & { stories: Story[] } {
  if (!stories.length) throw new Error('no stories read');
  const credit = `${meta.credit} ${OBS_PICTURE_CREDIT}`;
  const entries = stories.map((s) => {
    const node = String(s.story).padStart(2, '0');
    const resources = s.frames.filter((f) => f.image).map((f) => {
      const url = pictureUrl(f.image!);
      return { ref: `p${f.id}`, kind: 'media', title: f.id, media: [{ id: `p${f.id}`, kind: 'illustration', title: f.id, caption: '', file: pictureFile(ctx, url) }] };
    });
    const doc = put(ctx, {
      format: 'study@2', title: s.title, pattern: 'OBS', about: s.reference ?? '', source: `Door43 · ${meta.publisher}`, language: c.language,
      links: [{ template: OBS_TEMPLATE_ID, node }], license: meta.license, credit,
      steps: s.frames.map((f) => ({ id: f.id, title: f.id.replace(/^0?(\d+)-0?(\d+)$/, '$1-$2'), text: f.image ? `[${f.id}](#p${f.id})\n\n${f.text}` : f.text })),
      resources, terms: [], deps: []
    });
    return { id: node, title: s.title, doc };
  });
  const description = `The 50 stories in ${meta.languageName}, each placed on its story of the Open Bible Stories template. ${credit}`;
  const docHash = put(ctx, {
    format: 'contents@1', kind: 'stories', title: meta.name, language: c.language, description, license: meta.license, credit,
    template: OBS_TEMPLATE_ID, entries, deps: [...new Set(entries.map((e) => e.doc))].sort()
  });
  ctx.log(`    ${stories.length} stories, ${stories.reduce((n, s) => n + s.frames.length, 0)} frames`);
  return { docHash, description, stories };
}

/** The Theological Formation guide: each story's guide a `study@2` with its pictures, placed on the template's story. */
function buildFormation(ctx: Ctx, c: Taken, r: Release, meta: { license: string; credit: string; name: string; languageName: string; publisher: string }, pictures: { count: number; bytes: number }): Built {
  const entries: { id: string; title: string; doc: string }[] = [];
  const counted = new Set<string>();
  for (const f of r.files.filter((p) => /^obs_story_\d+\.md$/.test(p)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))) {
    const s = formationStory(r.read(f) ?? '');
    if (!s) continue;
    const node = String(s.story).padStart(2, '0');
    const resources = s.images.map((img) => {
      const path = `images/${img}`;
      const data = r.bytes(path);
      const bytes = data?.length ?? 0;
      if (!counted.has(path)) { counted.add(path); pictures.count++; pictures.bytes += bytes; }
      const hash = data ? createHash('sha256').update(data).digest('hex') : undefined;
      return { ref: img, kind: 'media', title: img, media: [{ id: img, kind: 'illustration', title: img, caption: '', file: hash ? { hash, format: 'jpg' } : { url: `${c.entry.url}/raw/tag/${c.entry.tag}/${path}`, format: 'jpg' } }] };
    });
    const body = s.body.replace(/!\[\[([^\]]+)\]\]/g, (_, img: string) => `[${img}](#${img})`);
    const doc = put(ctx, {
      format: 'study@2', title: s.title, pattern: 'OBS-TF', about: '', source: `Door43 · ${meta.publisher}`, language: c.language,
      links: [{ template: OBS_TEMPLATE_ID, node }], license: meta.license, credit: meta.credit,
      steps: [{ id: 'guide', title: s.title, text: body }], resources, terms: [], deps: []
    });
    entries.push({ id: node, title: s.title, doc });
  }
  if (!entries.length) throw new Error('no stories read');
  const description = `A guide to the theology of each story, in ${meta.languageName}. ${meta.credit}`;
  const docHash = put(ctx, {
    format: 'contents@1', kind: 'stories', title: meta.name, language: c.language, description, license: meta.license, credit: meta.credit,
    template: OBS_TEMPLATE_ID, entries, deps: [...new Set(entries.map((e) => e.doc))].sort()
  });
  ctx.log(`    ${entries.length} stories`);
  return { docHash, description };
}

/** The Open Bible Stories template: 50 stories, each a part, titled from English. */
function buildObsTemplate(ctx: Ctx, english: Story[], credit: string): string {
  const outline = english.map((s) => ({ id: String(s.story).padStart(2, '0'), title: s.title }));
  return put(ctx, withFlowLanguage({
    format: 'template@2', name: 'Open Bible Stories', description: `50 stories from the Bible, each one part. ${credit}`,
    structure: 'outline', levels: [{ name: 'Story' }], outline, deps: []
  }, 'eng'));
}

// ---- the whole build ------------------------------------------------------------------------------

/** Roles built first: the originals (their words find quotes), then Bibles, then English stories (they make the template). */
const ORDER: Role[] = ['original', 'bible', 'stories', 'notes', 'questions', 'wordLinks', 'words', 'academy', 'grammar', 'storyNotes', 'storyQuestions', 'storyWordLinks', 'storyStudyNotes', 'storyStudyQuestions', 'formation'];

export async function buildDoor43(opts: {
  sink: DocSink;
  versifications: { eng: string; org: string; engDoc: VersificationDoc };
  catalog?: CatalogEntry[];
  only?: (c: Taken) => boolean;
  log?: (m: string) => void;
  /** Store the story pictures these addresses name before their stories are built (`storePictures`). */
  pictures?: (ctx: { pictures: Map<string, { hash?: string; lowHash?: string }> }, urls: string[]) => Promise<void>;
}): Promise<BuildReport> {
  const log = opts.log ?? console.log;
  const catalog = opts.catalog ?? (await fetchCatalog(log));
  const choices = choose(catalog);
  // The Hebrew and Greek always come: every other language's notes find their quotes in them.
  const taken = choices.filter((c): c is Taken => 'role' in c && (c.role === 'original' || !opts.only || opts.only(c)))
    .sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role) || (a.entry.owner === 'unfoldingWord' ? -1 : b.entry.owner === 'unfoldingWord' ? 1 : 0) ||
      a.language.localeCompare(b.language) || a.entry.name.localeCompare(b.entry.name));
  const report: BuildReport = {
    items: [],
    skipped: choices.filter((c): c is Extract<Choice, { skip: string }> => 'skip' in c).map((c) => ({ entry: `${c.entry.owner}/${c.entry.name}@${c.entry.tag}`, subject: c.entry.subject, reason: c.skip })),
    flowsFromEnglish: [],
    pictures: { count: 0, phoneBytes: 0, fullBytes: 0 },
    pictureUrls: [],
    formationPictures: { count: 0, bytes: 0 }
  };
  const manuals: { c: Taken; itemId: string; publisher: string; languageName: string; credit: string; license: string; manual: CheckingManual }[] = [];
  const ctx: Ctx = { sink: opts.sink, versifications: opts.versifications, originals: new Map(), log, stats: { docs: 0, bytes: 0, largest: 0 }, pictures: new Map(), itemLargest: 0 };
  const seen = new Map<string, string>();
  let english: Story[] | null = null;
  // Fetch a few releases ahead while one is built.
  const ahead = new Map<string, Promise<string>>();
  const want = (i: number) => {
    const c = taken[i];
    if (c && !ahead.has(c.entry.zipball)) ahead.set(c.entry.zipball, zipOf(c.entry));
  };
  for (let i = 0; i < taken.length; i++) {
    for (let k = 0; k < 3; k++) want(i + k);
    const c = taken[i]!;
    const label = `${c.entry.owner}/${c.entry.name}@${c.entry.tag}`;
    let zip: string;
    try { zip = await ahead.get(c.entry.zipball)!; } catch (e) {
      report.skipped.push({ entry: label, subject: c.entry.subject, reason: `download failed: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    ahead.delete(c.entry.zipball);
    let r: ReturnType<typeof release>;
    try { r = release(zip); } catch (e) {
      report.skipped.push({ entry: label, subject: c.entry.subject, reason: `could not be read: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    try {
      const dc = dublin(r);
      // translationStudio's layout has no rights in its manifest; its license file says.
      const license = licenseOf(String(dc['rights'] ?? '')) ?? licenseOf(r.read('LICENSE.md'));
      if (!license) { report.skipped.push({ entry: label, subject: c.entry.subject, reason: `license ${String(dc['rights'] ?? 'not given')} does not allow a changed copy` }); continue; }
      const publisher = publisherName(c.entry, typeof dc['publisher'] === 'string' ? dc['publisher'] : undefined);
      const credit = creditOf(r.read('LICENSE.md'), { owner: c.entry.owner, ownerName: publisher, url: c.entry.url });
      const languageName = languageLabel(c.entry, c.language);
      const name = itemName(c, languageName, publisher);
      log(`  ${label}: ${name}`);
      const meta = { license, credit, name, languageName, publisher };
      const before = { ...ctx.stats };
      ctx.itemLargest = 0;
      let built: Built;
      switch (c.role) {
        case 'bible': case 'original': built = buildBible(ctx, c, r, meta); break;
        case 'notes': case 'storyNotes': case 'storyStudyNotes': built = buildBookHelps(ctx, c, r, 'notes', meta); break;
        case 'questions': case 'storyQuestions': case 'storyStudyQuestions': built = buildBookHelps(ctx, c, r, 'questions', meta); break;
        case 'wordLinks': case 'storyWordLinks': built = buildBookHelps(ctx, c, r, 'wordLinks', meta); break;
        case 'words': case 'academy': case 'grammar': built = buildArticles(ctx, c, r, meta); break;
        case 'stories': {
          const stories = readStories(r);
          // Pictures first, so the stories name them by hash (a real build); a dry run names them by address.
          if (opts.pictures) await opts.pictures(ctx, stories.flatMap((st) => st.frames.flatMap((f) => (f.image ? [pictureUrl(f.image)] : []))));
          const s = buildStories(ctx, c, stories, meta);
          if (!english && c.language === 'eng' && c.entry.owner === 'unfoldingWord') {
            english = s.stories;
            const t = buildObsTemplate(ctx, english, credit);
            report.items.push({ itemId: OBS_TEMPLATE_ID, name: 'Open Bible Stories', description: `50 stories from the Bible, each one part. ${credit}`, docHash: t, role: 'stories', language: 'eng', publisher, entry: label, docs: 1, bytes: 0, largest: 0, zipBytes: 0 });
          }
          built = s;
          break;
        }
        case 'formation': built = buildFormation(ctx, c, r, meta, report.formationPictures); break;
      }
      // The same documents under another publisher's name is a copy.
      const copy = seen.get(built.docHash);
      if (copy) { report.skipped.push({ entry: label, subject: c.entry.subject, reason: `the same as ${copy}` }); continue; }
      seen.set(built.docHash, label);
      if (built.manual) manuals.push({ c, itemId: itemIdOf(c.entry), publisher, languageName, credit, license, manual: built.manual });
      report.items.push({
        itemId: itemIdOf(c.entry), name: c.role === 'grammar' && built.nameHint ? plainTitle(built.nameHint) : name, description: built.description, docHash: built.docHash,
        role: c.role, language: c.language, publisher, entry: label,
        docs: ctx.stats.docs - before.docs, bytes: ctx.stats.bytes - before.bytes, largest: ctx.itemLargest, zipBytes: statSync(zip).size
      });
    } catch (e) {
      report.skipped.push({ entry: label, subject: c.entry.subject, reason: `could not be read: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      r.done();
    }
  }
  buildFlows(ctx, report, manuals);
  report.pictureUrls = [...ctx.pictures.keys()].sort();
  return report;
}

/**
 * A flow per Checking Manual, for the Bible and, where the language has
 * story questions, for Open Bible Stories; each links the manual's
 * language's notes, key words and questions (the same publisher's first),
 * and the manual's two forms as question sets of their own.
 */
function buildFlows(ctx: Ctx, report: BuildReport, manuals: { c: Taken; itemId: string; publisher: string; languageName: string; credit: string; license: string; manual: CheckingManual }[]) {
  const english = manuals.find((m) => m.c.language === 'eng' && m.c.entry.owner === 'unfoldingWord')?.manual.names ?? {};
  const pick = (m: (typeof manuals)[number], role: Role) => {
    const same = report.items.filter((i) => i.role === role && i.language === m.c.language && !i.kind);
    return (same.find((i) => i.entry.startsWith(`${m.c.entry.owner}/`)) ?? same.find((i) => i.entry.startsWith('unfoldingWord/')) ?? same[0])?.itemId;
  };
  for (const m of manuals) {
    const before = { ...ctx.stats };
    const forms: { evaluation?: string; affirmation?: string } = {};
    const formItem = (key: 'evaluation' | 'affirmation', kindId: CheckId) => {
      const f = m.manual[key];
      if (!f) return;
      const doc = formQuestions({ title: f.title, language: m.c.language, kindId, affirm: f.affirm, ...('answer' in f ? { answer: f.answer } : {}) });
      const itemId = `${m.itemId}.${key}`;
      const docHash = put(ctx, doc);
      report.items.push({ itemId, name: `${plainTitle(f.title)} (${m.languageName})`, description: `${f.title}. ${m.credit}`, docHash, role: 'academy', language: m.c.language, publisher: m.publisher, entry: m.c.entry.owner + '/' + m.c.entry.name, docs: 1, bytes: Buffer.byteLength(canonicalJson(doc)), largest: Buffer.byteLength(canonicalJson(doc)), zipBytes: 0 });
      forms[key] = itemId;
    };
    formItem('evaluation', 'community');
    formItem('affirmation', 'leader');
    const publisherNote = m.c.competing ? `, ${m.publisher}` : '';
    for (const stories of [false, true]) {
      const helps: FlowHelps = stories
        ? { notes: pick(m, 'storyNotes'), wordLinks: pick(m, 'storyWordLinks'), words: pick(m, 'words'), questions: pick(m, 'storyQuestions'), ...forms }
        : { notes: pick(m, 'notes'), wordLinks: pick(m, 'wordLinks'), words: pick(m, 'words'), questions: pick(m, 'questions'), ...forms };
      if (stories && !helps.questions) continue;
      const name = `Checking Manual${stories ? ' for Open Bible Stories' : ''} (${m.languageName}${publisherNote})`;
      const description = `The checks of Translation Academy's Checking Manual, named as the ${m.languageName} manual names them${stories ? ', with the story questions' : ''}. ${m.credit}`;
      const { doc, fromEnglish } = checkingFlow({
        name, description, language: m.c.language, languageName: m.languageName, manual: m.manual, fallback: english, helps,
        pattern: stories ? 'door43-checking-obs' : 'door43-checking'
      });
      const itemId = `${m.itemId}.flow${stories ? '-obs' : ''}`;
      const docHash = put(ctx, doc);
      if (fromEnglish.length) report.flowsFromEnglish.push({ item: name, checks: fromEnglish });
      report.items.push({ itemId, name, description, docHash, role: 'academy', kind: 'flow', language: m.c.language, publisher: m.publisher, entry: m.c.entry.owner + '/' + m.c.entry.name, docs: 1, bytes: Buffer.byteLength(canonicalJson(doc)), largest: Buffer.byteLength(canonicalJson(doc)), zipBytes: 0 });
    }
    ctx.log(`  flows for ${m.c.entry.owner}/${m.c.entry.name}: ${ctx.stats.docs - before.docs} documents`);
  }
}

/** How big Door43's story pictures are, both sizes, asked of its CDN without downloading them. */
export async function measurePictures(urls: string[], log: (m: string) => void): Promise<{ count: number; phoneBytes: number; fullBytes: number }> {
  let phoneBytes = 0;
  let fullBytes = 0;
  const unique = [...new Set(urls)];
  const size = async (u: string) => {
    const res = await fetchRetry(u, { method: 'HEAD' });
    return res.ok ? Number(res.headers.get('content-length') ?? 0) : 0;
  };
  for (let i = 0; i < unique.length; i += 8) {
    const batch = unique.slice(i, i + 8);
    const got = await Promise.all(batch.map(async (u) => [await size(u), await size(u.replace(`/${PICTURE_SIZES.phone}/`, `/${PICTURE_SIZES.full}/`))] as const));
    for (const [p, f] of got) { phoneBytes += p; fullBytes += f; }
  }
  log(`door43: ${unique.length} story pictures measured`);
  return { count: unique.length, phoneBytes, fullBytes };
}

/** The library kind an item is published under. */
export const itemKind = (it: { itemId: string; kind?: 'flow' }): 'flow' | 'template' | 'material' =>
  it.kind === 'flow' ? 'flow' : it.itemId === OBS_TEMPLATE_ID ? 'template' : 'material';

/** The report as lines: totals, then each item by role and language. */
export function reportLines(rep: BuildReport): string[] {
  const mb = (n: number) => `${(n / 1048576).toFixed(n < 1048576 * 10 ? 2 : 1)} MB`;
  const lines: string[] = [];
  const total = rep.items.reduce((a, i) => ({ docs: a.docs + i.docs, bytes: a.bytes + i.bytes, zip: a.zip + i.zipBytes }), { docs: 0, bytes: 0, zip: 0 });
  lines.push(`door43: ${rep.items.length} items, ${total.docs} documents, ${mb(total.bytes)} of documents (from ${mb(total.zip)} of releases)`);
  lines.push(`door43: story pictures ${rep.pictures.count}: ${mb(rep.pictures.phoneBytes)} at ${PICTURE_SIZES.phone}, ${mb(rep.pictures.fullBytes)} at ${PICTURE_SIZES.full}; Theological Formation pictures ${rep.formationPictures.count}, ${mb(rep.formationPictures.bytes)}`);
  const byRole = new Map<Role, typeof rep.items>();
  for (const it of rep.items) byRole.set(it.role, [...(byRole.get(it.role) ?? []), it]);
  for (const role of ORDER) {
    const its = byRole.get(role);
    if (!its) continue;
    const sum = its.reduce((a, i) => ({ docs: a.docs + i.docs, bytes: a.bytes + i.bytes }), { docs: 0, bytes: 0 });
    lines.push('', `${ROLE_NAMES[role]}${role === 'original' ? ' (Hebrew and Greek)' : ''}: ${its.length} items, ${new Set(its.map((i) => i.language)).size} languages, ${sum.docs} documents, ${mb(sum.bytes)}`);
    for (const it of its.sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name))) {
      lines.push(`  ${it.language.padEnd(4)} ${String(it.docs).padStart(6)} docs ${mb(it.bytes).padStart(9)} (largest ${mb(it.largest)})  ${it.name}  [${it.entry}]`);
    }
  }
  const flows = rep.items.filter((i) => i.kind === 'flow');
  lines.push('', `Review flows: ${flows.length}, in ${new Set(flows.map((f) => f.language)).size} languages`);
  for (const f of flows) lines.push(`  ${f.language.padEnd(4)} ${f.name}`);
  for (const f of rep.flowsFromEnglish) lines.push(`  ! ${f.item}: no article for ${f.checks.join(', ')}; named from the English manual`);
  lines.push('', `skipped ${rep.skipped.length}:`);
  for (const s of rep.skipped.sort((a, b) => a.reason.localeCompare(b.reason) || a.entry.localeCompare(b.entry))) lines.push(`  ${s.entry} (${s.subject}): ${s.reason}`);
  return lines;
}
