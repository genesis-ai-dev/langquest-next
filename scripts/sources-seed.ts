/**
 * LangQuest's sources to read and hear (docs/reference-material.md), built
 * into `source@1` documents for `scripts/library-seed.ts`
 * (`npm run library:seed -- --sources [--timings <dir>]`).
 *
 * - Bible Brain editions: ESV, KJV, WEB and BSB, and a few gateway-language
 *   Bibles with Old and New Testament audio that `/download` allows. Built
 *   from FCBH's API at seed time with BIBLE_BRAIN_ACCESS_KEY from the
 *   environment (never stored): which filesets per testament (the Worker's
 *   own choice, `apps/web/worker/bible.ts`), books, copyright lines, and
 *   whether `/download` allows both text and audio (`offline`). No text or
 *   audio of theirs is stored.
 * - The Berean Standard Bible read by Frederick Surrey, open-licensed and
 *   ours to keep: the public-domain text from berean.bible, split into one
 *   `sourceBook@1` per book, with each chapter's MP3 on openbible.com, and
 *   the verse timings fia-align made for it (`--timings`, `timing@1` files).
 *
 * The pure parts (documents, parsing, timings) are tested in
 * sources-seed.test.ts; the rest fetches.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bookIdOf, bookOrder, canonicalJson, isHash, SOURCE_BIBLES, sourceAudioUrl, validateDoc, withDeps,
  type LibraryDoc, type SourceBookDoc, type SourceDoc, type TimingDoc
} from '@langquest-next/core';
import { abbreviationOf, chooseFilesets, type DbpFileset, type Testaments } from '../apps/web/worker/bible';

const LIBRARY = fileURLToPath(new URL('../library/', import.meta.url));

export interface SourceSpec {
  bibleId: string;
  /** `langquest.source.<slug>`. */
  slug: string;
  /** Shown beside the name; FCBH's id without its language prefix when absent. */
  abbreviation?: string;
  /** FCBH's name when absent. */
  name?: string;
  /** The versification code its verse numbers follow (library/versifications); `eng` when absent. */
  versification?: string;
  /** Kept only if text and audio for both testaments are reachable and /download allows the audio. */
  gateway?: boolean;
}

export const BIBLE_BRAIN_SOURCES: SourceSpec[] = [
  { bibleId: 'ENGESV', slug: 'esv', abbreviation: 'ESV', name: 'English Standard Version' },
  { bibleId: 'ENGKJV', slug: 'kjv', abbreviation: 'KJV', name: 'King James Version' },
  { bibleId: 'ENGWEB', slug: 'web', abbreviation: 'WEB', name: 'World English Bible' },
  { bibleId: 'ENGBER', slug: 'bsb', abbreviation: 'BSB', name: 'Berean Standard Bible' }
];

/**
 * Gateway languages, surveyed 2026-10-05 for Bibles with text and with Old
 * and New Testament audio that /download allows for our key. One per
 * language; Spanish and Swahili had none (their audio is New Testament only,
 * or has no text). The Russian Synodal text is numbered as the Russian
 * Protestant versification (Psalm 3 has 9 verses, Romans 16 has 24).
 */
export const GATEWAY_SOURCES: SourceSpec[] = [
  { bibleId: 'FRNTLS', slug: 'frntls', gateway: true },
  { bibleId: 'PORBBS', slug: 'porbbs', gateway: true },
  { bibleId: 'HINOHC', slug: 'hinohc', gateway: true },
  { bibleId: 'INDASV', slug: 'indasv', gateway: true },
  { bibleId: 'RUSSYN', slug: 'russyn', gateway: true, versification: 'rsc' },
  { bibleId: 'ARBBIB', slug: 'arbbib', gateway: true }
];

/** What the seed learns about one Bible Brain edition. */
export interface FetchedBible {
  spec: SourceSpec;
  name: string;
  language: string;
  books: { book: string; name: string }[];
  text: Testaments;
  audio: Testaments;
  copyright: { text?: string; audio?: string };
  /** /download allowed for every chosen fileset of that kind. */
  offline: { text: boolean; audio: boolean };
}

export interface SourceBuild {
  documents: { hash: string; body: LibraryDoc }[];
  items: { itemId: string; kind: 'material'; name: string; description: string; docHash: string }[];
}

