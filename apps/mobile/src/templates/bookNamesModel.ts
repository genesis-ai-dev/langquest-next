// Bible book names by language (decision 193): library items of kind `names`,
// one per language ("Bible book names (Nepali)"), as FIA's guides are one
// collection per language. A content template only says which books there
// are; a language uses one of these for what its people read them as
// (`v1.BookNamesSelected`). Pure, so it is tested.
import type { LanguageState, LibraryDoc, LibraryItemView, NamesDoc } from '@langquest-next/core';
import type { SharedItem } from '../library/model';
import { itemName, NO_LABELS, sharedName, type Labels } from '../library/labelsModel';
import { sameLanguage } from '../reference/languages';

/** A set of book names someone here can pick: this organization's own (or one it follows), or another's it shares. */
export interface NameSet {
  key: string;
  /** Here, when the organization has it; null for another organization's, followed when picked. */
  itemId: string | null;
  shared: SharedItem | null;
  name: string;
  /** Whose it is, for another organization's. */
  from: string | null;
  docHash: string;
  doc: NamesDoc;
}

const isNames = (doc: LibraryDoc | null | undefined): doc is NamesDoc => doc?.format === 'names@1';

/**
 * Every set there is: the organization's own first, then what others share, each once its document has arrived,
 * named as the language showing calls them (decision 195).
 */
export function nameSets(
  own: readonly { it: LibraryItemView; doc: LibraryDoc | null | undefined }[],
  others: readonly { s: SharedItem; doc: LibraryDoc | null | undefined }[],
  labels: Labels = NO_LABELS
): NameSet[] {
  const mine = own.flatMap(({ it, doc }) => (it.current && isNames(doc) ? [{
    key: it.itemId, itemId: it.itemId, shared: null, name: itemName(labels, it), from: it.subscription?.sourceOrgName ?? null, docHash: it.current, doc
  }] : []));
  const theirs = others.flatMap(({ s, doc }) => (isNames(doc) ? [{
    key: `${s.org_id}/${s.item_id}`, itemId: null, shared: s, name: sharedName(labels, s), from: s.org_name, docHash: s.latest_hash, doc
  }] : []));
  return [...mine, ...theirs];
}

/**
 * The names a new language starts with: a set in the first of its team's
 * languages that has one (the main language first, decision 130), this
 * organization's own before another's; none when no language has any, and
 * the template's names stand.
 */
export function namesFor(sets: readonly NameSet[], languages: readonly string[]): NameSet | null {
  for (const l of languages) {
    const hit = sets.find((s) => sameLanguage(s.doc.language, l));
    if (hit) return hit;
  }
  return null;
}

/** Sets in the team's languages, in the team's order, then the others by name. */
export function namesInOrder(sets: readonly NameSet[], languages: readonly string[]): { team: NameSet[]; rest: NameSet[] } {
  const team = languages.flatMap((l) => sets.filter((s) => sameLanguage(s.doc.language, l)));
  return { team: [...new Set(team)], rest: sets.filter((s) => !team.includes(s)).sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Is this set the one the language uses? The same item, or the same version of it. */
export function namesInUse(set: NameSet, state: LanguageState | null | undefined): boolean {
  const used = state?.bookNamesFrom?.value;
  return !!used && (set.itemId === used.itemId || set.docHash === used.docHash);
}

/** A few of a set's names, so a list shows what they look like: the Gospels, or its first four. */
export function sampleNames(doc: NamesDoc, separator: string): string {
  const gospels = ['MAT', 'MRK', 'LUK', 'JHN'].map((b) => doc.books.find((x) => x.book === b)?.name).filter((n): n is string => !!n);
  return (gospels.length ? gospels : doc.books.slice(0, 4).map((b) => b.name)).join(separator);
}
