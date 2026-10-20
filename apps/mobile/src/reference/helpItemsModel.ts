// What can help a language's team, as one list (Get ready, question 2): the
// organization's Bibles, guides, key words and notes, and what other
// organizations share; which of them go together (FIA's guides and FIA's key
// words, decision 149), and what a search of the list finds. Pure, so it is
// tested (test/helpItemsModel.test.ts); the screen's hook only gathers the
// inputs.
import type { LanguageState, LibraryDoc, LibraryItemView, OrgState } from '@langquest-next/core';
import { t } from '../i18n';
import { languageLabel } from '../admin/adminModel';
import { sourceLine, type SharedItem } from '../library/model';
import { guideSets, isWordSet, originOf, patternOf, setKeyOf, setReach, type GuideSet, type SetMember } from './guideSets';
import { docLanguage, sameLanguage } from './languages';
import { refKindLabel, refKindOf, type RefKind } from './model';

export interface HelpItem {
  key: string;
  /** In this organization's library; null for one another organization shares, followed when turned on. */
  itemId: string | null;
  shared: SharedItem | null;
  name: string;
  kind: RefKind;
  doc: LibraryDoc;
  on: boolean;
  /** Where it comes from, as a line under its name. */
  owner: string;
  /** The organization it is followed from or shared by, when it is another's. */
  from: string | null;
  /** A guide set in several languages (FIA), chosen as one with its language (decision 84), and what of it reaches the team. */
  set?: { set: GuideSet; reach: SetMember[] };
  /**
   * Where it comes from and the method it follows ("langquest|FIA"): items
   * with the same family go together, as FIA's guides and FIA's key words
   * do (decision 149). Absent for anything that follows no method.
   */
  family?: string;
}

export interface HelpItemsInput {
  /** The organization's material, current and not archived. */
  items: readonly LibraryItemView[];
  /** What other organizations share that this one does not already hold. */
  others: readonly SharedItem[];
  doc: (hash: string | null | undefined) => LibraryDoc | null;
  itemOf: (itemId: string) => LibraryItemView | null | undefined;
  recommendations: OrgState['recommendations'] | undefined;
  state: LanguageState | null;
  /** Item ids recommended to this language (core's `recommendedFor`). */
  offered: { has(itemId: string): boolean };
  /** The language the team reads, and the one the reader reads. */
  reads: string;
  reader: string;
  /** Shared documents are still arriving. */
  guidesIncoming: boolean;
}

/**
 * Whether shared guides are still arriving: the list is not loaded, or some
 * document is not here yet (and nothing failed). Sibling languages arrive
 * after the one already in the library; until then a patterned collection is
 * not its own switch, because tapping it would turn FIA off instead of asking
 * which language.
 */
export function guidesArriving(loaded: boolean, docsPending: boolean, failed: boolean): boolean {
  return (!loaded || docsPending) && !failed;
}

/** By name, examples last; never by on or off, so a row stays put when it is switched. */
const rank = (h: HelpItem) => (/example/i.test(h.name) ? 1 : 0);

/** A guide collection or key-word list in one language that follows a method (one language of a set). */
const patterned = (doc: LibraryDoc) =>
  (doc.format === 'collection@1' || (doc.format === 'material@1' && doc.kind === 'key_terms')) && !!patternOf(doc);

/** "langquest|FIA", from a set's key ("langquest|FIA|words") or an item's origin and method. */
function familyOf(origin: string, doc: LibraryDoc): string | undefined {
  const pattern = doc.format === 'collection@1' || doc.format === 'material@1' ? patternOf(doc) : null;
  return pattern ? `${origin}|${pattern}` : undefined;
}

