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
  bookOrder, canonicalJson, DEFAULT_KINDS, encodeHlc, FIA_PERICOPES, FLOWS, kindOfDoc, ORG_PARTITION, parseRef,
  QUESTION_TEMPLATES, usfmOf, validateDoc, withDeps,
  type AnyEvent, type CollectionDoc, type FlowDoc, type LibraryDoc, type LibraryKind, type MaterialDoc, type StudyDoc,
  type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { FIA_ATTRIBUTION, fiaLanguages, fiaPericope, fiaStudyDoc } from './fia-adapter';
import { sourcesFor } from './sources-seed';

export const SEED_ORG = { id: 'langquest', name: 'LangQuest' } as const;

const LIBRARY = fileURLToPath(new URL('../library/', import.meta.url));
export const DEFAULT_FIA_DIR = join(LIBRARY, 'fia');

/** The standard systems (library/versifications, from versification-tool), in the order people meet them. */
const VERSIFICATIONS: { code: string; name: string; short: string; description: string }[] = [
  { code: 'eng', name: 'English', short: 'English', description: 'Verse numbers as in most English Bibles.' },
  { code: 'org', name: 'Original (Hebrew and Greek)', short: 'Original', description: 'Verse numbers of the Hebrew and Greek texts, which every other system is mapped to.' },
  { code: 'lxx', name: 'Septuagint', short: 'Septuagint', description: 'Verse numbers of the Greek Old Testament.' },
  { code: 'vul', name: 'Vulgate', short: 'Vulgate', description: 'Verse numbers of the Latin Vulgate, as many Catholic Bibles use them.' },
  { code: 'rso', name: 'Russian Orthodox', short: 'Russian Orthodox', description: 'Verse numbers of the Russian Synodal Bible with the deuterocanon.' },
  { code: 'rsc', name: 'Russian Protestant', short: 'Russian Protestant', description: 'Verse numbers of the Russian Synodal Bible, 66 books.' }
];

const NT_FIRST = bookOrder('MAT');
const NT_LAST = bookOrder('REV');

/** The review kind each question set is for. */
const QUESTION_KIND: Record<string, string> = { community_check: 'community', consultant_check: 'consultant' };

export interface SeedDocument {
  hash: string;
  body: LibraryDoc;
}

export interface SeedItem {
  itemId: string;
  kind: LibraryKind;
  name: string;
  description: string;
  docHash: string;
}

export interface SeedBuild {
  /** Every document, each after the documents it depends on. */
  documents: SeedDocument[];
  items: SeedItem[];
}

export const hashOf = (doc: LibraryDoc) => createHash('sha256').update(canonicalJson(doc)).digest('hex');

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
    } satisfies TemplateDoc);
  }
  const engBooks = Object.keys(vDoc['eng']!.maxVerses);
  const template = (itemId: string, name: string, description: string, levels: string[], bible: Omit<NonNullable<TemplateDoc['bible']>, 'versification'>) =>
    publish(itemId, name, description, {
      format: 'template@1', name, description, structure: 'bible', levels: levels.map((l) => ({ name: l })),
      bible: { versification: eng, ...bible }, deps: []
    } satisfies TemplateDoc);
  template('langquest.template.bible-books-eng', 'Bible books (English)', 'The 66 books of the Protestant canon (no deuterocanon), one part per book.', ['Book'],
    { books: books(engBooks.filter((b) => bookOrder(b) <= NT_LAST)), divide: 'books' });
  template('langquest.template.nt-chapters-eng', 'New Testament chapters (English)', 'The New Testament, divided into chapters, numbered as in English Bibles.', ['Book', 'Chapter'],
    { books: books(engBooks.filter((b) => bookOrder(b) >= NT_FIRST && bookOrder(b) <= NT_LAST)), divide: 'chapters' });
  const fiaPassages = FIA_PERICOPES.map((p) => ({ ref: `${usfmOf(p.book)} ${p.verseRange}` }));
  template('langquest.template.fia-passages-eng', 'FIA passages (English)', "The passages FIA divides the Bible into, in FIA's order, numbered as in English Bibles.", ['Book', 'Passage'],
    { books: books([...new Set(fiaPassages.map((p) => parseRef(p.ref)!.book))]), divide: 'passages', passages: fiaPassages });

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
      format: 'collection@1', title, description, language: lang, versification: eng, entries, deps: []
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
    id, type, orgId: SEED_ORG.id, projectId: ORG_PARTITION, actorId: 'service', deviceId: 'library-seed',
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
