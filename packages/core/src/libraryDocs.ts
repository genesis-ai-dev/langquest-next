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
export interface TemplateDoc {
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

export type LibraryDoc = TemplateDoc | FlowDoc | StudyDoc | CollectionDoc | MaterialDoc | VersificationDoc;

/** The library kind a document is published under. */
export function kindOfDoc(doc: LibraryDoc): LibraryKind {
  switch (doc.format) {
    case 'template@1': return 'template';
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
    case 'template@1': if (doc.bible) out.add(doc.bible.versification); break;
    case 'study@1': out.add(doc.versification); break;
    case 'collection@1':
      out.add(doc.versification);
      for (const e of doc.entries) out.add(e.doc);
      break;
    case 'material@1': if (doc.versification) out.add(doc.versification); break;
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
      if (!optStr(d['language'])) return 'language must be a string';
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
    case 'versification@1':
      if (!str(d['code']) || !str(d['name'])) return 'a versification needs a code and a name';
      if (!isObj(d['maxVerses']) || !Object.values(d['maxVerses']).every((vs) => Array.isArray(vs) && vs.every((n) => Number.isInteger(n) && n >= 0))) {
        return 'maxVerses must list verse counts per chapter';
      }
      if (!isObj(d['mappedVerses']) || !Object.values(d['mappedVerses']).every((v) => typeof v === 'string')) return 'mappedVerses must map refs to refs';
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
