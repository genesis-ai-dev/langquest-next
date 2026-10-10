// FIA's guides in several languages, chosen as one with its language, and
// every piece of reference material saying the language it is in
// (decisions.md 84; src/reference/guideSets.ts and languages.ts).
import { describe, expect, it } from 'vitest';
import {
  foldLanguage, foldOrg, libraryItemView, subscriptionItemId,
  type AnyEvent, type CollectionDoc, type LibraryDoc, type LibraryItemView, type MaterialDoc
} from '@langquest-next/core';
import type { SharedItem } from '../src/library/model';
import { chooseSetLanguage, chosenOnly, guideSets, hideSet, setReach, suggestedMember, type GuideSet } from '../src/reference/guideSets';
import { languageChoices, memberIn, startingLanguage } from '../src/reference/languageChoices';
import { docLanguage, languagesLine, readerLanguage, sameLanguage, teamLanguage } from '../src/reference/languages';
import { helpsSummary, languageLabel } from '../src/simple/adminModel';

const H = (c: string) => c.repeat(64);
let seq = 0;
const envelope = (type: string, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, orgId: 'o', streamId: '_org', actorId: 'admin', deviceId: 'd', hlc: `${String(++seq).padStart(15, '0')}:000000:d`, type, payload }) as AnyEvent;
const languageEnvelope = (type: string, payload: unknown): AnyEvent => ({ ...envelope(type, payload), streamId: 'L1' }) as AnyEvent;

const fia = (language: string, passages: number, extra: Partial<CollectionDoc> = {}): CollectionDoc => ({
  format: 'collection@1', title: `FIA study guides (${language})`, description: '', language, pattern: 'FIA', versification: H('e'),
  entries: Array.from({ length: passages }, (_, i) => ({ ref: `LUK ${i + 1}:1-5`, title: `Passage ${i + 1}`, doc: H('d') })), deps: [], ...extra
});
const shared = (item: string, name: string): SharedItem => ({
  org_id: 'langquest', org_name: 'LangQuest', item_id: item, kind: 'material', name, description: '', subscribable: true, version_count: 1, latest_hash: H(item.slice(-1)), updated_hlc: ''
});

/** An organization following LangQuest's English and French FIA, and writing a note of its own. */
function library() {
  const follow = (item: string, name: string, hash: string) => {
    const itemId = subscriptionItemId('langquest', item);
    return [
      envelope('v1.LibrarySubscribed', { itemId, kind: 'material', sourceOrgId: 'langquest', sourceOrgName: 'LangQuest', sourceItemId: item, name, autoUpdate: true, active: true }),
      envelope('v1.LibraryPinned', { itemId, kind: 'material', docHash: hash })
    ];
  };
  const org = foldOrg([
    ...follow('langquest.fia.eng', 'FIA study guides (English)', H('1')),
    ...follow('langquest.fia.fra', 'FIA study guides (French)', H('2')),
    envelope('v1.LibraryItemDefined', { itemId: 'note', kind: 'material', name: 'HIV awareness', description: '' }),
    envelope('v1.LibraryVersionPublished', { itemId: 'note', kind: 'material', docHash: H('3') })
  ]);
  const view = (id: string) => libraryItemView(org.library, id)!;
  const docs: Record<string, LibraryDoc> = {
    [H('1')]: fia('eng', 30), [H('2')]: fia('fra', 12),
    [H('3')]: { format: 'material@1', kind: 'note', title: 'HIV awareness', language: 'eng', deps: [] } satisfies MaterialDoc,
    [H('4')]: fia('hin', 20), [H('5')]: fia('swa', 8)
  };
  const own = ['sub.langquest.langquest.fia.eng', 'sub.langquest.langquest.fia.fra', 'note'].map((id) => ({ it: view(id), doc: docs[view(id).current!]! }));
  return { org, docs, own, eng: own[0]!.it, fra: own[1]!.it };
}

