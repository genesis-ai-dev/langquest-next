// Which kept passages' study guides have been looked up (study/StudyPrefetch.tsx). Pure.

/**
 * The passages whose guide has been looked up, found or not: only of these
 * can the offline counts say their study files are here (decisions.md 166).
 * A kept passage showed "On this device" before its guide had loaded, then
 * turned amber (Carl, 2026-11-20).
 *
 * Worked out passage by passage, so one document that cannot be read holds
 * back only the passages that are offered it:
 * - a passage whose guide is in hand is looked up;
 * - one with no guide is looked up once a read has finished for the
 *   template (which says its verses) and for every document it is offered,
 *   and, where a guide was chosen for it, for that guide's own document.
 *
 * A read that finished is an answer even when the document is not there
 * (the server has none). A read that failed is not: offline with a document
 * missing from this device, the passage stays not looked up until the read
 * is asked again.
 */
export function lookedUp(o: {
  unitIds: readonly string[];
  /** Passages whose guide is in hand. */
  found: { has(unitId: string): boolean };
  /** Per passage, the documents of the guides it is offered. A passage missing here is offered nothing known yet. */
  offered: ReadonlyMap<string, readonly string[]>;
  /** The template's document; none for a language with no template. */
  template: string | null | undefined;
  /** Per passage, the document of the guide chosen for it, where one was. */
  chosen: ReadonlyMap<string, string>;
  /** Has a read of this offered document, or of the template, finished? */
  read: (hash: string) => boolean;
  /** The same for a chosen guide's own document. */
  entryRead: (hash: string) => boolean;
}): Set<string> {
  const out = new Set<string>();
  const templateRead = !o.template || o.read(o.template);
  for (const unitId of o.unitIds) {
    if (o.found.has(unitId)) { out.add(unitId); continue; }
    const hashes = o.offered.get(unitId);
    if (!hashes || !templateRead || !hashes.every((h) => o.read(h))) continue;
    const choice = o.chosen.get(unitId);
    if (choice && !o.entryRead(choice)) continue;
    out.add(unitId);
  }
  return out;
}

/**
 * Does the prefetch's wish list name every study file the language's kept
 * passages need? Only once the language is open, has counted what it keeps
 * (`counted`: its kept list and scope are empty until then), and every kept
 * passage has been looked up. Only then is the list saved as the language's
 * and may study files no kept passage needs be cleared (study/studyFiles.ts).
 */
export function wishListWhole(o: { open: boolean; counted: boolean; unitIds: readonly string[]; lookedUp: ReadonlySet<string> }): boolean {
  return o.open && o.counted && o.unitIds.every((u) => o.lookedUp.has(u));
}
