/**
 * Publish the LangQuest organization's library (docs/library.md).
 *
 *   npm run library:seed -- --dry-run
 *   npm run library:seed -- [--fia-dir <dir>]... [--hosted]
 *   npm run library:seed -- --sources [--timings <dir>] [--bsb-text <file>]
 *
 * The official LangQuest organization (`langquest`) hosts the starters:
 * the six standard versifications, Bible and FIA templates, the standard
 * review flows, the question sets and FIA study material. All of it is built
 * here from sources in `library/` and core, into documents named by the
 * SHA-256 of their canonical JSON, and the org events that publish them.
 *
 * Event ids come from what they say (`seed:<itemId>:<docHash>` for a
 * version), so running twice changes nothing: the server keeps the first of
 * each id, and a document it already has is the same document. A changed
 * source publishes a new version of its item and leaves the old ones.
 *
 * `--sources` adds the sources to read and hear (`scripts/sources-seed.ts`):
 * Bible Brain editions, built from FCBH's API with BIBLE_BRAIN_ACCESS_KEY
 * from the environment, and the BSB read by Frederick Surrey with the
 * fia-align timings in `--timings`. It needs the network, even with
 * `--dry-run`.
 *
 * Publishing goes through the service-role RPCs `library_seed_document`
 * (dependencies first) and `library_seed_events`, at SUPABASE_URL (local by
 * default, its key from `supabase status`) with SUPABASE_SERVICE_ROLE_KEY. A
 * non-local URL needs `--hosted`,
 * and the owner's go-ahead (library/README.md).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isLocalUrl, LOCAL_URL, supabaseKey } from './local-supabase';
import {
  bookOrder, canonicalJson, convertWay, DEFAULT_KINDS, encodeHlc, FIA_PERICOPES, FLOWS, kindOfDoc, missingMappings, numberingOf, ORG_STREAM, paratextMappings, parseRef,
  QUESTION_TEMPLATES, USFM_BOOKS, usfmOf, validateDoc, withDeps,
  type AnyEvent, type CollectionDoc, type FlowDoc, type LibraryDoc, type LibraryKind, type MaterialDoc, type StudyDoc,
  type TemplateBook, type TemplateDocV1, type TemplateDocV2, type VersificationDoc
} from '@langquest-next/core';
import { FIA_ATTRIBUTION, fiaLanguages, fiaPericope, fiaStudyDoc } from './fia-adapter';
import { sourcesFor } from './sources-seed';

export const SEED_ORG = { id: 'langquest', name: 'LangQuest' } as const;

const LIBRARY = fileURLToPath(new URL('../library/', import.meta.url));
const DEFAULT_FIA_DIR = join(LIBRARY, 'fia');

/** The standard systems (library/versifications, from versification-tool), in the order people meet them. */
const VERSIFICATIONS: { code: string; name: string; short: string; description: string }[] = [
  { code: 'eng', name: 'English', short: 'English', description: 'Verse numbers as in most English Bibles.' },
  { code: 'org', name: 'Original (Hebrew and Greek)', short: 'Original', description: 'Verse numbers of the Hebrew and Greek texts, which every other system is mapped to.' },
  { code: 'lxx', name: 'Septuagint', short: 'Septuagint', description: 'Verse numbers of the Greek Old Testament.' },
  { code: 'vul', name: 'Vulgate', short: 'Vulgate', description: 'Verse numbers of the Latin Vulgate, as many Catholic Bibles use them.' },
  { code: 'rso', name: 'Russian Orthodox', short: 'Russian Orthodox', description: 'Verse numbers of the Russian Synodal Bible with the deuterocanon.' },
  { code: 'rsc', name: 'Russian Protestant', short: 'Russian Protestant', description: 'Verse numbers of the Russian Synodal Bible, 66 books.' }
];

/** The 66 books of the Protestant canon. */
const P66 = USFM_BOOKS.slice(0, 66) as readonly string[];