export const hashOf = (doc: LibraryDoc) => createHash('sha256').update(canonicalJson(doc)).digest('hex');

const BSB_FS = SOURCE_BIBLES.find((b) => b.id === 'berean-bsb-fs')!;
export const BSB_TEXT_URL = 'https://bereanbible.com/bsb.txt';

// ---- documents (pure) -------------------------------------------------------------------------

const testamentWords = (t: Testaments) => (t.OT && t.NT ? 'Old and New Testaments' : t.NT ? 'New Testament only' : t.OT ? 'Old Testament only' : 'none');

/** A Bible Brain edition as a `source@1`: where to find it, and no content. */
export function bibleBrainSourceDoc(b: FetchedBible, versification: string): SourceDoc {
  const offline = b.offline.text && b.offline.audio ? 'allowed' : 'stream';
  const description = `From Bible Brain (Faith Comes By Hearing). Text: ${testamentWords(b.text)}. Audio: ${testamentWords(b.audio)}. ` +
    (offline === 'allowed' ? 'Can be kept offline in the app.' : 'Read and heard online.');
  return withDeps({
    format: 'source@1',
    name: b.spec.name ?? b.name,
    abbreviation: b.spec.abbreviation ?? abbreviationOf(b.spec.bibleId),
    language: b.language,
    description,
    versification,
    provider: {
      kind: 'biblebrain', bibleId: b.spec.bibleId,
      ...(b.text.OT || b.text.NT ? { text: b.text } : {}),
      ...(b.audio.OT || b.audio.NT ? { audio: b.audio } : {})
    },
    offline,
    copyright: b.copyright,
    books: b.books,
    deps: []
  } satisfies SourceDoc);
}

/** Why a gateway Bible does not qualify, or null. */
export function gatewayProblem(b: FetchedBible, reachable: { text: boolean; audio: boolean }): string | null {
  if (!b.text.OT || !b.text.NT) return 'text is not in both testaments';
  if (!b.audio.OT || !b.audio.NT) return 'audio is not in both testaments';
  if (!reachable.text) return 'its text could not be read';
  if (!reachable.audio) return 'its audio could not be found';
  if (!b.offline.audio) return '/download does not allow its audio';
  return null;
}

/** USFM codes by the English names berean.bible writes (books.eng.json, plus its "Psalm"). */
function bookCodes(): Map<string, string> {
  const names = JSON.parse(readFileSync(join(LIBRARY, 'books.eng.json'), 'utf8')) as Record<string, string>;
  const out = new Map(Object.entries(names).map(([code, name]) => [name, code]));
  out.set('Psalm', 'PSA');
  return out;
}

export type ParsedText = Map<string, Map<number, [number, number, string][]>>;

/**
 * berean.bible's `bsb.txt`: a few lines of notice, a `Verse` header, then
 * `Genesis 1:1<TAB>text` per verse. Verses the BSB leaves out (Matthew
 * 17:21) have no text and are skipped.
 */
export function parseBsbText(text: string): ParsedText {
  const codes = bookCodes();
  const out: ParsedText = new Map();
  let started = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!started) {
      started = raw.startsWith('Verse\t');
      continue;
    }
    if (!raw.trim()) continue;
    const m = /^(.+?) (\d+):(\d+)\t(.*)$/.exec(raw);
    if (!m) throw new Error(`bsb.txt: cannot read the line "${raw.slice(0, 40)}"`);
    const book = codes.get(m[1]!);
    if (!book) throw new Error(`bsb.txt: unknown book "${m[1]}"`);
    const verse = Number(m[3]);
    const words = m[4]!.trim();
    if (!words) continue;
    const chapters = out.get(book) ?? new Map<number, [number, number, string][]>();
    const rows = chapters.get(Number(m[2])) ?? [];
    rows.push([verse, verse, words]);
    chapters.set(Number(m[2]), rows);
    out.set(book, chapters);
  }
  if (!started) throw new Error('bsb.txt: no "Verse" header line');
  return out;
}

/** OpenBible's MP3 of one chapter read by Frederick Surrey. */
export const bsbAudioUrl = (book: string, chapter: number) => sourceAudioUrl(BSB_FS, { book: bookIdOf(book), chapter, label: '' });

