// Which reference material reaches which passage (docs/reference-material.md,
// "Coordinates place material on passages"): a source by its books, a guide
// or note by verse overlap through the versification engine (each side read
// in its own numbering), or by a content template's node; then what an admin
// placed or hid on one passage by hand. Pure: documents in, answers out.
import {
  orgVerses, parseRef, versesInChapter,
  type LibraryDoc, type MaterialLink, type RecommendationSource, type VerseRange, type VersificationDoc
} from '@langquest-next/core';
import { refKindOf, type RefKind } from './model';

type Get = (hash: string | null | undefined) => LibraryDoc | null;

export interface CoveragePassage {
  unitId: string;
  label: string;
  /** Its verses, from its unit id; null for an outline part. */
  range: VerseRange | null;
}

/** Why an item is on a passage: recommended (and its coordinates match), or placed here by hand. */
export type ReachWhy = RecommendationSource | 'linked';

export interface Reach {
  itemId: string;
  kind: RefKind;
  why: ReachWhy;
  /** How it lines up: its books, shared verses, a template part, or only by hand. */
  match: 'book' | 'verses' | 'node' | 'linked';
}

/** Where one item applies, worked out once for every passage. */
interface Placement {
  kind: RefKind;
  books: Set<string> | null;
  ranges: { range: VerseRange; v11n: VersificationDoc | null }[];
  nodes: { template: string; node: string }[];
}

function linksOf(links: MaterialLink[] | undefined, v11n: VersificationDoc | null, p: Placement) {
  for (const l of links ?? []) {
    if ('node' in l) p.nodes.push({ template: l.template, node: l.node });
    else {
      const r = parseRef(l.ref, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined);
      if (r) p.ranges.push({ range: r, v11n });
    }
  }
}

/** Where an item's document applies; null when it is not reference material or not loaded. */
export function placementOf(doc: LibraryDoc | null, get: Get): Placement | null {
  const kind = refKindOf(doc);
  if (!doc || !kind) return null;
  const p: Placement = { kind, books: null, ranges: [], nodes: [] };
  const v = (hash: string | undefined) => (hash ? (get(hash) as VersificationDoc | null) : null);
  switch (doc.format) {
    case 'source@1': p.books = new Set(doc.books.map((b) => b.book)); break;
    case 'study@1': {
      const v11n = v(doc.versification);
      const r = parseRef(doc.ref, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined);
      if (r) p.ranges.push({ range: r, v11n });
      break;
    }
    case 'study@2': {
      const v11n = v(doc.versification);
      const r = doc.ref ? parseRef(doc.ref, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined) : null;
      if (r) p.ranges.push({ range: r, v11n });
      linksOf(doc.links, v11n, p);
      break;
    }
    case 'collection@1': {
      const v11n = v(doc.versification);
      for (const e of doc.entries) {
        const r = parseRef(e.ref, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined);
        if (r) p.ranges.push({ range: r, v11n });
      }
      break;
    }
    case 'material@1': linksOf(doc.links, v(doc.versification), p); break;
    default: return null;
  }
  return p;
}

const before = (a: { chapter: number; verse: number }, b: { chapter: number; verse: number }) => a.chapter < b.chapter || (a.chapter === b.chapter && a.verse <= b.verse);
/** Books whose verses a versification may move into each other (Daniel's and Esther's Greek parts). */
const ACROSS = new Set(['DAN|DAG', 'EST|ESG', 'DAG|S3Y', 'DAG|SUS', 'DAG|BEL']);
const sameBook = (a: string, b: string) => a === b || ACROSS.has(`${a}|${b}`) || ACROSS.has(`${b}|${a}`);

/** Plain overlap, when neither side names a versification. */
const plainOverlap = (a: VerseRange, b: VerseRange) => a.book === b.book && before(a.start, b.end) && before(b.start, a.end);

/**
 * Coverage of a language's passages by the items offered to it. `offered`
 * is what the language recommends (core `recommendedFor`); `link` is an
 * admin's choice on one passage (core `passageLink`); `ancestors` lists a
 * part's parents, so a link to an outline folder reaches what is inside.
 * Passages are read in `versification` (the language's template's), or in
 * each item's own when the template names none.
 */