/**
 * The numberings LangQuest offers (decision 80, docs/breaking-up-the-bible.md):
 * a source file and exactly one tradition's books. Catholic Bibles numbered
 * like the Hebrew (NABRE) are not here yet: no source file has Daniel with
 * its Greek chapters in that numbering.
 */
const NUMBERINGS: { id: string; from: string; name: string; short: string; description: string; books: string[] }[] = [
  {
    id: 'eng-66', from: 'eng', name: 'Like most English Bibles · 66 books', short: 'Numbered like most English Bibles',
    description: 'Psalm headings have no verse number, and Malachi has 4 chapters. Most English, Spanish and Portuguese Bibles (KJV, NIV, ESV, NLT, Reina-Valera).',
    books: [...P66]
  },
  {
    id: 'org-66', from: 'org', name: 'Like the Hebrew and Greek · 66 books', short: 'Numbered like the Hebrew and Greek',
    description: 'Psalm headings are numbered, Malachi has 3 chapters and Joel 4. Luther 2017, Elberfelder, Bible du Semeur, the Hebrew and Greek texts.',
    books: [...P66]
  },
  {
    id: 'vul-73', from: 'vul', name: 'Like the Latin Vulgate · 73 books (Catholic)', short: 'Numbered like the Latin Vulgate',
    description: 'The shepherd psalm is Psalm 22, and Daniel has 14 chapters. The Douay-Rheims and older Catholic Bibles.',
    books: [...P66.map((b) => (b === 'EST' ? 'ESG' : b)), 'TOB', 'JDT', 'WIS', 'SIR', 'BAR', '1MA', '2MA']
  },
  {
    id: 'rsc-66', from: 'rsc', name: 'Russian Synodal · 66 books', short: 'Numbered like the Russian Synodal Bible',
    description: 'The Russian Synodal Bible as Protestants print it.',
    books: [...P66]
  },
  {
    id: 'rso-77', from: 'rso', name: 'Russian Synodal · 77 books (Orthodox)', short: 'Numbered like the Russian Synodal Bible with the extra books',
    description: 'The Russian Synodal Bible with the books Orthodox churches print.',
    books: [...P66, 'TOB', 'JDT', 'WIS', 'SIR', 'BAR', 'LJE', '1MA', '2MA', '3MA', '1ES', '2ES']
  }
];

const NT_FIRST = bookOrder('MAT');
const NT_LAST = bookOrder('REV');

/** The review kind each question set is for. */
const QUESTION_KIND: Record<string, string> = { community_check: 'community', consultant_check: 'consultant' };

interface SeedDocument {
  hash: string;
  body: LibraryDoc;
}

interface SeedItem {
  itemId: string;
  kind: LibraryKind;
  name: string;
  description: string;
  docHash: string;
}

interface SeedBuild {
  /** Every document, each after the documents it depends on. */
  documents: SeedDocument[];
  items: SeedItem[];
}

const hashOf = (doc: LibraryDoc) => createHash('sha256').update(canonicalJson(doc)).digest('hex');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** Copenhagen JSON writes verse counts as strings; documents carry numbers. */
function versificationDoc(code: string, name: string): VersificationDoc {
  const src = readJson(join(LIBRARY, 'versifications', `${code}.json`)) as Omit<VersificationDoc, 'format' | 'code' | 'name'> & { maxVerses: Record<string, (string | number)[]> };
  return {
    ...src,
    format: 'versification@1',
    code,
    name,
    maxVerses: Object.fromEntries(Object.entries(src.maxVerses).map(([book, vs]) => [book, vs.map(Number)]))
  };
}

/** Every `pericope_*.json` in the directories, by pericope id; a later directory's copy wins. */
function fiaFiles(dirs: string[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const dir of dirs) {
    if (!existsSync(dir)) throw new Error(`no FIA directory at ${dir}`);
    for (const f of readdirSync(dir).filter((n) => /^pericope_.+\.json$/.test(n)).sort()) {
      const json = readJson(join(dir, f));
      out.set(fiaPericope(json).id, json);
    }
  }
  return out;
}