describe('the language reference material is in', () => {
  it('names the app’s languages as material writes them, and takes a macrolanguage for the language it means', () => {
    expect(readerLanguage('fr')).toBe('fra');
    expect(readerLanguage('sw')).toBe('swa');
    expect(readerLanguage('zh-Hans')).toBe('cmn');
    expect(readerLanguage('ar')).toBe('arb');
    expect(sameLanguage('swa', 'swh')).toBe(true);
    expect(sameLanguage('SWH', 'swa')).toBe(true);
    expect(sameLanguage('fra', 'eng')).toBe(false);
    expect(sameLanguage(null, 'eng')).toBe(false);
  });

  it('reads every kind of document’s language, and says plainly when material gives none', () => {
    const { docs } = library();
    expect(docLanguage(docs[H('1')])).toBe('eng');
    expect(docLanguage(docs[H('3')])).toBe('eng');
    expect(docLanguage({ format: 'material@1', kind: 'note', title: 'Old note', deps: [] })).toBeNull();
    expect(languagesLine(['fra', 'eng'])).toBe('French and English');
    expect(languagesLine([null])).toBe('Language not given');
  });

  it('has a name for each of FIA’s fourteen languages', () => {
    const fiaLanguages = ['eng', 'arb', 'hin', 'por', 'fra', 'cmn', 'ind', 'rus', 'swa', 'spa', 'tpi', 'apd', 'fas', 'bis'];
    for (const code of fiaLanguages) expect(languageLabel(code)).not.toBe(code.toUpperCase());
    expect(languageLabel('tpi')).toBe('Tok Pisin');
    expect(languageLabel('apd')).toBe('Sudanese Arabic');
  });

  it('says a guide’s language in a language’s summary', () => {
    expect(helpsSummary(['English'], [{ name: 'FIA', language: 'French' }], 1)).toBe('English Bible · FIA guides in French · 1 note');
    expect(helpsSummary([], [{ name: 'FIA', language: 'French' }, { name: 'FIA', language: 'English' }, 'Examples'], 0))
      .toBe('Examples guides · FIA guides in French and English');
  });
});

describe('a guide set in several languages', () => {
  it('makes one set of FIA’s languages, from the library and from what LangQuest shares, the most passages first', () => {
    const { own, docs } = library();
    const sets = guideSets(own, [
      { s: shared('langquest.fia.hin', 'FIA study guides (Hindi)'), doc: docs[H('4')]! },
      // Already followed: offered once, from the library.
      { s: shared('langquest.fia.fra', 'FIA study guides (French)'), doc: docs[H('2')]! }
    ]);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.name).toBe('FIA study guides');
    expect(sets[0]!.members.map((m) => [m.language, m.passages, m.itemId ?? m.shared?.item_id])).toEqual([
      ['eng', 30, 'sub.langquest.langquest.fia.eng'], ['hin', 20, 'langquest.fia.hin'], ['fra', 12, 'sub.langquest.langquest.fia.fra']
    ]);
  });

  it('is no set with one language, nor for collections without a method or from another organization', () => {
    const { own, docs } = library();
    expect(guideSets([own[0]!, own[2]!], [])).toEqual([]);
    const other = { ...shared('fia.swa', 'FIA (Swahili)'), org_id: 'someone' };
    expect(guideSets([own[0]!], [{ s: other, doc: docs[H('5')]! }])).toEqual([]);
    // An older collection says FIA in its title only.
    const older = fia('hin', 3, { pattern: undefined });
    expect(guideSets([own[0]!], [{ s: shared('langquest.fia.hin', 'FIA study guides (Hindi)'), doc: older }])[0]!.members).toHaveLength(2);
  });

  const setOf = () => {
    const { own, org } = library();
    return { set: guideSets(own, [])[0]!, org };
  };
  const languages = (ms: { language: string }[]) => ms.map((m) => m.language);

  it('reaches a team in the languages chosen for it, or, before any is chosen, in every language the library has', () => {
    const { set, org } = setOf();
    const fra = set.members.find((m) => m.language === 'fra')!.itemId!;
    const eng = set.members.find((m) => m.language === 'eng')!.itemId!;
    expect(languages(setReach(set, org.recommendations, foldLanguage([])))).toEqual(['eng', 'fra']);
    const chose = foldLanguage([languageEnvelope('v1.ReferenceSet', { itemId: fra, state: 'recommended' })]);
    expect(languages(setReach(set, org.recommendations, chose))).toEqual(['fra']);
    // The organization recommending English is a choice too, until the language hides it.
    const orgRecs = foldOrg([envelope('v1.ReferenceRecommended', { itemId: eng, recommended: true })]).recommendations;
    expect(languages(setReach(set, orgRecs, chose))).toEqual(['eng', 'fra']);
    const hid = foldLanguage([languageEnvelope('v1.ReferenceSet', { itemId: eng, state: 'hidden' })]);
    expect(languages(setReach(set, org.recommendations, hid))).toEqual(['fra']);
  });

  it('suggests the language chosen, else the reader’s, else English', () => {
    const { set } = setOf();
    expect(suggestedMember(set, 'fra').language).toBe('fra');
    expect(suggestedMember(set, 'amh').language).toBe('eng');
    expect(suggestedMember(set, 'eng', [set.members[1]!]).language).toBe('fra');
    const noEnglish: GuideSet = { ...set, members: set.members.filter((m) => m.language !== 'eng') };
    expect(suggestedMember(noEnglish, 'amh').language).toBe('fra');
  });

  it('chooses one language for a team: recommends it, hides the set’s others in the library, and can put each back', () => {
    const { set } = setOf();
    const [eng, fra] = [set.members[0]!.itemId!, set.members[1]!.itemId!];
    expect(chooseSetLanguage(set, fra, null)).toEqual({
      says: [{ itemId: fra, state: 'recommended' }, { itemId: eng, state: 'hidden' }],
      undo: [{ itemId: fra, state: 'inherit' }, { itemId: eng, state: 'inherit' }]
    });
    const was = foldLanguage([
      languageEnvelope('v1.ReferenceSet', { itemId: eng, state: 'recommended' }),
      languageEnvelope('v1.ReferenceSet', { itemId: fra, state: 'hidden' })
    ]);
    expect(chooseSetLanguage(set, fra, was)).toEqual({
      says: [{ itemId: fra, state: 'recommended' }, { itemId: eng, state: 'hidden' }],
      undo: [{ itemId: fra, state: 'hidden' }, { itemId: eng, state: 'recommended' }]
    });
    // Choosing what is already chosen writes nothing.
    const done = foldLanguage([
      languageEnvelope('v1.ReferenceSet', { itemId: fra, state: 'recommended' }),
      languageEnvelope('v1.ReferenceSet', { itemId: eng, state: 'hidden' })
    ]);
    expect(chooseSetLanguage(set, fra, done).says).toEqual([]);
    expect(hideSet(set, done)).toEqual({ says: [{ itemId: fra, state: 'hidden' }], undo: [{ itemId: fra, state: 'recommended' }] });
  });

  it('leaves a set’s unchosen languages out of a passage’s guides, and anything else as it was', () => {
    const { docs, eng, fra } = library();
    const get = (h: string) => docs[h] ?? null;
    const src = (it: LibraryItemView) => ({ key: it.itemId, hash: it.current!, origin: 'langquest' });
    const note = { key: 'note', hash: H('3'), origin: '' };
    expect(chosenOnly([[src(fra)], [src(eng), note]], get)).toEqual([[src(fra)], [note]]);
    expect(chosenOnly([[], [src(eng), src(fra), note]], get)).toEqual([[], [src(eng), src(fra), note]]);
    // FIA from another organization is another set: it stays.
    const theirs = { ...src(eng), origin: 'someone' };
    expect(chosenOnly([[src(fra)], [theirs]], get)).toEqual([[src(fra)], [theirs]]);
  });
});

