// What a new language's team can be given from the start (decisions 84, 130,
// 146), as a function of library rows, documents, guide sets and the team's
// languages. The hook in useNewLanguageOffers.ts gathers those; no rendering.
import type { LibraryDoc, SourceDoc } from '@langquest-next/core';
import { t } from '../i18n';
import { guideShortName, languageLabel } from '../admin/adminModel';
import type { SharedItem } from '../library/model';
import { refKindOf } from '../reference/model';
import { isWordSet, setName, type GuideSet } from '../reference/guideSets';
import { memberIn } from '../reference/languageChoices';
import { docLanguage, languagesLine, sameLanguage } from '../reference/languages';
import type { MaterialChoice } from './newLanguage';

/** An item of this organization's own library, as the offers read it. */
export interface OwnMaterial { itemId: string; name: string; current: string | null }

/** Guide sets order FIA's first, examples last. */
export const fiaRank = (n: string) => (/fia/i.test(n) ? 0 : /example/i.test(n) ? 2 : 1);
/** The World English Bible first. */
export const webRank = (n: string) => (/world english/i.test(n) ? 0 : 1);

export const sharedKey = (s: { org_id: string; item_id: string }) => `${s.org_id}/${s.item_id}`;

/** Study guides as the offer note names them: "FIA's study guides in English", or without the language when they give none. */
export function guidesOffer(name: string, doc: LibraryDoc | null): string {
  const language = docLanguage(doc);
  return language ? t('org.offers.guidesIn', { name: guideShortName(name), language: languageLabel(language) }) : t('org.offers.guides', { name: guideShortName(name) });
}

/** A Bible as the offer note names it: "the World English Bible" (an English name that reads with "the"), else its name. */
export function bibleOffer(name: string): string {
  return /^World\b/.test(name) ? t('org.offers.theBible', { name }) : name;
}

function kindOfDoc(doc: LibraryDoc | null): MaterialChoice['kind'] | null {
  const k = refKindOf(doc);
  return k === 'source' ? 'source' : k === 'guide' ? 'guide' : k === 'words' ? 'words' : k === 'note' || k === 'other' ? 'note' : null;
}

export interface OfferInput {
  own: readonly OwnMaterial[];
  /** Other organizations' shared items not already followed here. */
  others: readonly SharedItem[];
  doc: (hash: string) => LibraryDoc | null;
  sets: readonly GuideSet[];
  /** The languages the team reads, the main one first. */
  readsAll: readonly string[];
}

/**
 * Every offer, in the order shown (Bibles, guide sets, then the rest), and
 * the keys ticked until someone changes them: one Bible (the organization's
 * own first, the World English Bible first of those), one set of guides
 * (FIA's first) and the key words that go with it.
 */
export function newLanguageOffers(input: OfferInput): { items: MaterialChoice[]; suggested: Set<string> } {
  const { own, others, sets, readsAll } = input;
  const reads = readsAll[0]!;
  const inTeam = (doc: LibraryDoc | null) => !!doc && readsAll.some((l) => sameLanguage(docLanguage(doc) ?? 'eng', l));
  // A set's members are its one row, not rows of their own.
  const inSets = new Set(sets.flatMap((set) => set.members.map((m) => m.itemId ?? (m.shared ? sharedKey(m.shared) : ''))));
  const setRows: MaterialChoice[] = [...sets].sort((a, b) => fiaRank(a.name) - fiaRank(b.name)).flatMap((set) => {
    const member = memberIn(set, reads);
    // A method's key words are a set of their own (decision 172), offered under Key words.
    const words = isWordSet(set);
    return member ? [{
      key: `set:${set.key}`, kind: words ? 'words' as const : 'guide' as const, itemId: member.itemId, shared: member.shared, name: member.name, set, member,
      label: words
        ? t('org.offers.wordsIn', { name: setName(set.name), language: languageLabel(member.language) })
        : t('org.offers.guidesIn', { name: guideShortName(set.name), language: languageLabel(member.language) }),
      sub: words
        ? t('referenceLanguage.setWords', { name: setName(set.name), count: member.passages })
        : t('referenceLanguage.setPassages', { name: guideShortName(set.name), count: member.passages })
    }] : [];
  });
  const row = (key: string, itemId: string | null, s: SharedItem | null, name: string, doc: LibraryDoc | null, kind: MaterialChoice['kind'], owner: string): MaterialChoice => ({
    key, kind, itemId, shared: s, name,
    label: kind === 'source' ? bibleOffer((doc as SourceDoc | null)?.name || name) : kind === 'guide' ? guidesOffer(name, doc) : name,
    sub: [languagesLine([docLanguage(doc)]), owner].filter(Boolean).join(' · ')
  });
  const ownRows = own.flatMap((it) => {
    const doc = it.current ? input.doc(it.current) : null;
    const kind = kindOfDoc(doc);
    return kind && inTeam(doc) && !inSets.has(it.itemId) ? [row(it.itemId, it.itemId, null, it.name, doc, kind, '')] : [];
  });
  const sharedRows = others.flatMap((s) => {
    const doc = input.doc(s.latest_hash!);
    const kind = kindOfDoc(doc);
    return kind && inTeam(doc) && !inSets.has(sharedKey(s)) ? [row(sharedKey(s), null, s, s.name, doc, kind, s.org_name)] : [];
  });
  const items = [...ownRows.filter((x) => x.kind === 'source'), ...sharedRows.filter((x) => x.kind === 'source'), ...setRows,
    ...ownRows.filter((x) => x.kind !== 'source'), ...sharedRows.filter((x) => x.kind !== 'source')];
  const firstBy = (list: MaterialChoice[], rank: (n: string) => number) => [...list].sort((a, b) => rank(a.name) - rank(b.name))[0];
  const bible = firstBy(ownRows.filter((x) => x.kind === 'source'), webRank) ?? firstBy(sharedRows.filter((x) => x.kind === 'source'), webRank);
  const guide = setRows.find((x) => x.kind === 'guide') ?? firstBy(ownRows.filter((x) => x.kind === 'guide'), fiaRank) ?? firstBy(sharedRows.filter((x) => x.kind === 'guide'), fiaRank);
  // The key words that go with the guides suggested come ticked with them (decision 172).
  const words = guide?.set ? setRows.find((x) => x.set?.key === `${guide.set!.key}|words`) : undefined;
  const suggested = new Set([bible?.key, guide?.key, words?.key].filter((k): k is string => !!k));
  return { items, suggested };
}
