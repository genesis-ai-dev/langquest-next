import type { KindDef, QuestionSpec } from './record';
import { parseRef, type VersificationDoc } from './versification';

/**
 * Library documents (docs/decisions.md 36).
 *
 * Content templates, review flows, reference material and versifications
 * are published as immutable documents named by the SHA-256 of their
 * canonical JSON. The log never carries a document, only its hash: a
 * version is published by naming one (`v1.LibraryVersionPublished`), a
 * language uses one by naming it, and every device fetches what it names.
 * A document may depend on others (a template on its versification, a
 * collection on its study guides); those hashes are listed in `deps` so the
 * server can share or copy them together.
 *
 * Pure: shapes, canonical text and validation. Hashing happens in the
 * client and in SQL, over the same canonical text.
 */

export type LibraryKind = 'template' | 'flow' | 'material' | 'versification';
export const LIBRARY_KINDS: readonly LibraryKind[] = ['template', 'flow', 'material', 'versification'];

/** How a level's parts read in lists (TPL-9). */
export type LevelDisplay = 'reference' | 'name' | 'both';

export interface OutlineNode {
  /** Stable across versions; becomes part of the unit id. No '/' or '@'. */
  id: string;
  title: string;
  children?: OutlineNode[];
}

/**
 * A content template: what a language translates, in what order and
 * hierarchy (TPL-1). A Bible template names its versification, the books
 * it covers with their names in the language, and how they divide: whole
 * books, chapters, or passages given as verse ranges. An outline template
 * is a tree built by hand (lessons, stories, health notices).
 */
export interface TemplateDocV1 {
  format: 'template@1';
  name: string;
  description: string;
  structure: 'bible' | 'outline';
  /** What each level is called, top first: Book, Chapter, Passage, or Module, Lesson. */
  levels: { name: string; display?: LevelDisplay }[];
  bible?: {
    /** Hash of the versification document the references are in. */
    versification: string;
    books: { book: string; name: string }[];
    divide: 'books' | 'chapters' | 'passages';
    /** For `passages`: ranges in book order ("GEN 1:1-2:3"), each with an optional name. */
    passages?: { ref: string; name?: string }[];
  };
  outline?: OutlineNode[];
  deps: string[];
}

/**
 * One book of a `template@2` Bible: how it is broken up, if that is decided.
 * Without `divide` the book is listed with nothing in it yet: it waits for
 * someone to break it up (decision 74).
 */
export interface TemplateBook {
  book: string;
  /** The template's name for it; a language may call it something else (`v1.BookNameSet`). */
  name: string;
  /**
   * `chapters`: one part a chapter. `passages`: the ranges listed.
   * `book`: the whole book as one part (only to carry a `template@1`
   * "books" template over unchanged; nothing offers it).
   */
  divide?: 'book' | 'chapters' | 'passages';
  /** What one part is called in this book: "Chapter", "Passage", "Chunk", "Section". */
  part?: string;
  /** For `passages`: verse ranges inside this book, in order ("RUT 1:1-7"), each with an optional name. */
  passages?: { ref: string; name?: string }[];
}

/**
 * A content template whose Bible books are broken up one by one
 * (decision 74): each book says how it divides, or nothing yet. Unit ids
 * are the same as `template@1`'s (`GEN`, `GEN.1`, `GEN.1.1-2.3`), so a
 * language can move between the two without losing its parts. `goesWith`
 * names the study material made for this way of dividing: guides that
 * follow that pattern ("FIA") match its passages exactly.
 */
export interface TemplateDocV2 {
  format: 'template@2';
  name: string;
  description: string;
  structure: 'bible' | 'outline';
  levels: { name: string; display?: LevelDisplay }[];
  bible?: {
    versification: string;
    books: TemplateBook[];
  };
  outline?: OutlineNode[];
  goesWith?: { pattern: string };
  deps: string[];
}

/** Either version of a content template. Read a Bible one's books with `templateBooks`. */
export type TemplateDoc = TemplateDocV1 | TemplateDocV2;

/** Whether a document is a content template of either version. */
export const isTemplateDoc = (doc: { format: string } | null | undefined): doc is TemplateDoc =>
  doc?.format === 'template@1' || doc?.format === 'template@2';

