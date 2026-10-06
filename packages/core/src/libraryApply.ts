import type { EventPayloads } from './events';
import { templateOfUnit } from './catalog';
import type { EventSpec } from './commands';
import type { CollectionDoc, FlowDoc, MaterialDoc, StudyDoc, TemplateDoc } from './libraryDocs';
import { FLOW_CATALOG_VERSION, flowStepPrefix } from './record';
import type { PartitionState } from './state';
import {
  bookOrder, chaptersInBook, parseRef, refId, sharedVerses, versesInChapter, type VerseRange, type VersificationDoc
} from './versification';

/**
 * Using library versions in a language (docs/decisions.md 36). Everything
 * here turns a document into the ordinary events that already carry a
 * language's structure and flow, with ids decided by the item, so two
 * admins applying the same version offline agree and the fold keeps one of
 * each. Other devices never need the document to read the result.
 */

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Unit ids of a library template start with this, the same for every version of the item. */
export function unitPrefixFor(itemId: string): string {
  return itemId;
}

/** "1:1–2:3", "2:4–25", "3:1", for labels. */
function refLabel(r: VerseRange): string {
  const { start, end } = r;
  if (start.chapter === end.chapter && start.verse === end.verse) return `${start.chapter}:${start.verse}`;
  if (start.chapter === end.chapter) return `${start.chapter}:${start.verse}–${end.verse}`;
  return `${start.chapter}:${start.verse}–${end.chapter}:${end.verse}`;
}

/**
 * Every unit a template version holds. Bible units are the book (`GEN`),
 * the chapter (`GEN.1`) or the passage (`GEN.1.1-2.3`), named in the
 * language's words; outline units are the outline's own ids.
 */
export function templateUnits(doc: TemplateDoc, unitPrefix: string, versification: VersificationDoc | null): EventPayloads['v1.UnitAdded'][] {
  const id = (node: string) => `${unitPrefix}/${node}`;
  const out: EventPayloads['v1.UnitAdded'][] = [];
  if (doc.structure === 'outline') {
    const walk = (nodes: TemplateDoc['outline'], parent: string | null, order: string) => {
      (nodes ?? []).forEach((n, i) => {
        const o = `${order}o${pad(i, 4)}`;
        const kids = n.children ?? [];
        out.push({ unitId: id(n.id), parentUnitId: parent, kind: kids.length ? 'folder' : 'item', label: n.title, order: o });
        walk(kids, id(n.id), o);
      });
    };
    walk(doc.outline, null, '');
    return out;
  }
  const bible = doc.bible!;
  const names = new Map(bible.books.map((b) => [b.book, b.name]));
  const books = [...bible.books].sort((a, b) => bookOrder(a.book) - bookOrder(b.book));
  const bookUnit = (book: string, leaf: boolean) =>
    out.push({ unitId: id(book), parentUnitId: null, kind: leaf ? 'book_unit' : 'book', label: names.get(book) ?? book, order: `b${pad(bookOrder(book), 4)}` });
  if (bible.divide === 'books') {
    for (const b of books) bookUnit(b.book, true);
    return out;
  }
  if (bible.divide === 'chapters') {
    for (const b of books) {
      const chapters = versification ? chaptersInBook(versification, b.book) : 0;
      if (chapters === 0) continue;
      bookUnit(b.book, false);
      for (let c = 1; c <= chapters; c++) {
        out.push({ unitId: id(`${b.book}.${c}`), parentUnitId: id(b.book), kind: 'chapter', label: `${b.name} ${c}`, order: `b${pad(bookOrder(b.book), 4)}c${pad(c, 3)}` });
      }
    }
    return out;
  }
  const seen = new Set<string>();
  (bible.passages ?? []).forEach((p, i) => {
    const r = parseRef(p.ref, versification ? (bk, c) => versesInChapter(versification, bk, c) : undefined);
    if (!r || !names.has(r.book)) return;
    if (!seen.has(r.book)) {
      seen.add(r.book);
      bookUnit(r.book, false);
    }
    const node = refId(r);
    out.push({
      unitId: id(node),
      parentUnitId: id(r.book),
      kind: 'passage',
      label: p.name ?? `${names.get(r.book)} ${refLabel(r)}`,
      order: `b${pad(bookOrder(r.book), 4)}p${pad(i, 5)}`
    });
  });
  // Books first in canon order, each followed by its passages in the template's order.
  return out.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}

