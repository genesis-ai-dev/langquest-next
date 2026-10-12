// Study guides published in several languages, chosen as one (decision 84).
// FIA's guides are one collection per language ("FIA study guides
// (French)"), so an admin chooses FIA and then the language its team reads,
// rather than one of fourteen look-alike rows. Collections that follow the
// same method from the same organization are one set; the members chosen
// for a language are what its team is offered, and the others stay out of
// the way (`chosenOnly`). Pure, so it is tested (test/guideSets.test.ts).
import {
  recommendedFor,
  type CollectionDoc, type LanguageRecommendation, type LanguageState, type LibraryDoc, type LibraryItemView, type Register
} from '@langquest-next/core';
import type { SharedItem } from '../library/model';
import { sameLanguage } from './languages';

/** Where a library item comes from: the organization it follows or was copied from; '' for one made here. */
export function originOf(it: Pick<LibraryItemView, 'subscription' | 'copiedFrom'>): string {
  return it.subscription?.sourceOrgId ?? it.copiedFrom?.orgId ?? '';
}

/** The method a collection follows ("FIA"): the document says, or an older one's title does. */
export function patternOf(doc: CollectionDoc): string | null {
  return doc.pattern || (/\bFIA\b/.test(doc.title) ? 'FIA' : null);
}

/** The set a document belongs to: a collection in one language that follows a method; null for anything else. */
export function setKeyOf(origin: string, doc: LibraryDoc | null | undefined): string | null {
  if (doc?.format !== 'collection@1' || !doc.language) return null;
  const pattern = patternOf(doc);
  return pattern ? `${origin}|${pattern}` : null;
}

export interface SetMember {
  /** This organization's library item, once it has the member. */
  itemId: string | null;
  /** What another organization shares, while this organization has not taken it. */
  shared: SharedItem | null;
  name: string;
  /** ISO 639-3. */
  language: string;
  /** How many passages it has a guide for. */
  passages: number;
}

export interface GuideSet {
  key: string;
  pattern: string;
  /** "FIA study guides": a member's name without its language. */
  name: string;
  /** One per language, the most passages first. */
  members: SetMember[];
}

/** "FIA study guides (French)" -> "FIA study guides". */
export function setName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}

/**
 * The sets among the organization's guides and what others share. A
 * language this organization already has is never offered again from
 * another organization's list, and a set needs two languages: a
 * collection in one language is just a guide.
 */
export function guideSets(
  own: readonly { it: LibraryItemView; doc: LibraryDoc | null }[],
  shared: readonly { s: SharedItem; doc: LibraryDoc | null }[]
): GuideSet[] {
  const sets = new Map<string, GuideSet>();
  const add = (key: string, doc: CollectionDoc, m: SetMember) => {
    const set = sets.get(key) ?? { key, pattern: patternOf(doc)!, name: setName(m.name), members: [] };
    if (!set.members.some((x) => sameLanguage(x.language, m.language))) set.members.push(m);
    sets.set(key, set);
  };
  for (const { it, doc } of own) {
    const key = setKeyOf(originOf(it), doc);
    if (key && !it.archived) add(key, doc as CollectionDoc, { itemId: it.itemId, shared: null, name: it.name, language: (doc as CollectionDoc).language!, passages: (doc as CollectionDoc).entries.length });
  }
  for (const { s, doc } of shared) {
    const key = setKeyOf(s.org_id, doc);
    if (key) add(key, doc as CollectionDoc, { itemId: null, shared: s, name: s.name, language: (doc as CollectionDoc).language!, passages: (doc as CollectionDoc).entries.length });
  }
  return [...sets.values()]
    .filter((set) => set.members.length > 1)
    .map((set) => ({ ...set, members: [...set.members].sort((a, b) => b.passages - a.passages || a.language.localeCompare(b.language)) }));
}

/**
 * What of a set reaches a language's team: the members recommended there
 * (by the organization or the language), else, for a language that never
 * chose, every member in the library it has not hidden, as any guide in the
 * library reaches (reference/offered.ts).
 */
export function setReach(set: GuideSet, orgRecs: Record<string, Register<boolean>> | undefined, state: LanguageState | null): SetMember[] {
  const rec = recommendedFor(orgRecs, state);
  const held = set.members.filter((m) => m.itemId);
  const chosen = held.filter((m) => rec.has(m.itemId!));
  if (chosen.length) return chosen;
  return held.filter((m) => state?.languageReferences[m.itemId!]?.value !== 'hidden');
}

/**
 * The member to suggest: the one already chosen when there is exactly one,
 * else the reader's language when the set has it, else English, else the
 * one with the most passages.
 */
export function suggestedMember(set: GuideSet, reader: string, chosen: readonly SetMember[] = []): SetMember {
  if (chosen.length === 1) return set.members.find((m) => m.language === chosen[0]!.language) ?? chosen[0]!;
  return set.members.find((m) => sameLanguage(m.language, reader))
    ?? set.members.find((m) => m.language === 'eng')
    ?? set.members[0]!;
}

/** One write in a language's own log: its say on one library item (`v1.ReferenceSet`). */
export interface ReferenceSay { itemId: string; state: LanguageRecommendation }

/**
 * The writes that make `itemId` the set's one language for a language's
 * team: it is recommended there and the set's other members in the library
 * are hidden there; and the writes that put each say back (Undo). `state`
 * is the language's, or null for a language not yet made.
 */
export function chooseSetLanguage(set: GuideSet, itemId: string, state: LanguageState | null): { says: ReferenceSay[]; undo: ReferenceSay[] } {
  const says: ReferenceSay[] = [];
  const undo: ReferenceSay[] = [];
  const now = (id: string) => state?.languageReferences[id]?.value ?? 'inherit';
  const set1 = (id: string, to: LanguageRecommendation) => {
    if (now(id) === to) return;
    says.push({ itemId: id, state: to });
    undo.push({ itemId: id, state: now(id) });
  };
  set1(itemId, 'recommended');
  for (const m of set.members) if (m.itemId && m.itemId !== itemId) set1(m.itemId, 'hidden');
  return { says, undo };
}

/** The writes that take a whole set away from a language's team, and their Undo. */
export function hideSet(set: GuideSet, state: LanguageState | null): { says: ReferenceSay[]; undo: ReferenceSay[] } {
  const says: ReferenceSay[] = [];
  const undo: ReferenceSay[] = [];
  for (const m of set.members) {
    const before = (m.itemId && state?.languageReferences[m.itemId]?.value) || 'inherit';
    if (!m.itemId || before === 'hidden') continue;
    says.push({ itemId: m.itemId, state: 'hidden' });
    undo.push({ itemId: m.itemId, state: before });
  }
  return { says, undo };
}

/** A guide source as the matcher sees it: its document, and where its item comes from. */
interface Source { hash: string; origin?: string }

/**
 * The guide sources a passage may use, without the set members its
 * language did not choose: once a member of a set is in the first group
 * (recommended or linked to the passage), the set's other members in the
 * later groups (the rest of the library) are left out, so a team that
 * chose French FIA is not handed English FIA where French has no guide.
 */
export function chosenOnly<T extends Source>(groups: readonly T[][], get: (hash: string) => LibraryDoc | null): T[][] {
  const [first = [], ...rest] = groups;
  const key = (s: T) => setKeyOf(s.origin ?? '', get(s.hash));
  const chosen = new Set(first.map(key).filter((k): k is string => !!k));
  if (!chosen.size) return groups.map((g) => [...g]);
  return [[...first], ...rest.map((g) => g.filter((s) => { const k = key(s); return !k || !chosen.has(k); }))];
}
