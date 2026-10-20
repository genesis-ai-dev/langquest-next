// What the coverage screen and the "What helps here" screen decide
// (screens/reference.tsx; docs/reference-material.md): a language's passages
// against the template's numbering, which recommended material reaches them,
// what the coverage list shows, and, for one passage, the helps it shows (with
// what each says there), the ones hidden, the ones to add and the event that
// shows or hides one. Pure: no React, so it is tested.
import {
  libraryUnitRange, linkedTo, languagePassages, passageLink, recommendedFor, unitTitle, versesInChapter,
  type Indexes, type KeyTermView, type LanguageState, type LibraryDoc, type MaterialView, type OrgState, type PassageNote,
  type RecommendationSource, type TemplateDoc, type VerseRange, type VersificationDoc
} from '@langquest-next/core';
import { t } from '../i18n';
import type { HelpPreview } from '../helps/helps';
import { keyLabel, plain, refInPassage } from '../helps/helpsModel';
import { termsInText } from '../recording/workspaceModel';
import { bestGuide } from '../study/guideMatch';
import type { IconName } from '../ui/kit';
import { coverage, type Reach, type ReachWhy } from './coverage';
import { chosenOnly } from './guideSets';
import { docLanguage, languagesLine } from './languages';
import { refKindLabel, sourceFacts, sourceSummary, type RefKind } from './model';
import { offeredGuideSources } from './offered';
import type { RefItem } from './useReference';

type Get = (hash: string | null | undefined) => LibraryDoc | null;

/** A language's passages with their verses in its template's numbering. */
export interface LanguagePassages {
  passages: { unitId: string; label: string; range: VerseRange | null }[];
  versification: VersificationDoc | null;
}

/** The versification of a language's template, when the template (`doc`) and its versification are loaded. */
export function templateVersification(doc: TemplateDoc | null, get: (hash: string) => LibraryDoc | null | undefined): VersificationDoc | null {
  return doc?.bible ? (get(doc.bible.versification) as VersificationDoc | null) : null;
}

/** The language's passages with their verses, in its template's numbering (`v11n`), when that is known. */
export function languagePassageList(state: LanguageState, indexes: Indexes, v11n: VersificationDoc | null): LanguagePassages {
  const versesIn = v11n ? (b: string, c: number) => versesInChapter(v11n, b, c) : undefined;
  const passages = languagePassages(state, indexes).map((unitId) => ({ unitId, label: unitTitle(state, unitId), range: libraryUnitRange(unitId, versesIn) }));
  return { passages, versification: v11n };
}

/** What the organization and the language recommend, of the items the library actually has. */
export function offeredAmong(orgRecs: Parameters<typeof recommendedFor>[0], state: LanguageState | null, rows: { it: { itemId: string } }[]): Map<string, RecommendationSource> {
  const have = new Set(rows.map((r) => r.it.itemId));
  return new Map([...recommendedFor(orgRecs, state)].filter(([id]) => have.has(id)));
}

/** Coverage of a language's passages by these items, with the language's links and hides. */
export function coverageFor(state: LanguageState, passages: LanguagePassages, offered: Map<string, RecommendationSource>, rows: RefItem[], get: Get, honourHides = true) {
  const parents = (unitId: string) => {
    const out: string[] = [];
    let at = state.units[unitId]?.parentUnitId ?? null;
    while (at && out.length < 20) { out.push(at); at = state.units[at]?.parentUnitId ?? null; }
    return out;
  };
  return coverage({
    passages: passages.passages, versification: passages.versification, offered,
    docs: new Map(rows.map((r) => [r.it.itemId, r.doc])), get,
    link: (u, i) => (honourHides ? passageLink(state, u, i) : passageLink(state, u, i) === true ? true : undefined),
    linkedHere: (u) => linkedTo(state, u),
    ancestors: parents
  });
}

// ---- the coverage list ----------------------------------------------------------------

export type CoverFilter = 'all' | 'bare' | 'notes';

const hasGuideOrNote = (reach: Reach[]) => reach.some((r) => r.kind === 'guide' || r.kind === 'note');