/**
 * Use a template version for a language: the selection, the units it adds,
 * and the parts it no longer has hidden (never deleted, TPL-7). Parts it has
 * again come back. Units already in the log are not repeated.
 */
export function selectTemplateSpecs(
  state: PartitionState,
  c: { commandId: string; laneId: string; itemId: string; docHash: string; doc: TemplateDoc; versification: VersificationDoc | null; books?: string[] }
): EventSpec[] {
  const prefix = unitPrefixFor(c.itemId);
  const covered = c.books ? new Set(c.books) : null;
  const units = templateUnits(c.doc, prefix, c.versification)
    .filter((u) => covered === null || covered.has(u.unitId.slice(prefix.length + 1, prefix.length + 4)));
  const inVersion = new Set(units.map((u) => u.unitId));
  let n = 0;
  const next = () => `${c.commandId}:${n++}`;
  const specs: EventSpec[] = [
    {
      id: next(), type: 'v2.LaneTemplateSelected',
      payload: { laneId: c.laneId, itemId: c.itemId, docHash: c.docHash, unitPrefix: prefix, ...(c.books ? { books: [...c.books].sort() } : {}) }
    } as EventSpec
  ];
  for (const u of units) if (!state.units[u.unitId]) specs.push({ id: next(), type: 'v1.UnitAdded', payload: u } as EventSpec);
  const hidden = state.laneHiddenUnits[c.laneId] ?? {};
  for (const unitId of Object.keys(state.units).sort()) {
    if (templateOfUnit(unitId)?.templateId !== prefix) continue;
    // Books outside the language's cover are left out by `books`, not hidden one by one.
    if (covered !== null && !covered.has(unitId.slice(prefix.length + 1, prefix.length + 4))) continue;
    const isHidden = hidden[unitId]?.value === true;
    if (!inVersion.has(unitId) && !isHidden) specs.push({ id: next(), type: 'v1.LaneUnitHidden', payload: { laneId: c.laneId, unitId, hidden: true } } as EventSpec);
    if (inVersion.has(unitId) && isHidden) specs.push({ id: next(), type: 'v1.LaneUnitHidden', payload: { laneId: c.laneId, unitId, hidden: false } } as EventSpec);
  }
  return specs;
}

/** The step prefix of one version of a library flow: `${itemId}~${first 12 of the hash}`. */
export function libraryFlowId(itemId: string, docHash: string): string {
  return `${itemId}~${docHash.slice(0, 12)}`;
}

/**
 * Use a flow version for a language: the kinds it brings that the
 * organization does not have yet, its steps under the version's own prefix
 * (never removed, decision 32), and the selection.
 */