/**
 * A Bible template's books as `template@2` says them, whichever version it
 * is: a `template@1` gives every book its one divide, its passages and its
 * last level's name. Books keep the template's order.
 */
export function templateBooks(doc: TemplateDoc): TemplateBook[] {
  const bible = doc.bible;
  if (!bible) return [];
  if (doc.format === 'template@2') return (bible as NonNullable<TemplateDocV2['bible']>).books;
  const b1 = bible as NonNullable<TemplateDocV1['bible']>;
  const part = doc.levels[doc.levels.length - 1]?.name;
  const byBook = new Map<string, { ref: string; name?: string }[]>();
  if (b1.divide === 'passages') {
    for (const p of b1.passages ?? []) {
      const r = parseRef(p.ref);
      if (!r) continue;
      byBook.set(r.book, [...(byBook.get(r.book) ?? []), p]);
    }
  }
  return b1.books.map((b) => ({
    book: b.book,
    name: b.name,
    divide: b1.divide === 'books' ? 'book' : b1.divide,
    ...(part && b1.divide !== 'books' ? { part } : {}),
    ...(b1.divide === 'passages' ? { passages: byBook.get(b.book) ?? [] } : {})
  }));
}

/**
 * The same template as a `template@2`, ready for one book to change: every
 * book and part keeps its id, so nothing recorded moves.
 */
export function asTemplateV2(doc: TemplateDoc): TemplateDocV2 {
  if (doc.format === 'template@2') return doc;
  return {
    format: 'template@2',
    name: doc.name,
    description: doc.description,
    structure: doc.structure,
    levels: doc.levels,
    ...(doc.bible ? { bible: { versification: doc.bible.versification, books: templateBooks(doc) } } : {}),
    ...(doc.outline ? { outline: doc.outline } : {}),
    deps: doc.deps
  };
}

/** A review flow (FLOW-1..3), carrying the kinds it uses so it travels whole. */
export interface FlowDoc {
  format: 'flow@1';
  name: string;
  description: string;
  kinds: KindDef[];
  steps: { stepId: string; kindIds: string[]; checkpoint?: boolean }[];
  deps: string[];
}

/** Media a study step's text points at ("m387" a picture, "c47" a map, "t63" a term). */
export interface StudyResourceDoc {
  ref: string;
  kind: 'media' | 'map' | 'term';
  title: string;
  description?: string;
  media?: { id: string; kind: 'photo' | 'map' | 'illustration' | 'video'; title: string; caption: string; url?: string }[];
}

/**
 * Rich study material for one passage (FIA and anything shaped like it):
 * steps of markdown with audio, grouped in phases, with the pictures, maps
 * and glossary entries the text points at. Made on the website or imported
 * by an adapter; read in the app.
 */
export interface StudyDoc {
  format: 'study@1';
  title: string;
  /** The method every guide of this kind follows ("FIA"). */
  pattern: string;
  about: string;
  /** Where it came from: "fia.bible · English". */
  source: string;
  /** BCP-47-ish language of the text ("eng"). */
  language: string;
  /** The passage it covers, in its versification. */
  ref: string;
  versification: string;
  steps: { id: string; title: string; phase?: string; purpose?: string; text: string; audio?: { url?: string; seconds?: number } }[];
  resources: StudyResourceDoc[];
  terms: { id: string; term: string; hint?: string; body: string; audioUrl?: string }[];
  deps: string[];
}

/** Study guides for many passages, found by verse overlap (e.g. all of FIA in one language). */
export interface CollectionDoc {
  format: 'collection@1';
  title: string;
  description: string;
  /** Language of its guides ("eng"), when they share one; lets a reader prefer their own. */
  language?: string;
  /** The method its guides follow ("FIA"); a template made for it says so in `goesWith` (decision 74). */
  pattern?: string;
  versification: string;
  entries: { ref: string; title: string; doc: string }[];
  deps: string[];
}

/** Where a simple material applies: verse ranges, or parts of a content template. */
export type MaterialLink = { ref: string } | { template: string; node: string };

