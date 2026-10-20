// FIA's guides in several languages, chosen as one with its language, and
// every piece of reference material saying the language it is in
// (decisions.md 84; src/reference/guideSets.ts and languages.ts).
import { describe, expect, it } from 'vitest';
import {
  foldLanguage, foldOrg, libraryItemView, subscriptionItemId,
  type AnyEvent, type CollectionDoc, type LibraryDoc, type LibraryItemView, type MaterialDoc
} from '@langquest-next/core';
import type { SharedItem } from '../src/library/model';
import { chooseSetLanguage, chosenOnly, guideSets, hideSet, isWordSet, setKeyOf, setReach, suggestedMember, type GuideSet } from '../src/reference/guideSets';
import { biblesFor, hasMaterial, languageChoices, memberIn, startingLanguage } from '../src/reference/languageChoices';
import { docLanguage, languagesLine, readerLanguage, sameCodes, sameLanguage, teamLanguage } from '../src/reference/languages';
import { helpsSummary, languageLabel } from '../src/admin/adminModel';

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
    expect(choices[1]).toEqual({ language: 'fra', sets: [{ name: 'FIA study guides', passages: 12 }], words: [], bibles: 0, bibleIds: [], other: 1 });
    expect(choices[3]).toEqual({ language: 'amh', sets: [], words: [], bibles: 0, bibleIds: [], other: 0 });
    // Swahili is one language whether FIA or Bible Brain wrote it.
    expect(languageChoices(sets, [bible], ['swa']).filter((c) => sameLanguage(c.language, 'swa'))).toHaveLength(1);
  });

  it('counts every Bible a team could add: the library’s, each once, and Bible Brain’s that the library lacks', () => {
    const source = (bibleId: string | null, language = 'eng') => ({
      format: 'source@1', name: bibleId ?? 'BSB read by Frederick Surrey', abbreviation: 'X', language, versification: H('e'),
      provider: bibleId ? { kind: 'biblebrain', bibleId } : { kind: 'library' }, offline: 'allowed', copyright: {}, books: [], deps: []
    }) as LibraryDoc;
    // LangQuest's ESV and the organization's own copy of it are one Bible.
    const [eng, swa] = languageChoices([], [source('ENGESV'), source('ENGESV'), source('ENGKJV'), source(null), source('SWHSUV', 'swa')], []);
    expect(eng).toMatchObject({ language: 'eng', bibles: 3, bibleIds: ['ENGESV', 'ENGKJV'] });
    expect(biblesFor(eng!, new Map())).toBe(3);
    // Bible Brain's English adds what the library lacks; Swahili written `swa` takes Bible Brain's `swh`.
    const found = new Map([['eng', ['ENGESV', 'ENGKJV', 'ENGWEB', 'ENGNLT']], ['swh', ['SWHSUV', 'SWHBTK']]]);
    expect(biblesFor(eng!, found)).toBe(5);
    expect(biblesFor(swa!, found)).toBe(2);
    expect(sameCodes('SWA')).toEqual(['swa', 'swh']);
    expect(sameCodes('eng')).toEqual(['eng']);
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

describe('FIA\'s key words in several languages (decision 149)', () => {
  const words = (language: string, count: number, extra: Partial<MaterialDoc> = {}): MaterialDoc => ({
    format: 'material@1', kind: 'key_terms', title: `FIA key words (${language})`, language, pattern: 'FIA', deps: [],
    terms: Array.from({ length: count }, (_, i) => ({ id: `t${i + 1}`, term: `word ${i + 1}`, gloss: '' })), ...extra
  });

  it('makes FIA\'s key words a set of their own beside its guides, chosen apart, counting words', () => {
    const { own } = library();
    const sets = guideSets(own, [
      { s: shared('langquest.words.eng', 'FIA key words (English)'), doc: words('eng', 302) },
      { s: shared('langquest.words.fra', 'FIA key words (French)'), doc: words('fra', 280) }
    ]);
    expect(sets.map((x) => [x.key, x.name, isWordSet(x)])).toEqual([
      ['langquest|FIA', 'FIA study guides', false], ['langquest|FIA|words', 'FIA key words', true]
    ]);
    expect(sets[1]!.members.map((m) => [m.language, m.passages])).toEqual([['eng', 302], ['fra', 280]]);
    expect(setKeyOf('langquest', words('eng', 3))).toBe('langquest|FIA|words');
    // A key-word list without a method, or a note, is in no set.
    expect(setKeyOf('langquest', words('eng', 3, { pattern: undefined }))).toBeNull();
    expect(setKeyOf('langquest', { format: 'material@1', kind: 'note', title: 'FIA notes', language: 'eng', pattern: 'FIA', deps: [] })).toBeNull();
  });

  it('lists a language\'s key words by their words, never as passages of guides', () => {
    const { own } = library();
    const sets = guideSets(own, [
      { s: shared('langquest.words.eng', 'FIA key words (English)'), doc: words('eng', 302) },
      { s: shared('langquest.words.swa', 'FIA key words (Swahili)'), doc: words('swa', 120) }
    ]);
    const choices = languageChoices(sets, [], []);
    expect(choices.find((c) => c.language === 'eng')).toMatchObject({ sets: [{ name: 'FIA study guides', passages: 30 }], words: [{ name: 'FIA key words', words: 302 }] });
    const swa = choices.find((c) => c.language === 'swa')!;
    expect(swa).toMatchObject({ sets: [], words: [{ name: 'FIA key words', words: 120 }] });
    expect(hasMaterial(swa)).toBe(true);
  });
});