/** The passages the filter keeps: all, those no guide or note reaches, or those with a note. */
export function coverageShown<P extends { unitId: string }>(passages: P[], map: Map<string, Reach[]> | null, filter: CoverFilter): P[] {
  return passages.filter((p) => {
    const reach = map?.get(p.unitId) ?? [];
    if (filter === 'bare') return !hasGuideOrNote(reach);
    if (filter === 'notes') return reach.some((r) => r.kind === 'note');
    return true;
  });
}

const COVER_ORDER: Record<RefKind, number> = { source: 0, guide: 1, note: 2, words: 3, other: 4, questions: 5 };

/** One passage's row: what reaches it (Bibles, then guides, notes and the rest, by name) and whether no guide or note does. */
export function coverageRow(reach: Reach[], names: Map<string, string>): { what: string[]; bare: boolean } {
  return {
    bare: !hasGuideOrNote(reach),
    what: [...reach].sort((a, b) => COVER_ORDER[a.kind] - COVER_ORDER[b.kind]).map((r) => names.get(r.itemId) ?? r.itemId)
  };
}

/** What each item is called on the coverage list: a Bible by its abbreviation, anything else by name. */
export function coverageNames(rows: RefItem[]): Map<string, string> {
  return new Map(rows.map((r) => [r.it.itemId, r.doc?.format === 'source@1' ? r.doc.abbreviation : r.it.name]));
}

// ---- one passage ------------------------------------------------------------------------

export function whyLabel(why: ReachWhy): string {
  switch (why) {
    case 'organization': return t('reference.rec.byOrganization');
    case 'language': return t('reference.rec.forLanguage');
    case 'linked': return t('reference.passage.placedByHand');
  }
}

/** Guides first, then notes and other material; the Bibles, which the text above already opens, last. */
const ORDER: Record<RefKind, number> = { guide: 0, note: 1, words: 2, other: 3, questions: 4, source: 6 };

export const refIcon = (kind: RefKind): IconName => (kind === 'source' ? 'book' : kind === 'guide' ? 'sparkle' : kind === 'note' ? 'note' : kind === 'words' ? 'key' : 'layers');

/** What reaches one passage: shown here, and recommended but hidden here by hand. */
export function passageHelps(state: LanguageState, passage: LanguagePassages['passages'][number], v11n: VersificationDoc | null, offered: Map<string, RecommendationSource>, rows: RefItem[], get: Get) {
  const range = libraryUnitRange(passage.unitId, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined);
  const ps = { passages: [{ ...passage, range }], versification: v11n };
  const here = coverageFor(state, ps, offered, rows, get).get(passage.unitId) ?? [];
  const all = coverageFor(state, ps, offered, rows, get, false).get(passage.unitId) ?? [];
  const hidden = all.filter((r) => !here.some((h) => h.itemId === r.itemId));
  return { here, hidden, range, versification: v11n };
}

type Helps = ReturnType<typeof passageHelps>;

/** The materials written in the app for a passage that show beside the library's: not questions or key terms. */
export const writtenHelps = (all: MaterialView[]): MaterialView[] => all.filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms');

/** The notes translators see on this passage: on a verse, a run of verses, or the whole of it. */
export const visibleNotes = (all: PassageNote[]): PassageNote[] => all.filter((n) => n.anchor.kind === 'verse' || n.anchor.kind === 'passage');

/**
 * With nothing recommended or placed here that has a study, translators get one from the rest of the
 * organization's library (reference/offered.ts): it shows here too, and hiding it here takes it away.
 * Returns its item id, or null when something already has a study here or nothing fits.
 */
export function ownGuideItem(c: { org: OrgState | null; state: LanguageState; helps: Helps; unitId: string; rows: RefItem[]; get: Get; reads: string }): string | null {
  if (c.helps.here.some((r) => r.kind === 'guide')) return null;
  const o = offeredGuideSources(c.org?.library ?? {}, c.org?.recommendations, c.state, null);
  const [, own = []] = chosenOnly([o.recommended, o.own], (h) => c.get(h));
  const hit = bestGuide({ unitId: c.unitId, range: c.helps.range, versification: c.helps.versification }, [own], c.get, c.reads);
  const item = hit ? c.rows.find((r) => r.kind === 'guide' && r.it.current === hit.source.hash) : undefined;
  return item ? item.it.itemId : null;
}

