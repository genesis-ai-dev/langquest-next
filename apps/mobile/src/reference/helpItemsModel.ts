// What can help a language's team, as one list (Get ready, question 2): the
// organization's Bibles, guides, key words and notes, and what other
// organizations share; which of them go together (FIA's guides and FIA's key
// words, decision 172), and what a search of the list finds. Pure, so it is
// tested (test/helpItemsModel.test.ts); the screen's hook only gathers the
// inputs.
import type { LanguageState, LibraryDoc, LibraryItemView, OrgState } from '@langquest-next/core';
import { t } from '../i18n';
import { languageLabel } from '../admin/adminModel';
import { sourceLine, type SharedItem } from '../library/model';
import { guideSets, isWordSet, originOf, patternOf, setKeyOf, setReach, suggestedMember, type GuideSet, type ReferenceSay, type SetMember } from './guideSets';
import { memberIn } from './languageChoices';
import { docLanguage, sameLanguage } from './languages';
import { refKindLabel, refKindOf, type RecState, type RefKind } from './model';

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
   * do (decision 172). Absent for anything that follows no method.
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
    // A Bible or a key-word list reaches the team when chosen for it; a guide or note in the library reaches it unless hidden here (reference/offered.ts).
    const on = kind === 'source' || kind === 'words' ? i.offered.has(it.itemId) : say[it.itemId]?.value !== 'hidden';
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
 * What goes with an item (decision 172): the rest of its family, so FIA's
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

/** Letters as a search compares them: lower case, accents left off ("espanol" finds "Español"). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Is every word typed in the text, in any order, ignoring case and accents? An empty search matches everything. */
export function matchesWords(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

/**
 * Does an item match a search of the list: its name, who it is from, its
 * language (every language of a set), its kind ("key words"), the method
 * it follows ("FIA") and what its document says about itself. Every word
 * typed must be found, in any order, ignoring case and accents.
 */
export function matchesHelpItem(h: HelpItem, query: string): boolean {
  if (!query.trim()) return true;
  const languages = h.set ? h.set.set.members.map((m) => m.language) : [docLanguage(h.doc)];
  const hay = [
    h.name, h.owner, h.from ?? '', refKindLabel(h.kind), h.family?.split('|')[1] ?? '', aboutOf(h.doc),
    ...languages.flatMap((code) => (code ? [code, languageLabel(code)] : []))
  ].join(' ');
  return matchesWords(hay, query);
}

/**
 * Does the organization have it: an item in its library, or a set it has a
 * language of. What another organization shares is not in it until it is
 * turned on (followed, or copied).
 */
export function inLibrary(h: HelpItem): boolean {
  return h.set ? h.set.set.members.some((m) => m.itemId !== null) : h.itemId !== null;
}

/**
 * What a search of the list shows: the items that match every word typed,
 * among a family's items when a "Goes with" filter is set (a row's related
 * link). Typed words and the filter combine.
 */
export function searchHelps(items: readonly HelpItem[], query: string, family: string | null): HelpItem[] {
  return (family ? familyItems(family, items) : items).filter((x) => matchesHelpItem(x, query));
}

export interface HelpSections {
  bibles: HelpItem[];
  guides: HelpItem[];
  words: HelpItem[];
  /** Notes for translators and other material. */
  notes: HelpItem[];
  /** While searching: what the organization does not have yet, last, by kind (`inLibrary`). */
  notYet: HelpItem[];
}

const SECTION: Record<RefKind, number> = { source: 0, guide: 1, words: 2, note: 3, other: 3, questions: 4 };

/**
 * The list's sections, by kind. A search (`notYetApart`) lists what the
 * organization does not have yet on its own, after everything it has, so
 * what is already the team's comes first.
 */
export function helpSections(items: readonly HelpItem[], notYetApart: boolean): HelpSections {
  const held = notYetApart ? items.filter(inLibrary) : items;
  const of = (n: number) => held.filter((x) => SECTION[x.kind] === n);
  const notYet = notYetApart ? items.filter((x) => !inLibrary(x)) : [];
  return {
    bibles: of(0), guides: of(1), words: of(2), notes: of(3),
    notYet: notYet.map((x, i) => ({ x, i })).sort((a, b) => SECTION[a.x.kind] - SECTION[b.x.kind] || a.i - b.i).map(({ x }) => x)
  };
}

/**
 * The rows that say how many related items are on ("1 related resource
 * turned on"), with how many: in each family, the first row in `order` that
 * is on and has related items on. One row a family, so the list says it
 * once, on the row the others came with (FIA's guides, above its key words).
 */
export function relatedLinks(order: readonly HelpItem[], items: readonly HelpItem[]): Map<string, number> {
  const out = new Map<string, number>();
  const told = new Set<string>();
  for (const h of order) {
    if (!h.family || !h.on || told.has(h.family)) continue;
    const n = relatedItems(h, items).filter((x) => x.on).length;
    if (!n) continue;
    out.set(h.key, n);
    told.add(h.family);
  }
  return out;
}

/** A related set's language to turn on: the language just chosen, else English, else the one the reader would be offered. */
export function relatedMember(set: GuideSet, language: string | null, reader: string): SetMember {
  return (language ? memberIn(set, language) : null) ?? memberIn(set, 'eng') ?? suggestedMember(set, reader);
}

/** One item turned on with another; for a set, the language it is turned on in. */
export interface TurnOn { item: HelpItem; member: SetMember | null }

/**
 * What turning `h` on turns on with it (decision 172): each related item
 * that is off, a set in `language` (the language `h` is turned on in) as
 * far as it has it. Nothing when `h` is on already (choosing another
 * language for it); turning something off never touches the others.
 */
export function turnOnWith(h: HelpItem, items: readonly HelpItem[], language: string | null, reader: string): TurnOn[] {
  if (h.on) return [];
  return relatedItems(h, items).filter((x) => !x.on).map((x) => ({ item: x, member: x.set ? relatedMember(x.set.set, language, reader) : null }));
}

/**
 * The say that turns an item on for a language's team, as its switch does:
 * what the language hid follows the organization again (a Bible only when
 * the organization recommends it), else it is recommended here.
 */
export function turnOnSay(itemId: string, kind: RefKind, r: RecState): ReferenceSay {
  const chosenOnly = kind === 'source' || kind === 'words';
  return { itemId, state: r.language === 'hidden' && (r.org || !chosenOnly) ? 'inherit' : 'recommended' };
}