export function coverage(input: {
  passages: CoveragePassage[];
  versification: VersificationDoc | null;
  offered: Map<string, RecommendationSource>;
  docs: Map<string, LibraryDoc | null>;
  get: Get;
  link: (unitId: string, itemId: string) => boolean | undefined;
  linkedHere: (unitId: string) => string[];
  ancestors?: (unitId: string) => string[];
}): Map<string, Reach[]> {
  const placements = new Map<string, Placement>();
  for (const [itemId, doc] of input.docs) {
    const p = placementOf(doc, input.get);
    if (p) placements.set(itemId, p);
  }
  // Org verse sets, worked out once per range and numbering.
  const cache = new Map<string, Set<string>>();
  const verses = (v11n: VersificationDoc, r: VerseRange) => {
    const k = `${v11n.code}|${r.book} ${r.start.chapter}:${r.start.verse}-${r.end.chapter}:${r.end.verse}`;
    let s = cache.get(k);
    if (!s) { s = orgVerses(v11n, r); cache.set(k, s); }
    return s;
  };
  const meets = (passage: VerseRange, target: { range: VerseRange; v11n: VersificationDoc | null }) => {
    const pv = input.versification ?? target.v11n;
    const tv = target.v11n ?? input.versification;
    if (!pv || !tv) return plainOverlap(passage, target.range);
    if (passage.book !== target.range.book && pv.code === tv.code) return false;
    const left = verses(pv, passage);
    for (const k of verses(tv, target.range)) if (left.has(k)) return true;
    return false;
  };

  const out = new Map<string, Reach[]>();
  for (const passage of input.passages) {
    const reach: Reach[] = [];
    const seen = new Set<string>();
    const parts = [passage.unitId, ...(input.ancestors?.(passage.unitId) ?? [])];
    for (const [itemId, why] of input.offered) {
      const p = placements.get(itemId);
      if (!p || input.link(passage.unitId, itemId) === false) continue;
      let match: Reach['match'] | null = null;
      if (p.books && passage.range && p.books.has(passage.range.book)) match = 'book';
      if (!match && passage.range) {
        const range = passage.range;
        if (p.ranges.some((t) => sameBook(t.range.book, range.book) && meets(range, t))) match = 'verses';
      }
      if (!match && p.nodes.some((n) => parts.some((u) => u === `${n.template}/${n.node}` || u.startsWith(`${n.template}/${n.node}.`)))) match = 'node';
      if (match) { reach.push({ itemId, kind: p.kind, why, match }); seen.add(itemId); }
    }
    for (const itemId of input.linkedHere(passage.unitId)) {
      if (seen.has(itemId)) continue;
      const kind = placements.get(itemId)?.kind ?? refKindOf(input.docs.get(itemId) ?? null);
      if (kind) reach.push({ itemId, kind, why: 'linked', match: 'linked' });
    }
    out.set(passage.unitId, reach);
  }
  return out;
}

export interface CoverageSummary {
  passages: number;
  withSource: number;
  withGuide: number;
  withNote: number;
  /** Passages with no guide and no note. */
  bare: number;
}

export function coverageSummary(map: Map<string, Reach[]>): CoverageSummary {
  let withSource = 0, withGuide = 0, withNote = 0, bare = 0;
  for (const reach of map.values()) {
    const kinds = new Set(reach.map((r) => r.kind));
    if (kinds.has('source')) withSource++;
    if (kinds.has('guide')) withGuide++;
    if (kinds.has('note')) withNote++;
    if (!kinds.has('guide') && !kinds.has('note')) bare++;
  }
  return { passages: map.size, withSource, withGuide, withNote, bare };
}

/** Does an item reach any of these passages (the "covers this language's passages" filter)? */
export function itemReaches(map: Map<string, Reach[]>, itemId: string): number {
  let n = 0;
  for (const reach of map.values()) if (reach.some((r) => r.itemId === itemId)) n++;
  return n;
}