export function selectFlowSpecs(
  state: PartitionState,
  c: { commandId: string; laneId: string; itemId: string; docHash: string; doc: FlowDoc }
): EventSpec[] {
  let n = 0;
  const next = () => `${c.commandId}:${n++}`;
  const flowId = libraryFlowId(c.itemId, c.docHash);
  const prefix = flowStepPrefix(c.laneId, flowId, FLOW_CATALOG_VERSION);
  const specs: EventSpec[] = [];
  for (const k of c.doc.kinds) {
    if (state.reviewKinds[k.id]) continue;
    specs.push({
      id: next(), type: 'v1.ReviewKindDefined',
      payload: {
        kindId: k.id, name: k.name, description: k.description, usualReviewer: k.usualReviewer,
        ...(k.withholdsContext ? { withholdsContext: true } : {}), ...(k.produces ? { produces: k.produces } : {})
      }
    } as EventSpec);
  }
  c.doc.steps.forEach((s, i) => {
    specs.push({
      id: next(), type: 'v2.WorkflowStepSet',
      payload: { stepId: `${prefix}${s.stepId}`, laneId: c.laneId, order: `s${pad(i, 2)}`, kindIds: [...s.kindIds], checkpoint: !!s.checkpoint }
    } as EventSpec);
  });
  specs.push({
    id: next(), type: 'v2.LaneFlowSelected',
    payload: { laneId: c.laneId, flowId, catalogVersion: FLOW_CATALOG_VERSION, itemId: c.itemId, docHash: c.docHash, name: c.doc.name }
  } as EventSpec);
  return specs;
}

// ---- study material that lines up with a passage --------------------------------------------

/** A passage's verse range, from its unit id (library units) or its label (older units). */
export function unitVerseRange(state: PartitionState, unitId: string, versification?: VersificationDoc | null): VerseRange | null {
  const node = unitId.slice(unitId.indexOf('/') + 1);
  const versesIn = versification ? (b: string, c: number) => versesInChapter(versification, b, c) : undefined;
  const fromId = /^[A-Z0-9]{3}(\.\d+)/.test(node) ? parseRef(node, versesIn) : null;
  if (fromId) return fromId;
  return null;
}

/**
 * Collection entries that share verses with a passage, most shared first.
 * The passage and the collection may be numbered differently; both are
 * read through org (versification.ts).
 */
export function studyEntriesFor(
  passage: { range: VerseRange; versification: VersificationDoc },
  collection: { doc: CollectionDoc; versification: VersificationDoc }
): { entry: CollectionDoc['entries'][number]; shared: number }[] {
  const out: { entry: CollectionDoc['entries'][number]; shared: number }[] = [];
  for (const entry of collection.doc.entries) {
    const r = parseRef(entry.ref, (b, c) => versesInChapter(collection.versification, b, c));
    if (!r || r.book !== passage.range.book && !sameBookAcross(r.book, passage.range.book)) continue;
    const shared = sharedVerses({ doc: passage.versification, range: passage.range }, { doc: collection.versification, range: r });
    if (shared > 0) out.push({ entry, shared });
  }
  return out.sort((a, b) => b.shared - a.shared || (a.entry.ref < b.entry.ref ? -1 : 1));
}

/** Books whose verses a versification may move into each other (Daniel's additions, Esther's Greek parts). */
function sameBookAcross(a: string, b: string): boolean {
  const pairs = [['DAN', 'DAG'], ['EST', 'ESG'], ['DAG', 'S3Y'], ['DAG', 'SUS'], ['DAG', 'BEL']];
  return pairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/** Does a single study guide or simple material apply to a passage? */
export function materialApplies(
  passage: { unitId: string; range: VerseRange | null; versification: VersificationDoc | null },
  m: { doc: StudyDoc | MaterialDoc; versification: VersificationDoc | null }
): boolean {
  if (m.doc.format === 'study@1') {
    if (!passage.range || !passage.versification || !m.versification) return false;
    const r = parseRef(m.doc.ref);
    return !!r && sharedVerses({ doc: passage.versification, range: passage.range }, { doc: m.versification, range: r }) > 0;
  }
  for (const link of m.doc.links ?? []) {
    if ('node' in link) {
      if (passage.unitId === `${unitPrefixFor(link.template)}/${link.node}` || passage.unitId.startsWith(`${unitPrefixFor(link.template)}/${link.node}.`)) return true;
      continue;
    }
    const r = parseRef(link.ref);
    if (!r || !passage.range || !passage.versification) continue;
    const v = m.versification ?? passage.versification;
    if (sharedVerses({ doc: passage.versification, range: passage.range }, { doc: v, range: r }) > 0) return true;
  }
  return false;
}
