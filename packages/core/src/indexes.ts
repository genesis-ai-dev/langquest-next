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
  const parents = new Set<string>();
  for (const u of Object.values(state.units)) if (u.parentUnitId) parents.add(u.parentUnitId);
  const sel = state.template?.value ?? null;
  const books = sel?.books ? new Set(sel.books) : null;
  const ordered = Object.entries(state.units).sort(([ia, a], [ib, b]) => (a.order < b.order ? -1 : a.order > b.order ? 1 : ia < ib ? -1 : 1));
  const passages: string[] = [];
  const containers: string[] = [];
  for (const [id] of ordered) {
    if (parents.has(id)) {
      containers.push(id);
      continue;
    }
    if (state.hiddenUnits[id]?.value === true) continue;
    const prefix = unitPrefixOf(id);
    if (prefix !== null && sel) {
      if (prefix !== sel.unitPrefix) continue;
      // A language may cover only some books of a Bible template (`books`).
      if (books !== null && !books.has(id.slice(prefix.length + 1, prefix.length + 4))) continue;
    }
    passages.push(id);
  }
  return { passages, containers };
}

/** The passages a language works on (`Indexes.passages`). */
export function languagePassages(state: LanguageState, idx: Indexes = buildIndexes(state)): string[] {
  return idx.passages;
}