/**
 * Simple reference material made in the app or on the website: a document
 * (TMF, brief, guidelines, a note on HIV awareness), a question set for a
 * kind of review, or a key-term list.
 */
export interface MaterialDoc {
  format: 'material@1';
  /** tmf, brief, tg, questions, key_terms, document, or a partner's own. */
  kind: string;
  title: string;
  body?: string;
  fields?: { id: string; label?: string; text: string }[];
  questions?: QuestionSpec[];
  /** For a question set: the kind of review it is for. */
  reviewKindId?: string;
  terms?: { id: string; term: string; gloss: string; match?: string[] }[];
  /** Links by verse reference are in this versification. */
  versification?: string;
  links?: MaterialLink[];
  deps: string[];
}

/** Callout kinds a guide's text may use (`> [!kind] text`); FIA writes `action` ("Stop here"). */
export const CALLOUT_KINDS = ['action', 'note', 'question', 'culture', 'warning'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Audio or a picture that is a URL elsewhere, a blob here (by SHA-256), or both. */
export interface MediaRef {
  url?: string;
  /** SHA-256 of the bytes in the blob store; what an authored guide uses, and what goes offline. */
  hash?: string;
  /** A smaller copy for phones (pictures 500px, video 360p). */
  lowHash?: string;
  format?: string;
  seconds?: number;
}

/**
 * A study guide an organization writes (the guide editor), or FIA's
 * material carried with its media as blobs: `study@1` plus a hash beside
 * every URL, callout kinds, a license and credit, and placement by template
 * node for languages whose template is not numbered by verse.
 */
export interface StudyDoc2 {
  format: 'study@2';
  title: string;
  pattern: string;
  about: string;
  source: string;
  language: string;
  /** The passage, in `versification`; absent when the guide is placed only by `links`. */
  ref?: string;
  versification?: string;
  links?: MaterialLink[];
  license?: string;
  credit?: string;
  steps: { id: string; title: string; phase?: string; purpose?: string; text: string; audio?: MediaRef }[];
  resources: { ref: string; kind: 'media' | 'map' | 'term'; title: string; description?: string; media?: { id: string; kind: 'photo' | 'map' | 'illustration' | 'video'; title: string; caption: string; file: MediaRef }[] }[];
  terms: { id: string; term: string; hint?: string; body: string; audio?: MediaRef }[];
  deps: string[];
}

/**
 * A source to read and hear: a Bible edition, or any text with audio keyed
 * by coordinates (docs/reference-material.md). Text and audio come from our
 * blob store (`provider.kind: 'library'`, open licenses) or live from Bible
 * Brain through our server (`'biblebrain'`), where `offline` says whether
 * phones may keep them (only filesets `/download` allows, inside the app).
 */
export interface SourceDoc {
  format: 'source@1';
  name: string;
  abbreviation: string;
  /** ISO 639-3. */
  language: string;
  description?: string;
  versification: string;
  provider:
    | { kind: 'library' }
    | { kind: 'biblebrain'; bibleId: string; text?: { OT?: string; NT?: string }; audio?: { OT?: string; NT?: string } };
  offline: 'allowed' | 'stream';
  copyright: { text?: string; audio?: string };
  license?: string;
  /** The books it has, in canon order; `doc` is the book's `sourceBook@1` when it carries text, audio or timings here. */
  books: { book: string; name: string; doc?: string }[];
  deps: string[];
}

/** One book of a source: per chapter its verses (open text), its audio and the verse timings for that audio. */
export interface SourceBookDoc {
  format: 'sourceBook@1';
  book: string;
  chapters: {
    chapter: number;
    /** `[verseStart, verseEnd, text]`; a bridge is one row (`[38, 39, "…"]`). */
    verses?: [number, number, string][];
    audio?: MediaRef & { durationMs?: number };
    /** The `timing@1` document for this chapter's audio. */
    timing?: string;
  }[];
  deps: string[];
}

/**
 * Where each verse starts and ends in one recording. Named by the
 * recording's SHA-256 and the versification, so any text with the same
 * verse numbers can be highlighted against it: text and audio stay
 * independent. Written by fia-align (`source: 'ctc'`), copied from FCBH
 * (`'fcbh'`), or corrected by a person (`'manual'`).
 */
export interface TimingDoc {
  format: 'timing@1';
  book: string;
  chapter: number;
  versification: string;
  audio: { sha256: string; durationMs: number; bytes?: number; codec?: string; source?: Record<string, string> };
  text?: { sha256: string; source?: Record<string, string> };
  introEndMs: number;
  segments: { verseStart: number; verseEnd: number; startMs: number; endMs: number; score?: number }[];
  source: 'ctc' | 'fcbh' | 'manual';
  aligner?: Record<string, string>;
  check?: { ok: boolean; maxDeviation?: number; meanDeviation?: number; flags?: { verseStart: number; reason: string }[] };
  deps: string[];
}

export type LibraryDoc = TemplateDocV1 | TemplateDocV2 | FlowDoc | StudyDoc | StudyDoc2 | CollectionDoc | MaterialDoc | SourceDoc | SourceBookDoc | TimingDoc | VersificationDoc;

/** The library kind a document is published under. */
export function kindOfDoc(doc: LibraryDoc): LibraryKind {
  switch (doc.format) {
    case 'template@1': case 'template@2': return 'template';
    case 'flow@1': return 'flow';
    case 'versification@1': return 'versification';
    default: return 'material';
  }
}

// ---- canonical text ------------------------------------------------------------

/**
 * JSON with object keys sorted at every level and no whitespace. Arrays keep
 * their order. The same value always gives the same text, so the same
 * document always gets the same hash, on any device and on the server.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.keys(value as object)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

/** A SHA-256 hex digest, as the server and the blob store write them. */
export const isHash = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

// ---- validation ----------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string' && v !== '';
const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const NODE_ID = /^[^/@\s]+$/;

/** Every hash a document refers to, so `deps` can be checked (and shared together). */
export function referencedDocs(doc: LibraryDoc): string[] {
  const out = new Set<string>();
  switch (doc.format) {
    case 'template@1': case 'template@2': if (doc.bible) out.add(doc.bible.versification); break;
    case 'study@1': out.add(doc.versification); break;
    case 'collection@1':
      out.add(doc.versification);
      for (const e of doc.entries) out.add(e.doc);
      break;
    case 'material@1': if (doc.versification) out.add(doc.versification); break;
    case 'study@2': if (doc.versification) out.add(doc.versification); break;
    case 'source@1':
      out.add(doc.versification);
      for (const b of doc.books) if (b.doc) out.add(b.doc);
      break;
    case 'sourceBook@1':
      for (const c of doc.chapters) if (c.timing) out.add(c.timing);
      break;
    case 'timing@1': out.add(doc.versification); break;
    default: break;
  }
  return [...out].sort();
}

function outlineError(nodes: unknown, seen: Set<string>): string | null {
  if (!Array.isArray(nodes)) return 'outline must be an array';
  for (const n of nodes) {
    if (!isObj(n) || !str(n['id']) || !str(n['title'])) return 'outline nodes need an id and a title';
    if (!NODE_ID.test(n['id'] as string)) return `outline id ${String(n['id'])} may not contain '/', '@' or spaces`;
    if (seen.has(n['id'] as string)) return `outline id ${String(n['id'])} is repeated`;
    seen.add(n['id'] as string);
    if (n['children'] !== undefined) {
      const e = outlineError(n['children'], seen);
      if (e) return e;
    }
  }
  return null;
}

const mediaOk = (m: unknown) => isObj(m) && (str(m['url']) || isHash(m['hash'])) && (m['lowHash'] === undefined || isHash(m['lowHash']));
const linksOk = (links: unknown) => Array.isArray(links) &&
  links.every((l) => isObj(l) && ((str(l['ref']) && parseRef(l['ref'] as string) !== null) || (str(l['template']) && str(l['node']))));

/** Why a document is not a valid library document, or null. Checked before publishing and after fetching. */
export function validateDoc(value: unknown): string | null {
  if (!isObj(value)) return 'a document must be an object';
  const d = value;
  if (d['format'] !== 'versification@1') {
    if (!Array.isArray(d['deps']) || !(d['deps'] as unknown[]).every(isHash)) return 'deps must be a list of hashes';
  }
  switch (d['format']) {
    case 'template@1': {
      if (!str(d['name'])) return 'a template needs a name';
      if (d['structure'] !== 'bible' && d['structure'] !== 'outline') return 'structure must be bible or outline';
      if (!Array.isArray(d['levels']) || !(d['levels'] as unknown[]).every((l) => isObj(l) && str(l['name']))) return 'levels need names';
      if (d['structure'] === 'bible') {
        const b = d['bible'];
        if (!isObj(b) || !isHash(b['versification'])) return 'a Bible template names its versification';
        if (!Array.isArray(b['books']) || !(b['books'] as unknown[]).every((x) => isObj(x) && /^[A-Z0-9]{3}$/.test(String(x['book'])) && str(x['name']))) {
          return 'books need a USFM code and a name';
        }
        if (!['books', 'chapters', 'passages'].includes(b['divide'] as string)) return 'divide must be books, chapters or passages';
        if (b['divide'] === 'passages') {
          if (!Array.isArray(b['passages'])) return 'passages must be listed';
          for (const p of b['passages'] as unknown[]) {
            if (!isObj(p) || !str(p['ref']) || !parseRef(p['ref'] as string) || !optStr(p['name'])) return 'passages need a readable ref';
          }
        }
      } else {
        const e = outlineError(d['outline'], new Set());
        if (e) return e;
      }
      break;
    }
    case 'template@2': {
      if (!str(d['name'])) return 'a template needs a name';
      if (d['structure'] !== 'bible' && d['structure'] !== 'outline') return 'structure must be bible or outline';
      if (!Array.isArray(d['levels']) || !(d['levels'] as unknown[]).every((l) => isObj(l) && str(l['name']))) return 'levels need names';
      if (d['goesWith'] !== undefined && !(isObj(d['goesWith']) && str((d['goesWith'] as Record<string, unknown>)['pattern']))) return 'goesWith names a pattern';
      if (d['structure'] === 'bible') {
        const b = d['bible'];
        if (!isObj(b) || !isHash(b['versification'])) return 'a Bible template names its versification';
        if (!Array.isArray(b['books'])) return 'books must be listed';
        const seen = new Set<string>();
        for (const x of b['books'] as unknown[]) {
          if (!isObj(x) || !/^[A-Z0-9]{3}$/.test(String(x['book'])) || !str(x['name'])) return 'books need a USFM code and a name';
          if (seen.has(x['book'] as string)) return `book ${String(x['book'])} is listed twice`;
          seen.add(x['book'] as string);
          if (x['divide'] !== undefined && !['book', 'chapters', 'passages'].includes(x['divide'] as string)) return 'divide must be book, chapters or passages';
          if (!optStr(x['part'])) return 'part must be a string';
          if (x['divide'] === 'passages') {
            if (!Array.isArray(x['passages'])) return 'passages must be listed';
            for (const p of x['passages'] as unknown[]) {
              const r = isObj(p) && str(p['ref']) ? parseRef(p['ref'] as string) : null;
              if (!r || !optStr((p as Record<string, unknown>)['name'])) return 'passages need a readable ref';
              if (r.book !== x['book']) return `a passage of ${String(x['book'])} is in another book`;
            }
          } else if (x['passages'] !== undefined) return 'only a book divided into passages lists them';
        }
      } else {
        const e = outlineError(d['outline'], new Set());
        if (e) return e;
      }
      break;
    }
    case 'flow@1': {
      if (!str(d['name'])) return 'a flow needs a name';
      if (!Array.isArray(d['kinds']) || !(d['kinds'] as unknown[]).every((k) => isObj(k) && str(k['id']) && str(k['name']))) return 'kinds need an id and a name';
      if (!Array.isArray(d['steps'])) return 'steps must be an array';
      const kinds = new Set((d['kinds'] as { id: string }[]).map((k) => k.id));
      const ids = new Set<string>();
      for (const s of d['steps'] as unknown[]) {
        if (!isObj(s) || !str(s['stepId']) || !NODE_ID.test(s['stepId'] as string)) return 'steps need an id without / or @';
        if (ids.has(s['stepId'] as string)) return 'step ids must be unique';
        ids.add(s['stepId'] as string);
        if (!Array.isArray(s['kindIds']) || (s['kindIds'] as unknown[]).length === 0) return 'a step needs at least one kind';
        for (const k of s['kindIds'] as unknown[]) if (!kinds.has(k as string)) return `step kind ${String(k)} is not defined in the flow`;
      }
      break;
    }
    case 'study@1':
      if (!str(d['title']) || !str(d['ref']) || !parseRef(d['ref'] as string)) return 'a study guide needs a title and a readable ref';
      if (!isHash(d['versification'])) return 'a study guide names its versification';
      if (!Array.isArray(d['steps']) || !(d['steps'] as unknown[]).every((s) => isObj(s) && str(s['id']) && str(s['title']) && typeof s['text'] === 'string')) {
        return 'study steps need an id, a title and text';
      }
      if (!Array.isArray(d['resources']) || !Array.isArray(d['terms'])) return 'resources and terms must be arrays';
      break;
    case 'collection@1':
      if (!str(d['title']) || !isHash(d['versification'])) return 'a collection needs a title and a versification';
      if (!optStr(d['language']) || !optStr(d['pattern'])) return 'language and pattern must be strings';
      if (!Array.isArray(d['entries']) || !(d['entries'] as unknown[]).every((e) => isObj(e) && str(e['ref']) && parseRef(e['ref'] as string) && isHash(e['doc']))) {
        return 'collection entries need a readable ref and a document hash';
      }
      break;
    case 'material@1':
      if (!str(d['kind']) || !str(d['title'])) return 'a material needs a kind and a title';
      if (d['versification'] !== undefined && !isHash(d['versification'])) return 'versification must be a hash';
      if (d['links'] !== undefined) {
        if (!Array.isArray(d['links'])) return 'links must be an array';
        for (const l of d['links'] as unknown[]) {
          const ok = isObj(l) && ((str(l['ref']) && parseRef(l['ref'] as string) !== null) || (str(l['template']) && str(l['node'])));
          if (!ok) return 'links are a ref or a template node';
        }
      }
      break;
    case 'study@2': {
      if (!str(d['title'])) return 'a study guide needs a title';
      const placed = d['ref'] !== undefined || d['links'] !== undefined;
      if (!placed) return 'a study guide needs a ref or links';
      if (d['ref'] !== undefined && (!str(d['ref']) || !parseRef(d['ref'] as string) || !isHash(d['versification']))) return 'a ref needs a versification';
      if (d['links'] !== undefined && !linksOk(d['links'])) return 'links are a ref or a template node';
      if (!Array.isArray(d['steps']) || !(d['steps'] as unknown[]).every((s) => isObj(s) && str(s['id']) && str(s['title']) && typeof s['text'] === 'string' && (s['audio'] === undefined || mediaOk(s['audio'])))) {
        return 'study steps need an id, a title and text';
      }
      if (!Array.isArray(d['resources']) || !Array.isArray(d['terms'])) return 'resources and terms must be arrays';
      for (const r of d['resources'] as unknown[]) {
        if (!isObj(r) || !str(r['ref']) || !str(r['title'])) return 'resources need a ref and a title';
        if (r['media'] !== undefined && !(Array.isArray(r['media']) && (r['media'] as unknown[]).every((m) => isObj(m) && str(m['id']) && mediaOk(m['file'])))) return 'media need an id and a file';
      }
      if (!(d['terms'] as unknown[]).every((t) => isObj(t) && str(t['id']) && str(t['term']) && typeof t['body'] === 'string' && (t['audio'] === undefined || mediaOk(t['audio'])))) return 'terms need an id, a term and a body';
      break;
    }
    case 'source@1': {
      if (!str(d['name']) || !str(d['abbreviation']) || !str(d['language'])) return 'a source needs a name, an abbreviation and a language';
      if (!isHash(d['versification'])) return 'a source names its versification';
      const pv = d['provider'];
      if (!isObj(pv) || (pv['kind'] !== 'library' && !(pv['kind'] === 'biblebrain' && str(pv['bibleId'])))) return 'provider must be library or biblebrain with a bibleId';
      if (d['offline'] !== 'allowed' && d['offline'] !== 'stream') return 'offline must be allowed or stream';
      if (!isObj(d['copyright'])) return 'copyright must be an object';
      if (!Array.isArray(d['books']) || !(d['books'] as unknown[]).every((b) => isObj(b) && /^[A-Z0-9]{3}$/.test(String(b['book'])) && str(b['name']) && (b['doc'] === undefined || isHash(b['doc'])))) {
        return 'books need a USFM code and a name';
      }
      break;
    }
    case 'sourceBook@1': {
      if (!/^[A-Z0-9]{3}$/.test(String(d['book']))) return 'a source book needs a USFM code';
      if (!Array.isArray(d['chapters'])) return 'chapters must be an array';
      for (const c of d['chapters'] as unknown[]) {
        if (!isObj(c) || !Number.isInteger(c['chapter'])) return 'chapters need a number';
        if (c['verses'] !== undefined && !(Array.isArray(c['verses']) && (c['verses'] as unknown[]).every((v) => Array.isArray(v) && v.length === 3 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && typeof v[2] === 'string'))) {
          return 'verses are [verseStart, verseEnd, text]';
        }
        if (c['audio'] !== undefined && !mediaOk(c['audio'])) return 'audio needs a url or a hash';
        if (c['timing'] !== undefined && !isHash(c['timing'])) return 'timing must be a hash';
      }
      break;
    }
    case 'timing@1': {
      if (!/^[A-Z0-9]{3}$/.test(String(d['book'])) || !Number.isInteger(d['chapter'])) return 'a timing names its book and chapter';
      if (!isHash(d['versification'])) return 'a timing names its versification';
      const a = d['audio'];
      if (!isObj(a) || !isHash(a['sha256']) || typeof a['durationMs'] !== 'number') return 'a timing names its audio by SHA-256 and duration';
      if (typeof d['introEndMs'] !== 'number') return 'introEndMs must be a number';
      if (!['ctc', 'fcbh', 'manual'].includes(d['source'] as string)) return 'source must be ctc, fcbh or manual';
      if (!Array.isArray(d['segments']) || !(d['segments'] as unknown[]).every((g) => isObj(g) && Number.isInteger(g['verseStart']) && Number.isInteger(g['verseEnd']) &&
        typeof g['startMs'] === 'number' && typeof g['endMs'] === 'number' && (g['endMs'] as number) >= (g['startMs'] as number))) {
        return 'segments need verseStart, verseEnd, startMs and endMs';
      }
      break;
    }
    case 'versification@1':
      if (!str(d['code']) || !str(d['name'])) return 'a versification needs a code and a name';
      if (!isObj(d['maxVerses']) || !Object.values(d['maxVerses']).every((vs) => Array.isArray(vs) && vs.every((n) => Number.isInteger(n) && n >= 0))) {
        return 'maxVerses must list verse counts per chapter';
      }
      if (!isObj(d['mappedVerses']) || !Object.values(d['mappedVerses']).every((v) => typeof v === 'string')) return 'mappedVerses must map refs to refs';
      if (d['moreMappedVerses'] !== undefined && !(Array.isArray(d['moreMappedVerses']) &&
        (d['moreMappedVerses'] as unknown[]).every((m) => Array.isArray(m) && m.length === 2 && typeof m[0] === 'string' && typeof m[1] === 'string'))) {
        return 'moreMappedVerses must be pairs of refs';
      }
      return null;
    default:
      return `unknown document format ${String(d['format'])}`;
  }
  const want = referencedDocs(d as unknown as LibraryDoc);
  const have = [...(d['deps'] as string[])].sort();
  if (want.join() !== have.join()) return 'deps must list exactly the documents this one refers to';
  return null;
}

/** Set `deps` from what the document refers to; call before hashing a new document. */
export function withDeps<T extends LibraryDoc>(doc: T): T {
  if (doc.format === 'versification@1') return doc;
  return { ...doc, deps: referencedDocs(doc) } as T;
}