/** Each guide's study for this passage (a collection's entry), by item id, to show its first step. */
export function guideStudies(c: { helps: Helps; ownGuide: string | null; unitId: string; rows: RefItem[]; get: Get; reads: string }): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of [...c.helps.here, ...c.helps.hidden, ...(c.ownGuide ? [{ itemId: c.ownGuide, kind: 'guide' as const }] : [])]) {
    const row = c.rows.find((x) => x.it.itemId === r.itemId);
    if (r.kind !== 'guide' || !row?.it.current) continue;
    const hit = bestGuide({ unitId: c.unitId, range: c.helps.range, versification: c.helps.versification }, [[{ key: r.itemId, hash: row.it.current }]], c.get, c.reads);
    if (hit) out.set(r.itemId, hit.hash);
  }
  return out;
}

const studyOf = (doc: LibraryDoc | null | undefined) => (doc && (doc.format === 'study@1' || doc.format === 'study@2') ? doc : undefined);

/** How many steps a guide's study for this passage has, when it is loaded. */
export function studySteps(doc: LibraryDoc | null | undefined): number | null {
  return studyOf(doc)?.steps.length ?? null;
}

/** What one library item says on this passage: a Bible's facts, a guide's first step, a note's key words or first words. */
export function helpPreview(c: {
  doc: LibraryDoc | null | undefined; study: LibraryDoc | null | undefined; range: VerseRange | null; verseText: string;
  get: Get; detail: (bibleId: string) => Parameters<typeof sourceFacts>[2];
}): HelpPreview | null {
  const doc = c.doc;
  if (!doc) return null;
  switch (doc.format) {
    case 'source@1': return { text: sourceSummary(sourceFacts(doc, c.get, doc.provider.kind === 'biblebrain' ? c.detail(doc.provider.bibleId) : null)) };
    case 'study@1': case 'study@2': case 'collection@1': {
      const first = studyOf(c.study)?.steps[0];
      return first ? { lead: t('reference.passageText.step', { n: 1 }), text: plain(first.title) } : null;
    }
    case 'material@1': {
      const refs = (doc.links ?? []).flatMap((l) => ('ref' in l ? [l.ref] : []));
      const lead = refInPassage(refs, c.range);
      const found = doc.terms?.filter((x) => termsInText(c.verseText, [{ termId: x.id, term: x.term }]).length > 0).map((x) => x.term) ?? [];
      const words = found.length ? found.join(' · ') : plain(doc.body ?? doc.fields?.[0]?.text ?? '');
      return words || lead ? { ...(lead ? { lead } : {}), text: words } : null;
    }
    default: return null;
  }
}

/** A help's card on one passage: what it is, what it says here, and whether it shows. */
export interface HelpRow {
  key: string;
  order: number;
  icon: IconName;
  name: string;
  sub: string;
  preview: HelpPreview | null;
  shown: boolean;
  onSet?: (shown: boolean) => void;
  /** The key words to show as chips under this card, when it is the key words card. */
  terms?: Pick<KeyTermView, 'termId' | 'term'>[];
}

/**
 * Every card of the passage's helps, in order: what reaches it (and, for an
 * admin, what is hidden here), the organization's own guide, the notes
 * translators left, what was written in the app and the key words in its
 * verses. `onLink` shows or hides one: an admin sees Show here / Hide here.
 */