/** Build every document and item. Deterministic: the same sources give the same hashes. */
export function buildLibrary(opts: { fiaDirs?: string[]; examples?: boolean } = {}): SeedBuild {
  const documents = new Map<string, SeedDocument>();
  const items: SeedItem[] = [];
  const put = (doc: LibraryDoc): string => {
    const body = kindOfDoc(doc) === 'versification' ? doc : withDeps(doc);
    const invalid = validateDoc(body);
    if (invalid) throw new Error(`invalid ${body.format} document: ${invalid}`);
    for (const d of 'deps' in body ? body.deps : []) if (!documents.has(d)) throw new Error(`a ${body.format} depends on ${d}, which is not built yet`);
    const hash = hashOf(body);
    if (!documents.has(hash)) documents.set(hash, { hash, body });
    return hash;
  };
  const publish = (itemId: string, name: string, description: string, doc: LibraryDoc) => {
    items.push({ itemId, kind: kindOfDoc(doc), name, description, docHash: put(doc) });
  };

  const bookNames = readJson(join(LIBRARY, 'books.eng.json')) as Record<string, string>;
  const books = (codes: string[]) =>
    [...codes].sort((a, b) => bookOrder(a) - bookOrder(b)).map((book) => {
      const name = bookNames[book];
      if (!name) throw new Error(`library/books.eng.json has no name for ${book}`);
      return { book, name };
    });

  // 1. Versifications.
  const vHash: Record<string, string> = {};
  const vDoc: Record<string, VersificationDoc> = {};
  for (const v of VERSIFICATIONS) {
    vDoc[v.code] = versificationDoc(v.code, v.name);
    vHash[v.code] = put(vDoc[v.code]!);
    items.push({ itemId: `langquest.versification.${v.code}`, kind: 'versification', name: v.name, description: v.description, docHash: vHash[v.code]! });
  }
  const eng = vHash['eng']!;

  // 2. Templates.
  for (const v of VERSIFICATIONS) {
    const name = `Bible chapters (${v.short})`;
    const description = `Every book, divided into chapters, numbered as in the ${v.name} versification. Book names in English.`;
    publish(`langquest.template.bible-chapters-${v.code}`, name, description, {
      format: 'template@1', name, description, structure: 'bible', levels: [{ name: 'Book' }, { name: 'Chapter' }],
      bible: { versification: vHash[v.code]!, books: books(Object.keys(vDoc[v.code]!.maxVerses)), divide: 'chapters' }, deps: []
    } satisfies TemplateDocV1);
  }
  const engBooks = Object.keys(vDoc['eng']!.maxVerses);
  const template = (itemId: string, name: string, description: string, levels: string[], bible: Omit<NonNullable<TemplateDocV1['bible']>, 'versification'>) =>
    publish(itemId, name, description, {
      format: 'template@1', name, description, structure: 'bible', levels: levels.map((l) => ({ name: l })),
      bible: { versification: eng, ...bible }, deps: []
    } satisfies TemplateDocV1);
  template('langquest.template.bible-books-eng', 'Bible books (English)', 'The 66 books of the Protestant canon (no deuterocanon), one part per book.', ['Book'],
    { books: books(engBooks.filter((b) => bookOrder(b) <= NT_LAST)), divide: 'books' });
  template('langquest.template.nt-chapters-eng', 'New Testament chapters (English)', 'The New Testament, divided into chapters, numbered as in English Bibles.', ['Book', 'Chapter'],
    { books: books(engBooks.filter((b) => bookOrder(b) >= NT_FIRST && bookOrder(b) <= NT_LAST)), divide: 'chapters' });
  const fiaPassages = FIA_PERICOPES.map((p) => ({ ref: `${usfmOf(p.book)} ${p.verseRange}` }));
  template('langquest.template.fia-passages-eng', 'FIA passages (English)', "The passages FIA divides the Bible into, in FIA's order, numbered as in English Bibles.", ['Book', 'Passage'],
    { books: books([...new Set(fiaPassages.map((p) => parseRef(p.ref)!.book))]), divide: 'passages', passages: fiaPassages });

  // 2b. The numberings an admin chooses from (decision 80): a source
  // versification with exactly one tradition's books, carrying every
  // Paratext mapping line (library/versifications/paratext/).
  const numbering: Record<string, { doc: VersificationDoc; hash: string; books: { book: string; name: string }[] }> = {};
  for (const n of NUMBERINGS) {
    const src = vDoc[n.from]!;
    const more = missingMappings(src, paratextMappings(readFileSync(join(LIBRARY, 'versifications', 'paratext', `${n.from}.vrs`), 'utf8')));
    const full = more.length ? { ...src, moreMappedVerses: more } : src;
    const doc = numberingOf(full, n.books, n.name);
    const hash = put(doc);
    items.push({ itemId: `langquest.numbering.${n.id}`, kind: 'versification', name: n.name, description: n.description, docHash: hash });
    numbering[n.id] = { doc, hash, books: books(n.books) };
  }

  // 2c. Ways to break up the Bible (decisions 74 and 80), each published in
  // every numbering: written once in English numbering, converted into the
  // others (core convertWay). The English ones keep their item ids. The
  // items above stay as they are for the languages that use them; a new
  // version of them would move those languages' parts.
  const engWays = breakupWays(books(engBooks.filter((b) => bookOrder(b) <= NT_LAST)), vDoc['eng']!);
  for (const way of engWays) {
    const source: TemplateDocV2 = {
      format: 'template@2', name: way.name, description: way.description, structure: 'bible',
      levels: [{ name: 'Book' }, { name: way.part }],
      bible: { versification: eng, books: way.books },
      ...(way.goesWith ? { goesWith: { pattern: way.goesWith } } : {}),
      deps: []
    };
    for (const n of NUMBERINGS) {
      const target = numbering[n.id]!;
      const doc = convertWay(source, numbering['eng-66']!.doc, target);
      const description = `${way.description} ${n.short}.`;
      publish(n.id === 'eng-66' ? `langquest.bible.${way.slug}` : `langquest.bible.${way.slug}.${n.id}`, way.name, description, { ...doc, description });
    }
  }

  // 3. Flows, each carrying the kinds it uses.
  for (const f of FLOWS) {
    const used = new Set(f.steps.flatMap((s) => s.kindIds));
    publish(`langquest.flow.${f.id}`, f.name, f.description, {
      format: 'flow@1', name: f.name, description: f.description,
      kinds: DEFAULT_KINDS.filter((k) => used.has(k.id)),
      steps: f.steps.map((s) => ({ stepId: s.stepId, kindIds: [...s.kindIds], ...(s.checkpoint ? { checkpoint: true } : {}) })),
      deps: []
    } satisfies FlowDoc);
  }

  // 4. Question sets.
  for (const q of QUESTION_TEMPLATES) {
    const reviewKindId = QUESTION_KIND[q.id];
    if (!reviewKindId) throw new Error(`no review kind for question set ${q.id}`);
    const kind = DEFAULT_KINDS.find((k) => k.id === reviewKindId)!;
    publish(`langquest.questions.${q.id}`, q.name, `Questions to ask in a ${kind.name}.`, {
      format: 'material@1', kind: 'questions', title: q.name, reviewKindId,
      questions: q.questions.map((x) => ({ id: x.id, text: x.text, type: x.type, required: false })),
      deps: []
    } satisfies MaterialDoc);
  }

  // 5. FIA study guides, one collection per language.
  const guides = new Map<string, { name: string; entries: { ref: string; title: string; doc: string }[] }>();
  const addGuide = (lang: string, langName: string, doc: StudyDoc) => {
    const g = guides.get(lang) ?? { name: langName, entries: [] };
    g.entries.push({ ref: doc.ref, title: doc.title, doc: put(doc) });
    guides.set(lang, g);
  };
  for (const json of fiaFiles([DEFAULT_FIA_DIR, ...(opts.fiaDirs ?? [])]).values()) {
    for (const lang of fiaLanguages(json)) {
      const doc = fiaStudyDoc(json, lang.id, eng);
      if (doc) addGuide(lang.id, lang.name, doc);
    }
  }
  // The two guides written for the partner demo in FIA's format are not
  // FIA's content, so they are their own collection, and only published
  // when asked for (not by default on a hosted project).
  const examples: { ref: string; title: string; doc: string }[] = [];
  if (opts.examples ?? true) {
    for (const f of readdirSync(DEFAULT_FIA_DIR).filter((n) => n.endsWith('.study.json')).sort()) {
      const src = readJson(join(DEFAULT_FIA_DIR, f)) as Omit<StudyDoc, 'versification'> & { versification: string };
      const hash = vHash[src.versification];
      if (!hash) throw new Error(`${f}: unknown versification ${src.versification}`);
      const doc = { ...src, versification: hash };
      examples.push({ ref: doc.ref, title: doc.title, doc: put(doc) });
    }
  }
  const refOrder = (ref: string) => {
    const r = parseRef(ref)!;
    return [bookOrder(r.book), r.start.chapter, r.start.verse] as const;
  };
  for (const [lang, g] of [...guides].sort(([a], [b]) => (a === 'eng' ? -1 : b === 'eng' ? 1 : a < b ? -1 : 1))) {
    const entries = [...g.entries].sort((a, b) => {
      const [x, y] = [refOrder(a.ref), refOrder(b.ref)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (a.doc < b.doc ? -1 : 1);
    });
    const title = `FIA study guides (${g.name})`;
    const description = `FIA's study guides in ${g.name}, found by the verses a passage covers. ${FIA_ATTRIBUTION}.`;
    publish(`langquest.fia.${lang}`, title, description, {
      format: 'collection@1', title, description, language: lang, pattern: 'FIA', versification: eng, entries, deps: []
    } satisfies CollectionDoc);
  }

  if (examples.length) {
    const title = 'Example study guides (English)';
    const description = "Written for the partner demo in FIA's format; not FIA's own content.";
    const inOrder = [...examples].sort((a, b) => {
      const [x, y] = [refOrder(a.ref), refOrder(b.ref)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    publish('langquest.examples.eng', title, description, {
      format: 'collection@1', title, description, language: 'eng', versification: eng, entries: inOrder, deps: []
    } satisfies CollectionDoc);
  }

  return { documents: [...documents.values()], items };
}

// ---- ways to break up the Bible ---------------------------------------------------------

/** OpenBible.info's OSIS book names, as USFM codes. */
const OSIS: Record<string, string> = {
  Gen: 'GEN', Exod: 'EXO', Lev: 'LEV', Num: 'NUM', Deut: 'DEU', Josh: 'JOS', Judg: 'JDG', Ruth: 'RUT', '1Sam': '1SA', '2Sam': '2SA',
  '1Kgs': '1KI', '2Kgs': '2KI', '1Chr': '1CH', '2Chr': '2CH', Ezra: 'EZR', Neh: 'NEH', Esth: 'EST', Job: 'JOB', Ps: 'PSA', Prov: 'PRO',
  Eccl: 'ECC', Song: 'SNG', Isa: 'ISA', Jer: 'JER', Lam: 'LAM', Ezek: 'EZK', Dan: 'DAN', Hos: 'HOS', Joel: 'JOL', Amos: 'AMO',
  Obad: 'OBA', Jonah: 'JON', Mic: 'MIC', Nah: 'NAM', Hab: 'HAB', Zeph: 'ZEP', Hag: 'HAG', Zech: 'ZEC', Mal: 'MAL', Matt: 'MAT',
  Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT', Rom: 'ROM', '1Cor': '1CO', '2Cor': '2CO', Gal: 'GAL', Eph: 'EPH', Phil: 'PHP',
  Col: 'COL', '1Thess': '1TH', '2Thess': '2TH', '1Tim': '1TI', '2Tim': '2TI', Titus: 'TIT', Phlm: 'PHM', Heb: 'HEB', Jas: 'JAS',
  '1Pet': '1PE', '2Pet': '2PE', '1John': '1JN', '2John': '2JN', '3John': '3JN', Jude: 'JUD', Rev: 'REV'
};

interface Way {
  slug: string;
  name: string;
  description: string;
  part: string;
  goesWith?: string;
  books: TemplateBook[];
}

/** "1:19b" -> [1, 19, "b"]. */
const at = (s: string) => {
  const m = /^(\d+):(\d+)([a-z]?)$/.exec(s.trim());
  if (!m) throw new Error(`unreadable verse ${s}`);
  return { c: Number(m[1]), v: Number(m[2]), part: m[3] ?? '' };
};

/** Passages from where each starts, the last running to the end of the book. */
function fromStarts(book: string, starts: { c: number; v: number }[], v11n: VersificationDoc): { ref: string }[] {
  const max = v11n.maxVerses[book] ?? [];
  const sorted = [...starts].sort((a, b) => a.c - b.c || a.v - b.v).filter((s, i, all) => i === 0 || s.c !== all[i - 1]!.c || s.v !== all[i - 1]!.v);
  return sorted.map((s, i) => {
    const next = sorted[i + 1];
    let end: { c: number; v: number };
    if (next) end = next.v > 1 ? { c: next.c, v: next.v - 1 } : { c: next.c - 1, v: max[next.c - 2] ?? 1 };
    else end = { c: max.length, v: max[max.length - 1] ?? 1 };
    if (s.c === end.c) return { ref: s.v === end.v ? `${book} ${s.c}:${s.v}` : `${book} ${s.c}:${s.v}-${end.v}` };
    return { ref: `${book} ${s.c}:${s.v}-${end.c}:${end.v}` };
  });
}

/**
 * The ways LangQuest offers (decision 74): by chapter; FIA's passages
 * (library/fia/pericopes.tsv, FIA's API list); unfoldingWord's chunks
 * (library/divisions/unfoldingword-chunks.json); OpenBible.info's sections
 * where at least 15, 10 or 5 of 20 English Bibles start one
 * (library/divisions/openbible-section-counts.tsv); and every book left to
 * break up later.
 */
export function breakupWays(books: { book: string; name: string }[], v11n: VersificationDoc): Way[] {
  const chapters = (part: string) => books.map((b) => ({ ...b, divide: 'chapters' as const, part }));
  const passages = (part: string, byBook: Map<string, { ref: string }[]>) =>
    books.map((b): TemplateBook => {
      const list = byBook.get(b.book);
      return list && list.length ? { ...b, divide: 'passages', part, passages: list } : { ...b };
    });

  // FIA, in FIA's order within each book.
  const fiaRows = readFileSync(join(LIBRARY, 'fia', 'pericopes.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  const fia = new Map<string, { seq: number; split: string; ref: string }[]>();
  for (const [, bookId, , seq, split, start, end] of fiaRows) {
    const book = usfmOf(bookId!);
    const a = at(start!);
    const b = at(end!);
    const ref = a.c === b.c ? `${book} ${start}-${b.v}${b.part}` : `${book} ${start}-${end}`;
    if (!parseRef(ref)) throw new Error(`FIA passage ${ref} does not read`);
    fia.set(book, [...(fia.get(book) ?? []), { seq: Number(seq), split: split ?? '', ref }]);
  }
  const fiaByBook = new Map([...fia].map(([book, list]) => [book, list.sort((x, y) => x.seq - y.seq || (x.split < y.split ? -1 : 1)).map((p) => ({ ref: p.ref }))]));

  const uw = (readJson(join(LIBRARY, 'divisions', 'unfoldingword-chunks.json')) as { starts: Record<string, string[]> }).starts;
  const uwByBook = new Map(Object.entries(uw).map(([book, starts]) => [book, fromStarts(book, starts.map(at), v11n)]));

  const counts = new Map<string, number>();
  for (const line of readFileSync(join(LIBRARY, 'divisions', 'openbible-section-counts.tsv'), 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [start, , , n] = line.split('\t');
    counts.set(start!, (counts.get(start!) ?? 0) + Number(n));
  }
  const openBible = (atLeast: number) => {
    const starts = new Map<string, { c: number; v: number }[]>();
    for (const [start, n] of counts) {
      const [osis, c, v] = start.split('.');
      const book = OSIS[osis!];
      if (!book) throw new Error(`unknown OpenBible book ${osis}`);
      if (n < atLeast && !(c === '1' && v === '1')) continue;
      starts.set(book, [...(starts.get(book) ?? []), { c: Number(c), v: Number(v) }]);
    }
    return new Map([...starts].map(([book, s]) => [book, fromStarts(book, s, v11n)]));
  };
  const OB = 'Section breaks from OpenBible.info (openbible.info/labs/bible-section-sankeys), CC BY 4.0.';
  return [
    { slug: 'chapters', name: 'By chapter', part: 'Chapter', description: 'Every book, one part a chapter, numbered as in English Bibles.', books: chapters('Chapter') },
    {
      slug: 'fia', name: 'FIA passages', part: 'Passage', goesWith: 'FIA',
      description: `The passages FIA divides the Bible into, in FIA's order; books FIA has no passages for wait to be broken up. Made for FIA's study guides. ${FIA_ATTRIBUTION}.`,
      books: passages('Passage', fiaByBook)
    },
    {
      slug: 'unfoldingword', name: 'unfoldingWord chunks', part: 'Chunk',
      description: "Short pieces of two or three verses, where unfoldingWord's Unlocked Literal Bible marks its chunks (api.unfoldingword.org). unfoldingWord, CC BY-SA 4.0.",
      books: passages('Chunk', uwByBook)
    },
    { slug: 'openbible-long', name: 'OpenBible: long sections', part: 'Section', description: `Sections where at least 15 of 20 English Bibles start one. ${OB}`, books: passages('Section', openBible(15)) },
    { slug: 'openbible-usual', name: 'OpenBible: usual sections', part: 'Section', description: `Sections where at least 10 of 20 English Bibles start one. ${OB}`, books: passages('Section', openBible(10)) },
    { slug: 'openbible-short', name: 'OpenBible: short sections', part: 'Section', description: `Sections where at least 5 of 20 English Bibles start one. ${OB}`, books: passages('Section', openBible(5)) },
    { slug: 'book-by-book', name: 'Book by book', part: 'Passage', description: 'Every book, waiting to be broken up one at a time.', books: books.map((b) => ({ ...b })) }
  ];
}

// ---- events -------------------------------------------------------------------------

const short = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 12);

/**
 * The org events that publish a build. Each id is decided by its content, so
 * a second run sends only what changed. `now` stamps the clocks, rising in
 * the order given, so a new version is the item's latest (the server
 * restamps them with its own clock, in the same order).
 */
export function seedEvents(build: SeedBuild, now: number): AnyEvent[] {
  let counter = 0;
  const envelope = (id: string, type: string, payload: Record<string, unknown>) => ({
    id, type, orgId: SEED_ORG.id, streamId: ORG_STREAM, actorId: 'service', deviceId: 'library-seed',
    hlc: encodeHlc(now, counter++, 'library-seed'), payload
  }) as unknown as AnyEvent;
  const out: AnyEvent[] = [envelope(`seed:${SEED_ORG.id}:created`, 'v1.OrgCreated', { name: SEED_ORG.name })];
  for (const it of build.items) {
    const defined = { itemId: it.itemId, kind: it.kind, name: it.name, description: it.description };
    const sharing = { itemId: it.itemId, kind: it.kind, shared: true, subscribable: true };
    out.push(envelope(`seed:${it.itemId}:defined:${short(defined)}`, 'v1.LibraryItemDefined', defined));
    out.push(envelope(`seed:${it.itemId}:${it.docHash}`, 'v1.LibraryVersionPublished', { itemId: it.itemId, kind: it.kind, docHash: it.docHash }));
    out.push(envelope(`seed:${it.itemId}:sharing:${short(sharing)}`, 'v1.LibrarySharingSet', sharing));
  }
  return out;
}

// ---- publishing -----------------------------------------------------------------------

function summary(build: SeedBuild, events: AnyEvent[]): string {
  const byFormat = new Map<string, number>();
  for (const d of build.documents) byFormat.set(d.body.format, (byFormat.get(d.body.format) ?? 0) + 1);
  const lines = [
    `${build.documents.length} documents (${[...byFormat].map(([f, n]) => `${n} ${f}`).join(', ')})`,
    `${build.items.length} items, ${events.length} events`,
    ...build.items.map((it) => `  ${it.docHash}  ${it.kind.padEnd(13)} ${it.itemId}  ${it.name}`)
  ];
  return lines.join('\n');
}

async function main(argv: string[]) {
  const values = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
  // The demo's example guides go to a hosted project only with --with-examples.
  const build = buildLibrary({ fiaDirs: values('fia-dir'), examples: !argv.includes('--hosted') || argv.includes('--with-examples') });
  if (argv.includes('--sources')) {
    const versifications = build.items.filter((it) => it.kind === 'versification').map((it) => {
      const body = build.documents.find((d) => d.hash === it.docHash)!.body as VersificationDoc;
      return { code: body.code, hash: it.docHash, books: Object.keys(body.maxVerses) };
    });
    const sources = await sourcesFor(versifications, { timingsDir: values('timings')[0], bsbTextPath: values('bsb-text')[0], key: process.env['BIBLE_BRAIN_ACCESS_KEY'] });
    const have = new Set(build.documents.map((d) => d.hash));
    build.documents.push(...sources.documents.filter((d) => !have.has(d.hash)));
    build.items.push(...sources.items);
  }
  const events = seedEvents(build, Date.now());
  console.log(summary(build, events));
  if (argv.includes('--dry-run')) return;

  const url = process.env['SUPABASE_URL'] ?? LOCAL_URL;
  if (!isLocalUrl(url) && !argv.includes('--hosted')) {
    throw new Error(`${url} is not local; seeding a hosted project needs --hosted and the owner's go-ahead`);
  }
  const key = supabaseKey('SUPABASE_SERVICE_ROLE_KEY', url);
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false } });

  // The server names a document by the SHA-256 of the text it is sent, so it is sent canonical.
  for (const d of build.documents) {
    const { data, error } = await db.rpc('library_seed_document', { p_org: SEED_ORG.id, p_body: canonicalJson(d.body) });
    if (error) throw new Error(`library_seed_document ${d.hash}: ${error.message}`);
    if (data !== d.hash) throw new Error(`the server named ${d.body.format} ${d.hash} ${String(data)}`);
  }
  console.log(`documents: ${build.documents.length} stored`);

  // The server stamps its own clock, in the order sent, and skips ids it already has.
  let appended = 0;
  for (let i = 0; i < events.length; i += 200) {
    const batch = events.slice(i, i + 200).map((e) => ({ id: e.id, type: e.type, actorId: e.actorId, payload: e.payload }));
    const { data, error } = await db.rpc('library_seed_events', { p_org: SEED_ORG.id, p_events: batch });
    if (error) throw new Error(`library_seed_events: ${error.message}`);
    appended += Number(data ?? 0);
  }
  console.log(`events: ${events.length} sent, ${appended} new`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
