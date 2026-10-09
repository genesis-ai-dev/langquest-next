import type { LanguageState } from './state';

/**
 * Read indexes over a folded language. Built once per fold, then every
 * derivation looks units up instead of rescanning the state per passage.
 * The state itself is unchanged; this is a view, never persisted, never
 * synced. Pass the same `Indexes` to every derive call made against one
 * fold; building it again per call is still correct, just slower.
 */
export interface Indexes {
  /**
   * The passages the language works on, in display order: units nothing
   * else contains, from its template (less the parts its current version
   * hides and the books it does not cover) plus any added by hand.
   */
  passages: string[];
  /** Units that contain others (books, chapters, folders), in display order. */
  containers: string[];
  /**
   * Books of the language's Bible template that are not broken up yet
   * (decision 74): listed, with no part shown in them. Nobody records
   * them until a coordinator breaks them up. Display order.
   */
  waiting: string[];
}

/**
 * The template part of a unit id: library units are `${unitPrefix}/${node}`
 * (libraryApply.ts); a unit added by hand has no prefix.
 */
export function unitPrefixOf(unitId: string): string | null {
  const cut = unitId.indexOf('/');
  return cut > 0 ? unitId.slice(0, cut) : null;
}

export function buildIndexes(state: LanguageState): Indexes {
  const sel = state.template?.value ?? null;
  const books = sel?.books ? new Set(sel.books) : null;
  const inUse = (id: string): boolean => {
    const prefix = unitPrefixOf(id);
    if (prefix === null || !sel) return true;
    if (prefix !== sel.unitPrefix) return false;
    // A language may cover only some books of a Bible template (`books`).
    return books === null || books.has(id.slice(prefix.length + 1, prefix.length + 4));
  };
  const parents = new Set<string>();
  // Books with a part the language works on; a book with none is waiting to be broken up.
  const shownParents = new Set<string>();
  for (const [id, u] of Object.entries(state.units)) {
    if (!u.parentUnitId) continue;
    parents.add(u.parentUnitId);
    if (state.hiddenUnits[id]?.value !== true && inUse(id)) shownParents.add(u.parentUnitId);
  }
  const ordered = Object.entries(state.units).sort(([ia, a], [ib, b]) => (a.order < b.order ? -1 : a.order > b.order ? 1 : ia < ib ? -1 : 1));
  const passages: string[] = [];
  const containers: string[] = [];
  const waiting: string[] = [];
  for (const [id, u] of ordered) {
    const bookUnit = u.kind === 'book' && u.parentUnitId === null && unitPrefixOf(id) !== null;
    if (bookUnit && !shownParents.has(id)) {
      if (state.hiddenUnits[id]?.value !== true && inUse(id) && sel) waiting.push(id);
      if (parents.has(id)) containers.push(id);
      continue;
    }
    if (parents.has(id)) {
      containers.push(id);
      continue;
    }
    if (state.hiddenUnits[id]?.value === true) continue;
    if (!inUse(id)) continue;
    passages.push(id);
  }
  return { passages, containers, waiting };
}

/** Books of the language waiting to be broken up (`Indexes.waiting`), as unit ids. */
export function booksWaiting(state: LanguageState, idx: Indexes = buildIndexes(state)): string[] {
  return idx.waiting;
}

/** The passages a language works on (`Indexes.passages`). */
export function languagePassages(state: LanguageState, idx: Indexes = buildIndexes(state)): string[] {
  return idx.passages;
}