/**
 * A fia-align `timing@1` as a library document: its versification code
 * becomes that versification's document hash, and `deps` follows.
 */
export function timingDoc(raw: unknown, versifications: Record<string, string>): TimingDoc {
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== 'timing@1') throw new Error('not a timing@1 document');
  const t = raw as TimingDoc;
  const v = isHash(t.versification) && Object.values(versifications).includes(t.versification) ? t.versification : versifications[t.versification];
  if (!v) throw new Error(`timing ${t.book} ${t.chapter}: unknown versification ${String(t.versification)}`);
  const doc = withDeps({ ...t, versification: v, deps: [] });
  const invalid = validateDoc(doc);
  if (invalid) throw new Error(`timing ${t.book} ${t.chapter}: ${invalid}`);
  return doc;
}

/** Timings by `BOOK.chapter`; two for one chapter is a mistake in the directory. */
export function timingsByChapter(docs: TimingDoc[]): Map<string, TimingDoc> {
  const out = new Map<string, TimingDoc>();
  for (const d of docs) {
    const at = `${d.book}.${d.chapter}`;
    if (out.has(at)) throw new Error(`two timings for ${d.book} ${d.chapter}`);
    out.set(at, d);
  }
  return out;
}

/**
 * The BSB read by Frederick Surrey: one `sourceBook@1` per book (verses, the
 * chapter's MP3, its timing's hash when there is one) and the `source@1`
 * that lists them. A timing that names another recording than the chapter's
 * MP3 (`audio.source.url`) is left out.
 */
export function bsbDocuments(text: ParsedText, eng: string, timings: Map<string, TimingDoc>, warn: (m: string) => void = () => {}): {
  timings: TimingDoc[]; books: SourceBookDoc[]; source: SourceDoc;
} {
  const names = JSON.parse(readFileSync(join(LIBRARY, 'books.eng.json'), 'utf8')) as Record<string, string>;
  const used: TimingDoc[] = [];
  const books: SourceBookDoc[] = [];
  const unused = new Set(timings.keys());
  for (const book of [...text.keys()].sort((a, b) => bookOrder(a) - bookOrder(b))) {
    const chapters = [...text.get(book)!].sort(([a], [b]) => a - b).map(([chapter, verses]) => {
      const url = bsbAudioUrl(book, chapter);
      const t = timings.get(`${book}.${chapter}`);
      unused.delete(`${book}.${chapter}`);
      let timing: string | undefined;
      if (t) {
        const named = t.audio.source?.['url'];
        if (named && named !== url) warn(`timing for ${book} ${chapter} names another recording; left out`);
        else {
          used.push(t);
          timing = hashOf(t);
        }
      }
      return { chapter, verses, audio: { url, format: 'mp3' }, ...(timing ? { timing } : {}) };
    });
    books.push(withDeps({ format: 'sourceBook@1', book, chapters, deps: [] } satisfies SourceBookDoc));
  }
  for (const at of unused) warn(`timing for ${at.replace('.', ' ')} has no chapter in the BSB text; left out`);
  const source = withDeps({
    format: 'source@1',
    name: 'Berean Standard Bible, read by Frederick Surrey',
    abbreviation: 'BSB',
    language: 'eng',
    description: 'The Berean Standard Bible with an audio recording of every chapter by Frederick Surrey. Text and audio can be kept offline in the app.',
    versification: eng,
    provider: { kind: 'library' },
    offline: 'allowed',
    copyright: {
      text: 'The Holy Bible, Berean Standard Bible, BSB. Dedicated to the public domain (April 30, 2023). BereanBible.com',
      audio: 'Read by Frederick Surrey. OpenBible.com, CC0 1.0.'
    },
    license: 'CC0-1.0',
    books: books.map((b) => ({ book: b.book, name: names[b.book] ?? b.book, doc: hashOf(b) })),
    deps: []
  } satisfies SourceDoc);
  return { timings: used, books, source };
}