export function helpItems(i: HelpItemsInput): HelpItem[] {
  const out: HelpItem[] = [];
  const say = i.state?.languageReferences ?? {};
  // FIA's collections, one per language, are one row whose language is chosen (decision 84).
  const sets = guideSets(i.items.map((it) => ({ it, doc: i.doc(it.current) })), i.others.map((s) => ({ s, doc: i.doc(s.latest_hash) })));
  const setKeys = new Set(sets.map((x) => x.key));
  for (const set of sets) {
    // Wait until every shared document is in, so the sheet lists every language, not the first two that arrived.
    if (i.guidesIncoming) continue;
    const reach = setReach(set, i.recommendations, i.state);
    const first = reach[0] ?? set.members[0]!;
    const doc = first.itemId ? i.doc(i.itemOf(first.itemId)?.current) : i.doc(first.shared?.latest_hash);
    const heldFrom = set.members.map((m) => (m.itemId ? i.itemOf(m.itemId)?.subscription?.sourceOrgName ?? i.itemOf(m.itemId)?.copiedFrom?.orgName : m.shared?.org_name)).find(Boolean) ?? null;
    if (!doc) continue;
    out.push({ key: `set:${set.key}`, itemId: null, shared: null, name: set.name, kind: isWordSet(set) ? 'words' : 'guide', doc, on: reach.length > 0,
      owner: heldFrom ? t('getReady.helps.fromOrg', { org: heldFrom }) : '', from: heldFrom, set: { set, reach }, family: set.key.replace(/\|words$/, '') });
  }
  for (const it of i.items) {
    const doc = i.doc(it.current);
    const kind = refKindOf(doc);
    if (!doc || !kind || kind === 'questions') continue;
    if (setKeys.has(setKeyOf(originOf(it), doc) ?? '')) continue;
    if (i.guidesIncoming && patterned(doc)) continue;
    // A Bible reaches the team when recommended; a guide or note in the library reaches it unless hidden here (reference/offered.ts).
    const on = kind === 'source' ? i.offered.has(it.itemId) : say[it.itemId]?.value !== 'hidden';
    const following = it.source === 'subscription' && it.subscription?.active ? it.subscription.sourceOrgName : null;
    const family = familyOf(originOf(it), doc);
    out.push({ key: it.itemId, itemId: it.itemId, shared: null, name: it.name, kind, doc, on, owner: sourceLine(it), from: following, ...(family ? { family } : {}) });
  }
  for (const s of i.others) {
    const doc = i.doc(s.latest_hash);
    const kind = refKindOf(doc);
    if (!doc || (kind !== 'source' && kind !== 'guide' && kind !== 'words')) continue;
    if (setKeys.has(setKeyOf(s.org_id, doc) ?? '')) continue;
    if (i.guidesIncoming && patterned(doc)) continue;
    // Another organization's guides and key words in a language the team may read: the language's own or the reader's.
    const lang = docLanguage(doc);
    if (kind !== 'source' && lang && !sameLanguage(lang, i.reads) && !sameLanguage(lang, i.reader)) continue;
    const family = familyOf(s.org_id, doc);
    out.push({ key: `shared:${s.org_id}/${s.item_id}`, itemId: null, shared: s, name: s.name, kind, doc, on: false, owner: t('getReady.helps.fromOrg', { org: s.org_name }), from: s.org_name, ...(family ? { family } : {}) });
  }
  out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return out;
}

/**
 * What goes with an item (decision 149): the rest of its family, so FIA's
 * key words for FIA's guides, and FIA's guides for its key words. The item
 * itself is not in the list.
 */
export function relatedItems(h: HelpItem, items: readonly HelpItem[]): HelpItem[] {
  if (!h.family) return [];
  return items.filter((x) => x.key !== h.key && x.family === h.family);
}

/** A family as a search filter shows it: the related items, the one they go with first. */
export function familyItems(family: string, items: readonly HelpItem[]): HelpItem[] {
  return items.filter((x) => x.family === family);
}

/** What a document says about itself, for search: a collection's description, a list's or note's text, a Bible's name. */
function aboutOf(doc: LibraryDoc): string {
  switch (doc.format) {
    case 'collection@1': return `${doc.title} ${doc.description}`;
    case 'material@1': return `${doc.title} ${doc.body ?? ''} ${doc.source ?? ''}`;
    case 'source@1': return `${doc.name} ${doc.abbreviation}`;
    case 'study@1': case 'study@2': return `${doc.title} ${doc.source}`;
    default: return '';
  }
}

/**
 * Does an item match a search of the list: its name, who it is from, its
 * language (every language of a set), its kind ("key words"), the method
 * it follows ("FIA") and what its document says about itself. Every word
 * typed must be found, in any order, ignoring case.
 */
export function matchesHelpItem(h: HelpItem, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const languages = h.set ? h.set.set.members.map((m) => m.language) : [docLanguage(h.doc)];
  const hay = [
    h.name, h.owner, h.from ?? '', refKindLabel(h.kind), h.family?.split('|')[1] ?? '', aboutOf(h.doc),
    ...languages.flatMap((code) => (code ? [code, languageLabel(code)] : []))
  ].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