describe('the language a team’s reference material is in', () => {
  it('lists each language with what is in it, the most to read first, and keeps the chosen, the reader’s and English', () => {
    const { own } = library();
    const sets = guideSets(own, []);
    const bible = { format: 'source@1', name: 'Swahili Union Version', abbreviation: 'SUV', language: 'swh', versification: H('e'), provider: { kind: 'library' }, offline: 'allowed', copyright: {}, books: [], deps: [] } as LibraryDoc;
    const note = { format: 'material@1', kind: 'note', title: 'Names in Ruth', language: 'fra', deps: [] } as LibraryDoc;
    const questions = { format: 'material@1', kind: 'questions', title: 'Checks', language: 'amh', deps: [] } as LibraryDoc;
    const choices = languageChoices(sets, [bible, note, questions, null], ['amh', 'eng']);
    expect(choices.map((c) => c.language)).toEqual(['eng', 'fra', 'swh', 'amh']);
    expect(choices[1]).toEqual({ language: 'fra', sets: [{ name: 'FIA study guides', passages: 12 }], bibles: 0, other: 1 });
    expect(choices[3]).toEqual({ language: 'amh', sets: [], bibles: 0, other: 0 });
    // Swahili is one language whether FIA or Bible Brain wrote it.
    expect(languageChoices(sets, [bible], ['swa']).filter((c) => sameLanguage(c.language, 'swa'))).toHaveLength(1);
  });

  it('starts from the reader’s language when there is anything in it, else English', () => {
    const { own } = library();
    const choices = languageChoices(guideSets(own, []), [], ['amh']);
    expect(startingLanguage(choices, 'fra')).toBe('fra');
    expect(startingLanguage(choices, 'amh')).toBe('eng');
    expect(memberIn(guideSets(own, [])[0]!, 'fra')?.passages).toBe(12);
    expect(memberIn(guideSets(own, [])[0]!, 'amh')).toBeNull();
  });

  it('is the team’s own setting, else the language it was added with, else English', () => {
    const org = foldOrg([envelope('v1.LanguageAdded', { languageId: 'L1', name: 'Sidamo', code: 'sid', sourceCode: 'fra' })]);
    expect(teamLanguage(org, foldLanguage([]), 'L1')).toBe('fra');
    expect(teamLanguage(org, foldLanguage([languageEnvelope('v1.ReferenceLanguageSet', { language: 'swa' })]), 'L1')).toBe('swa');
    expect(teamLanguage(null, null, 'L1')).toBe('eng');
  });
});