/** Every source document and item, each document after the ones it depends on. */
export function buildSources(input: {
  bibles: FetchedBible[];
  bsbText?: ParsedText;
  timings?: TimingDoc[];
  versifications: Record<string, string>;
  warn?: (m: string) => void;
}): SourceBuild {
  const documents = new Map<string, { hash: string; body: LibraryDoc }>();
  const items: SourceBuild['items'] = [];
  const put = (doc: LibraryDoc) => {
    const invalid = validateDoc(doc);
    if (invalid) throw new Error(`invalid ${doc.format}: ${invalid}`);
    const hash = hashOf(doc);
    documents.set(hash, { hash, body: doc });
    return hash;
  };
  const eng = input.versifications['eng'];
  if (!eng) throw new Error('the eng versification is not built');
  for (const b of input.bibles) {
    const code = b.spec.versification ?? 'eng';
    const v = input.versifications[code];
    if (!v) throw new Error(`${b.spec.bibleId}: unknown versification ${code}`);
    const doc = bibleBrainSourceDoc(b, v);
    items.push({ itemId: `langquest.source.${b.spec.slug}`, kind: 'material', name: doc.name, description: doc.description!, docHash: put(doc) });
  }
  if (input.bsbText) {
    const bsb = bsbDocuments(input.bsbText, eng, timingsByChapter(input.timings ?? []), input.warn);
    for (const t of bsb.timings) put(t);
    for (const b of bsb.books) put(b);
    items.push({ itemId: 'langquest.source.bsb-fs', kind: 'material', name: bsb.source.name, description: bsb.source.description!, docHash: put(bsb.source) });
  }
  return { documents: [...documents.values()], items };
}

// ---- fetching -------------------------------------------------------------------------------

type Get = (path: string, query?: Record<string, string>) => Promise<{ status: number; body: unknown }>;

/** Bible Brain with the key from the environment; errors name the path, never the URL. */
export function bibleBrainGet(key: string, fetchImpl: typeof fetch = fetch): Get {
  return async (path, query = {}) => {
    const u = new URL(`https://4.dbt.io/api${path}`);
    u.searchParams.set('v', '4');
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    u.searchParams.set('key', key);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(u.toString(), { headers: { accept: 'application/json' } });
        if (res.status >= 500 && attempt < 2) continue;
        return { status: res.status, body: res.ok ? await res.json() : null };
      } catch (e) {
        if (attempt >= 2) throw new Error(`Bible Brain ${path}: ${e instanceof Error ? e.name : 'failed'}`);
      }
    }
  };
}

const rows = (body: unknown): Record<string, unknown>[] => {
  const d = (body as { data?: unknown })?.data;
  return Array.isArray(d) ? d : [];
};

/** One edition, as the seed needs it, and whether its text and audio answer at all. */
export async function fetchBible(spec: SourceSpec, get: Get, allowedBooks: Set<string>): Promise<{ bible: FetchedBible; reachable: { text: boolean; audio: boolean } } | null> {
  const detail = await get(`/bibles/${spec.bibleId}`);
  if (detail.status !== 200) return null;
  const d = (detail.body as { data?: Record<string, unknown> }).data ?? {};
  const filesets = Object.values((d['filesets'] ?? {}) as Record<string, DbpFileset[]>).flat();
  const { text, audio } = chooseFilesets(filesets);
  const bookList = rows((await get(`/bibles/${spec.bibleId}/book`)).body);
  const books = bookList
    .map((b) => ({ book: String(b['book_id'] ?? ''), name: String(b['name'] ?? b['book_id'] ?? ''), testament: b['testament'] }))
    .filter((b) => allowedBooks.has(b.book) && bookOrder(b.book) < 1000)
    .sort((a, b) => bookOrder(a.book) - bookOrder(b.book));
  const first = (t: 'OT' | 'NT') => books.find((b) => b.testament === t)?.book;
  const copyright = async (id?: string) => {
    if (!id) return undefined;
    const r = await get(`/bibles/filesets/${id}/copyright`);
    const c = (r.body as { copyright?: { copyright?: unknown } } | null)?.copyright?.copyright;
    return typeof c === 'string' && c.trim() ? c.trim() : undefined;
  };
  const probe = async (sets: Testaments, how: 'download' | 'stream') => {
    let any = false;
    for (const t of ['OT', 'NT'] as const) {
      const id = sets[t];
      if (!id) continue;
      const book = first(t);
      if (!book) return false;
      const r = await get(how === 'download' ? `/download/${id}/${book}/1` : `/bibles/filesets/${id}/${book}/1`);
      if (r.status !== 200 || rows(r.body).length === 0) return false;
      any = true;
    }
    return any;
  };
  const [textCopy, audioCopy] = [await copyright(text.NT ?? text.OT), await copyright(audio.NT ?? audio.OT)];
  return {
    bible: {
      spec,
      name: String(d['name'] ?? spec.bibleId).trim(),
      language: String(d['iso'] ?? ''),
      books: books.map(({ book, name }) => ({ book, name })),
      text,
      audio,
      copyright: { ...(textCopy ? { text: textCopy } : {}), ...(audioCopy ? { audio: audioCopy } : {}) },
      offline: { text: await probe(text, 'download'), audio: await probe(audio, 'download') }
    },
    reachable: { text: await probe(text, 'stream'), audio: await probe(audio, 'stream') }
  };
}