export function helpCards(c: {
  state: LanguageState; unitId: string; helps: Helps; ownGuide: string | null; canManage: boolean;
  byId: Map<string, RefItem>; studies: { get(hash: string | null | undefined): LibraryDoc | null | undefined };
  guideFor: Map<string, string>; verseText: string; get: Get; detail: (bibleId: string) => Parameters<typeof sourceFacts>[2];
  notes: PassageNote[]; inApp: MaterialView[]; termsHere: Pick<KeyTermView, 'termId' | 'term'>[];
  onLink: (itemId: string, linked: boolean, message: string) => void;
}): HelpRow[] {
  const studyFor = (itemId: string) => c.studies.get(c.guideFor.get(itemId));
  const libraryRow = (r: Pick<Reach, 'itemId' | 'kind'>, why: string, shown: boolean): HelpRow => {
    const item = c.byId.get(r.itemId);
    const name = item?.it.name ?? r.itemId;
    const steps = r.kind === 'guide' ? studySteps(studyFor(r.itemId)) : null;
    return {
      key: r.itemId, order: ORDER[r.kind], icon: refIcon(r.kind), name, shown,
      sub: [steps ? t('reference.passageText.steps', { count: steps }) : null, languagesLine([docLanguage(item?.doc)]), shown ? why : t('reference.passage.hiddenHere')].filter(Boolean).join(' · '),
      preview: helpPreview({ doc: item?.doc, study: studyFor(r.itemId), range: c.helps.range, verseText: c.verseText, get: c.get, detail: c.detail }),
      ...(c.canManage ? {
        onSet: (on: boolean) => {
          if (on === shown) return;
          if (on) c.onLink(r.itemId, true, t('reference.passage.shownAgain', { name }));
          else c.onLink(r.itemId, false, t('reference.passage.hidden', { name }));
        }
      } : {})
    };
  };

  const ownShown = !!c.ownGuide && passageLink(c.state, c.unitId, c.ownGuide) !== false;
  const cards: HelpRow[] = [
    ...c.helps.here.map((r) => libraryRow(r, whyLabel(r.why), true)),
    ...(c.canManage ? c.helps.hidden.map((r) => libraryRow(r, whyLabel(r.why), false)) : []),
    ...(c.ownGuide && (ownShown || c.canManage) ? [libraryRow({ itemId: c.ownGuide, kind: 'guide' }, t('reference.passageText.fromOwn'), ownShown)] : [])
  ];
  if (c.notes.length) {
    const latest = c.notes[c.notes.length - 1]!;
    cards.push({
      key: 'notes', order: 2, icon: 'chat', name: t('reference.passage.notes'), shown: true,
      sub: t('reference.passageText.notesSub', { count: c.notes.length }),
      preview: {
        lead: latest.anchor.kind === 'verse' ? keyLabel(latest.anchor.verse) : t('reference.passageText.wholePassage'),
        text: latest.text ? plain(latest.text) : t('common.voiceNote')
      }
    });
  }
  for (const m of c.inApp) {
    const first = m.fields.find((f) => f.text?.trim())?.text;
    cards.push({ key: m.materialId, order: 2, icon: 'note', name: m.title, sub: t('reference.passage.placedInApp'), shown: true, preview: first ? { text: plain(first) } : null });
  }
  if (c.termsHere.length) {
    cards.push({
      key: 'terms', order: 5, icon: 'key', name: t('reference.passageText.keyWords'), shown: true,
      sub: t('reference.passageText.keyWordsSub', { count: c.termsHere.length }), preview: null, terms: c.termsHere
    });
  }
  return cards.sort((a, b) => a.order - b.order);
}

/** The library's items an admin can still place on this passage, narrowed by what they typed. */
export function addableHelps(rows: RefItem[], here: Pick<Reach, 'itemId'>[], query: string): RefItem[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((r) => r.kind && r.kind !== 'questions' && !r.it.archived && !here.some((h) => h.itemId === r.it.itemId))
    .filter((r) => !needle || r.it.name.toLowerCase().includes(needle));
}

/** A row in the Add a help list: the item's kind and language. */
export const addableLine = (r: RefItem): string => [refKindLabel(r.kind!), languagesLine([docLanguage(r.doc)])].join(' · ');

/** The event that shows (`linked`) or hides one item on a passage; `id` is a fresh event id. */
export function passageLinkSpec(id: string, unitId: string, itemId: string, linked: boolean) {
  return [{ id, type: 'v1.PassageReferenceLinked' as const, payload: { unitId, itemId, linked } }];
}