/** The Bible Brain editions to publish; gateway Bibles that do not qualify are reported and left out. */
export async function fetchBibleBrainSources(key: string, versificationBooks: Record<string, Set<string>>, log: (m: string) => void): Promise<FetchedBible[]> {
  const get = bibleBrainGet(key);
  const out: FetchedBible[] = [];
  for (const spec of [...BIBLE_BRAIN_SOURCES, ...GATEWAY_SOURCES]) {
    const books = versificationBooks[spec.versification ?? 'eng'];
    if (!books) throw new Error(`${spec.bibleId}: unknown versification ${spec.versification}`);
    const got = await fetchBible(spec, get, books);
    if (!got) {
      log(`  skipped ${spec.bibleId}: Bible Brain does not have it`);
      continue;
    }
    const problem = spec.gateway ? gatewayProblem(got.bible, got.reachable) : null;
    if (problem) {
      log(`  skipped ${spec.bibleId}: ${problem}`);
      continue;
    }
    out.push(got.bible);
  }
  return out;
}

/** berean.bible's text, downloaded once into the OS temp directory (never into the repository). */
export async function loadBsbText(path?: string): Promise<string> {
  if (path) return readFileSync(path, 'utf8');
  const dir = join(tmpdir(), 'langquest-sources');
  const file = join(dir, 'bsb.txt');
  if (!existsSync(file)) {
    const res = await fetch(BSB_TEXT_URL);
    if (!res.ok) throw new Error(`${BSB_TEXT_URL}: ${res.status}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, await res.text());
  }
  return readFileSync(file, 'utf8');
}

/** Every `*.json` in a directory of fia-align output: one `timing@1` each, or a list of them. */
export function readTimings(dir: string, versifications: Record<string, string>): TimingDoc[] {
  if (!existsSync(dir)) throw new Error(`no timings directory at ${dir}`);
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
    const json = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
    return (Array.isArray(json) ? json : [json]).map((t) => timingDoc(t, versifications));
  });
}

/**
 * The sources for a library build (`npm run library:seed -- --sources`):
 * Bible Brain editions when BIBLE_BRAIN_ACCESS_KEY is set, and the BSB read
 * by Frederick Surrey with any timings in `timingsDir`.
 */
export async function sourcesFor(
  versificationDocs: { code: string; hash: string; books: string[] }[],
  opts: { timingsDir?: string | undefined; bsbTextPath?: string | undefined; key?: string | undefined },
  log: (m: string) => void = console.log
): Promise<SourceBuild> {
  const versifications = Object.fromEntries(versificationDocs.map((v) => [v.code, v.hash]));
  const books = Object.fromEntries(versificationDocs.map((v) => [v.code, new Set(v.books)]));
  let bibles: FetchedBible[] = [];
  if (opts.key) {
    log('sources: reading Bible Brain');
    bibles = await fetchBibleBrainSources(opts.key, books, log);
  } else {
    log('sources: BIBLE_BRAIN_ACCESS_KEY is not set, so only the BSB read by Frederick Surrey is built');
  }
  const timings = opts.timingsDir ? readTimings(opts.timingsDir, versifications) : [];
  return buildSources({ bibles, bsbText: parseBsbText(await loadBsbText(opts.bsbTextPath)), timings, versifications, warn: (m) => log(`  ${m}`) });
}
