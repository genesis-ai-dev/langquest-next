// Key-word lists (decision 172, keyTerms/listsModel.ts): the forms a word is
// found by, which words show on a passage (linked across numberings, or said
// in a Bible in the list's language), the team's own left out, the ids that
// keep the team's word and the list's one word, and one search across the
// team's words and every list. And the passage's Key words card with them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldLanguage, foldOrg, libraryItemView, subscriptionItemId, type AnyEvent, type KeyWordDoc, type LibraryDoc, type MaterialDoc, type VerseRange, type VersificationDoc } from '@langquest-next/core';
import { markTerms } from '../src/recording/workspaceModel';
import {
  chosenItemIds, guideTermWord, keyWordList, listsReaching, ownTermId, ownWordOf, shortName, splitOwn, wordForms, wordOfTermId, wordsOnPassage, type KeyWordList
} from '../src/keyTerms/listsModel';
import { keyWordResults, linkedPassages, listChips, listWordOf, meaningParagraphs, plainMeaning, searchLists } from '../src/keyTerms/searchModel';
import { helpCards } from '../src/reference/passagesModel';
import { latestVoice, reviewCounts, reviewWords } from '../src/keyTerms/reviewWordsModel';

function loadV11n(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications', `${code}.json`), 'utf8'));
  return {
    format: 'versification@1', code, name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {}, excludedVerses: raw.excludedVerses ?? [], partialVerses: raw.partialVerses ?? {}
  };
}
const eng = loadV11n('eng');
const org = loadV11n('org');
const ENG = 'e'.repeat(64);
const ORG = 'o'.repeat(64);
const versificationOf = (h: string) => (h === ENG ? eng : h === ORG ? org : null);

const w = (id: string, term: string, gloss: string, over: Partial<KeyWordDoc> = {}): KeyWordDoc => ({ id, term, gloss, ...over });
const listDoc = (terms: KeyWordDoc[], over: Partial<MaterialDoc> = {}): MaterialDoc => ({
  format: 'material@1', kind: 'key_terms', title: 'FIA key words', language: 'eng', pattern: 'FIA', versification: ENG,
  source: 'fia.bible · English · © 2025 Word Collective, CC BY-SA 4.0', terms, deps: [], ...over
} as MaterialDoc);

const WORDS = [
  w('t104', 'prophet', 'a person who gives messages from God to the people', { links: [{ ref: 'LUK 13:31-35' }, { ref: 'LUK 4:24' }], body: 'A prophet tells what God says. They said the people had [sinned](#t120).' }),
  w('t105', 'prophecy', 'the message from God that a prophet gives'),
  w('t106', 'prophesy', 'when a person speaks a message from God'),
  w('t30', 'demon', 'evil spirit'),
  w('t80', 'Lord', 'Jewish way of referring to God'),
  w('t20', 'bless', 'to do or promise to do something good for a person'),
  w('t60', 'Jerusalem', 'the capital city of Israel'),
  w('t70', 'Herod', 'a king of the Jews', { links: [{ ref: 'LUK 13:31' }] }),
  w('t40', 'Elijah', 'name of an important prophet in Israel', { links: [{ ref: 'MAL 4:5' }] }),
  w('t41', 'Isaiah', 'name of a prophet in Israel'),
  w('t50', 'Moses', 'the leader who brought Israel out of Egypt', { body: 'God spoke to **Moses** as to a prophet.' }),
  w('t120', 'sin', 'to disobey God'),
  w('t25', 'clean/unclean', 'fit or not fit to be near God', { match: ['purify'] })
];
const fia = keyWordList('fia-eng', 'FIA key words (English)', listDoc(WORDS))!;
const french = keyWordList('fia-fra', 'Mots clés FIA (français)', listDoc([w('t104', 'prophète', 'une personne qui transmet les messages de Dieu', { match: ['prophètes'] })], { language: 'fra' }))!;
const teamList = keyWordList('lib-words', 'Our team words', listDoc([w('w1', 'shepherd', 'one who keeps sheep')], { pattern: undefined, versification: undefined }))!;

const LUKE: VerseRange = { book: 'LUK', start: { chapter: 13, verse: 31 }, end: { chapter: 13, verse: 35 } };
const ROWS = [
  { key: '13:31', text: 'At that very hour some Pharisees came and said to him, “Get away from here.”' },
  { key: '13:32', text: 'And he said to them, “Go and tell that fox, Behold, I cast out demons.”' },
  { key: '13:33', text: 'For it cannot be that a prophet should perish away from Jerusalem.' },
  { key: '13:34', text: 'O Jerusalem, Jerusalem, the city that kills the prophets!' },
  { key: '13:35', text: 'Blessed is he who comes in the name of the Lord!' }
];
const here = (c: Partial<Parameters<typeof wordsOnPassage>[0]> = {}) => wordsOnPassage({
  lists: [fia], range: LUKE, numbering: eng, versificationOf, bibles: [{ language: 'eng', rows: ROWS }], own: [], ...c
});

describe('a key-word list', () => {
  it('is a material of kind key_terms that holds words', () => {
    expect(fia).toMatchObject({ itemId: 'fia-eng', language: 'eng', pattern: 'FIA', versification: ENG });
    expect(fia.words).toHaveLength(WORDS.length);
    expect(keyWordList('x', 'x', listDoc([]))).toBeNull();
    expect(keyWordList('x', 'x', { ...listDoc(WORDS), kind: 'note' } as LibraryDoc)).toBeNull();
    expect(keyWordList('x', 'x', null)).toBeNull();
    expect(shortName(fia)).toBe('FIA');
    expect(shortName(teamList)).toBe('Our team words');
  });
});

describe('the forms a word is found by', () => {
  it('adds English endings for plurals and past tenses', () => {
    expect(wordForms(w('a', 'prophet', ''), 'eng')).toEqual(expect.arrayContaining(['prophet', 'prophets']));
    expect(wordForms(w('a', 'Pharisee', ''), 'eng')).toEqual(expect.arrayContaining(['pharisee', 'pharisees']));
    expect(wordForms(w('a', 'anoint', ''), 'eng')).toEqual(expect.arrayContaining(['anointed', 'anointing']));
    expect(wordForms(w('a', 'bless', ''), 'eng')).toEqual(expect.arrayContaining(['blessed', 'blesses', 'blessing']));
  });

  it('takes each side of "clean/unclean", and the other forms the list gives', () => {
    const forms = wordForms(w('t25', 'clean/unclean', '', { match: ['purify'] }), 'eng');
    expect(forms).toEqual(expect.arrayContaining(['clean', 'unclean', 'uncleaned', 'purify']));
    const found = markTerms('The man was unclean until evening.', forms.map((f) => ({ termId: 't25', term: f })));
    expect(found.find((p) => p.termId)?.text).toBe('unclean');
  });

  it('adds no endings to phrases or to other languages', () => {
    expect(wordForms(w('a', 'Holy Spirit', ''), 'eng')).toEqual(['holy spirit']);
    expect(wordForms(w('a', 'prophète', '', { match: ['prophètes'] }), 'fra')).toEqual(['prophète', 'prophètes']);
    expect(wordForms(w('a', 'x', '', { match: ['y', 'ox'] }), 'fra')).toEqual(['ox']);
  });
});

describe('which list words show on a passage', () => {
  it('finds words said in the Bible, first verse first, with the form the verse uses', () => {
    const got = here();
    expect(got.map((x) => x.word.term)).toEqual(['demon', 'Jerusalem', 'prophet', 'bless', 'Lord', 'Herod']);
    expect(got.find((x) => x.word.id === 't104')).toMatchObject({ verses: ['13:33', '13:34'], form: null, linked: true });
    expect(got.find((x) => x.word.id === 't30')).toMatchObject({ verses: ['13:32'], form: 'demons', linked: false });
    expect(got.find((x) => x.word.id === 't20')).toMatchObject({ verses: ['13:35'], form: 'Blessed' });
  });

  it('puts words only linked to the passage last, with no verses', () => {
    const got = here();
    expect(got[got.length - 1]).toMatchObject({ word: { id: 't70' }, verses: [], form: null, linked: true });
  });

  it('reads a link and the passage each in its own numbering', () => {
    // FIA numbers Malachi as English Bibles do (4:5); the team's template as the original (3:23).
    const inOrg = here({ range: { book: 'MAL', start: { chapter: 3, verse: 22 }, end: { chapter: 3, verse: 24 } }, numbering: org, bibles: [] });
    expect(inOrg.map((x) => x.word.id)).toEqual(['t40']);
    const notThere = here({ range: { book: 'MAL', start: { chapter: 3, verse: 1 }, end: { chapter: 3, verse: 5 } }, numbering: org, bibles: [] });
    expect(notThere).toEqual([]);
    const inEng = here({ range: { book: 'MAL', start: { chapter: 4, verse: 5 }, end: { chapter: 4, verse: 6 } }, numbering: eng, bibles: [] });
    expect(inEng.map((x) => x.word.id)).toEqual(['t40']);
  });

  it('matches plain verse numbers when neither numbering is known', () => {
    const bare = keyWordList('bare', 'Bare', listDoc([w('t40', 'Elijah', '', { links: [{ ref: 'MAL 4:5' }] })], { versification: undefined }))!;
    const got = wordsOnPassage({ lists: [bare], range: { book: 'MAL', start: { chapter: 4, verse: 1 }, end: { chapter: 4, verse: 6 } }, numbering: null, versificationOf, bibles: [], own: [] });
    expect(got.map((x) => x.word.id)).toEqual(['t40']);
  });

  it('looks for a list’s words only in a Bible in the list’s language', () => {
    expect(wordsOnPassage({ lists: [french], range: LUKE, numbering: eng, versificationOf, bibles: [{ language: 'eng', rows: ROWS }], own: [] })).toEqual([]);
    const frRows = [{ key: '13:33', text: 'il ne convient pas qu’un prophète périsse hors de Jérusalem.' }, { key: '13:34', text: 'toi qui tues les prophètes' }];
    const fr = wordsOnPassage({ lists: [french], range: LUKE, numbering: eng, versificationOf, bibles: [{ language: 'fra', rows: frRows }], own: [] });
    expect(fr).toMatchObject([{ word: { id: 't104' }, verses: ['13:33', '13:34'], form: null }]);
    // English words in a French Bible are not looked for; links still count (both only linked: by the word).
    expect(here({ bibles: [{ language: 'fra', rows: ROWS }] }).map((x) => x.word.id)).toEqual(['t70', 't104']);
  });

  it('leaves out the words the team has made its own, by id or by the same word', () => {
    const got = here({ own: [{ termId: 'fia:t80', term: 'Master' }, { termId: 'kt-1', term: 'jerusalem ' }] });
    expect(got.map((x) => x.word.term)).toEqual(['demon', 'prophet', 'bless', 'Herod']);
  });

  it('splits off the team’s own words, each once, to show with the team’s', () => {
    const own = [{ termId: 'fia:t104', term: 'prophet' }, { termId: 'kt-1', term: 'Jerusalem' }, { termId: 'kt-2', term: 'grace' }];
    const split = splitOwn(here(), own);
    expect(split.own.map((x) => x.termId)).toEqual(['kt-1', 'fia:t104']);
    expect(split.words.map((x) => x.word.id)).toEqual(['t30', 't20', 't80', 't70']);
  });
});

describe('the team’s word and the list’s stay one', () => {
  it('keeps FIA’s id as fia:<id>, and another list’s as its item id', () => {
    expect(ownTermId(fia, { id: 't104' })).toBe('fia:t104');
    expect(ownTermId(teamList, { id: 'w1' })).toBe('lib-words:w1');
  });

  it('finds the list word a team’s word came from', () => {
    expect(wordOfTermId([teamList, fia], 'fia:t104')).toMatchObject({ list: { itemId: 'fia-eng' }, word: { term: 'prophet' } });
    expect(wordOfTermId([teamList, fia], 'lib-words:w1')).toMatchObject({ list: { itemId: 'lib-words' }, word: { term: 'shepherd' } });
    expect(wordOfTermId([fia], 'fia:t999')).toBeNull();
    expect(wordOfTermId([fia], 'kt-1')).toBeNull();
  });

  it('knows the team’s word for a list word, by id first, then by spelling', () => {
    const own = [{ termId: 'kt-9', term: 'Prophet' }, { termId: 'fia:t104', term: 'seer' }];
    expect(ownWordOf(fia, WORDS[0]!, own)?.termId).toBe('fia:t104');
    expect(ownWordOf(fia, WORDS[0]!, own.slice(0, 1))?.termId).toBe('kt-9');
    expect(ownWordOf(fia, WORDS[3]!, own)).toBeNull();
    expect(listWordOf([fia], { termId: 'kt-1', term: 'jerusalem' })?.word.id).toBe('t60');
    expect(listWordOf([fia], { termId: 'kt-2', term: 'grace' })).toBeNull();
  });

  it('finds the word a guide’s glossary link opens in a list of the guide’s method', () => {
    expect(guideTermWord([teamList, fia], 'FIA', 't104')?.word.term).toBe('prophet');
    expect(guideTermWord([fia], 'fia', 't104')?.word.term).toBe('prophet');
    expect(guideTermWord([fia], 'FIA', 't999')).toBeNull();
    expect(guideTermWord([fia], null, 't104')).toBeNull();
    expect(guideTermWord([teamList], 'FIA', 'w1')).toBeNull();
  });
});

describe('a word’s meaning and links', () => {
  it('reads the full meaning without markdown', () => {
    expect(plainMeaning('God has [mercy](#t91) on **all** of __them__.')).toBe('God has mercy on all of them.');
    expect(plainMeaning(undefined)).toBe('');
  });

  it('splits the full meaning into paragraphs, linking only the list’s own words', () => {
    const ids = new Set(fia.words.map((x) => x.id));
    const paras = meaningParagraphs('A __prophet__ said they had [sinned](#t120).\n\nSee the [map](#m3).', ids);
    expect(paras).toEqual([
      [{ type: 'text', text: 'A ' }, { type: 'bold', text: 'prophet' }, { type: 'text', text: ' said they had ' }, { type: 'word', text: 'sinned', id: 't120' }, { type: 'text', text: '.' }],
      [{ type: 'text', text: 'See the ' }, { type: 'text', text: 'map' }, { type: 'text', text: '.' }]
    ]);
    expect(meaningParagraphs('', ids)).toEqual([]);
  });

  it('counts the passages a word is linked to, and their books', () => {
    expect(linkedPassages(WORDS[0]!)).toEqual({ count: 2, books: ['LUK'] });
    expect(linkedPassages({ links: [{ ref: 'LUK 4:24' }, { ref: 'MAT 13:57' }, { template: 'fia', node: 'x' }] })).toEqual({ count: 3, books: ['LUK', 'MAT'] });
    expect(linkedPassages({})).toEqual({ count: 0, books: [] });
  });
});

describe('searching the lists', () => {
  it('finds by the word, then the short meaning, then the full meaning; words that start with it first', () => {
    const got = searchLists([fia], 'proph');
    expect(got.map((x) => [x.word.term, x.by])).toEqual([
      ['prophecy', 'word'], ['prophesy', 'word'], ['prophet', 'word'], ['Elijah', 'gloss'], ['Isaiah', 'gloss'], ['Moses', 'meaning']
    ]);
    const lord = keyWordList('l', 'L', listDoc([w('a', 'landlord', ''), w('b', 'Lord', '')]))!;
    expect(searchLists([lord], 'lord').map((x) => x.word.term)).toEqual(['Lord', 'landlord']);
    expect(searchLists([fia], 'purify').map((x) => x.word.id)).toEqual(['t25']);
    expect(searchLists([fia], '  ')).toEqual([]);
  });

  it('names each list’s chip by its short name, or its full name when two share one', () => {
    expect(listChips([fia, teamList])).toEqual([{ id: 'fia-eng', label: 'FIA' }, { id: 'lib-words', label: 'Our team words' }]);
    expect(listChips([fia, french]).map((c) => c.label)).toEqual(['FIA key words (English)', 'Mots clés FIA (français)']);
  });
});

describe('the Key words screen’s one search', () => {
  const own = [
    { termId: 'fia:t104', term: 'prophet', gloss: '' },
    { termId: 'kt-1', term: 'Jerusalem', gloss: 'the city' },
    { termId: 'kt-2', term: 'grace', gloss: 'favour no one earns' }
  ];
  const lists: KeyWordList[] = [fia, teamList];

  it('makes the team’s word and the list word it came from one row, in sections', () => {
    const r = keyWordResults({ own, lists, query: 'proph', filter: 'all' });
    expect(r.words.map((x) => [x.term, !!x.own, x.from?.word.id ?? null])).toEqual([['prophecy', false, 't105'], ['prophesy', false, 't106'], ['prophet', true, 't104']]);
    // The team wrote no meaning: the list's shows.
    expect(r.words[2]!.gloss).toBe(WORDS[0]!.gloss);
    expect(r.inGloss.map((x) => x.term)).toEqual(['Elijah', 'Isaiah']);
    expect(r.inMeaning.map((x) => x.term)).toEqual(['Moses']);
  });

  it('keeps to the team’s words, or to one list', () => {
    const ours = keyWordResults({ own, lists, query: 'proph', filter: 'ours' });
    expect(ours.words.map((x) => x.key)).toEqual(['fia:t104']);
    expect(ours.inGloss).toEqual([]);
    const team = keyWordResults({ own, lists, query: '', filter: 'lib-words' });
    expect(team.words.map((x) => x.term)).toEqual(['shepherd']);
    const fiaOnly = keyWordResults({ own, lists, query: '', filter: 'fia-eng' });
    expect(fiaOnly.words).toHaveLength(WORDS.length);
    expect(fiaOnly.words.filter((x) => x.own).map((x) => x.key)).toEqual(['kt-1', 'fia:t104']);
  });

  it('with nothing typed finds every word, the team’s merged with the list’s', () => {
    const r = keyWordResults({ own, lists, query: '', filter: 'all' });
    expect(r.words).toHaveLength(WORDS.length + 1 + 1); // every list word, shepherd, and grace; prophet and Jerusalem once each
    expect(r.words.filter((x) => x.term === 'Jerusalem')).toHaveLength(1);
    expect(r.inGloss).toEqual([]);
  });

  it('finds the team’s word by its own meaning', () => {
    expect(keyWordResults({ own, lists, query: 'favour', filter: 'all' }).inGloss.map((x) => x.key)).toEqual(['kt-2']);
  });
});

describe('the passage’s Key words card', () => {
  const base = {
    state: foldLanguage([]), unitId: 'u', ownGuide: null, canManage: false, byId: new Map(), studies: new Map<string, LibraryDoc>(), guideFor: new Map<string, string>(),
    verseText: '', get: () => null, detail: () => null, notes: [], inApp: [], onLink: () => {},
    helps: { here: [], hidden: [], range: null, versification: null } as unknown as Parameters<typeof helpCards>[0]['helps']
  };

  it('shows when only a list’s words are on the passage, counting them', () => {
    const cards = helpCards({ ...base, termsHere: [], wordsHere: [{ key: 'fia-eng:t104', term: 'prophet' }] });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ key: 'terms', terms: [], words: [{ key: 'fia-eng:t104', term: 'prophet' }] });
    const both = helpCards({ ...base, termsHere: [{ termId: 'kt-1', term: 'Jerusalem' }], wordsHere: [{ key: 'fia-eng:t104', term: 'prophet' }] });
    expect(both[0]!.sub).toBe(helpCards({ ...base, termsHere: [{ termId: 'a', term: 'a' }, { termId: 'b', term: 'b' }] })[0]!.sub);
  });

  it('has no card with no key words at all', () => {
    expect(helpCards({ ...base, termsHere: [], wordsHere: [] })).toEqual([]);
    expect(helpCards({ ...base, termsHere: [] })).toEqual([]);
  });
});

describe('a key-word list on a check (screen 5)', () => {
  const here = wordsOnPassage({ lists: [fia], range: LUKE, numbering: eng, versificationOf, bibles: [{ language: 'eng', rows: ROWS }], own: [] });
  const ownTerm = (termId: string, term: string, voice?: string) => ({
    termId, term, gloss: '', unitScope: [], renderings: [],
    adjustments: voice ? [{ adjustmentId: 'a1', note: '', blobHash: voice, actorId: 'p', hlc: '1' }] : []
  });
  const own = [ownTerm('fia:t104', 'prophet', 'b'.repeat(64)), ownTerm('kt-1', 'Jerusalem')];

  it('says for each word whether the version used the team word, did not mark it, or the team has none', () => {
    const rows = reviewWords(here, own, new Set(['kt-1']));
    const by = (term: string) => rows.find((r) => r.here.word.term === term)!;
    expect(by('prophet')).toMatchObject({ status: 'notMarked', voice: 'b'.repeat(64) });
    expect(by('prophet').own?.termId).toBe('fia:t104');
    // A team word spelt the same counts as the list's word.
    expect(by('Jerusalem')).toMatchObject({ status: 'used', voice: null });
    expect(by('demon')).toMatchObject({ status: 'noWord', own: null });
    // The passage's order is kept.
    expect(rows.map((r) => r.here.word.term)).toEqual(here.map((h) => h.word.term));
  });

  it('counts the words here and those the team has a word for', () => {
    const rows = reviewWords(here, own, new Set());
    expect(reviewCounts(rows)).toEqual({ here: here.length, have: 2 });
    expect(latestVoice(own[1]!)).toBeNull();
  });
});

describe('which lists reach a language', () => {
  const H = (c: string) => c.repeat(64);
  let seq = 0;
  const env = (type: string, payload: unknown, streamId = '_org'): AnyEvent =>
    ({ id: `e${++seq}`, orgId: 'o', streamId, actorId: 'admin', deviceId: 'd', hlc: `${String(++seq).padStart(15, '0')}:000000:d`, type, payload }) as AnyEvent;
  const follow = (item: string, name: string, hash: string) => {
    const itemId = subscriptionItemId('langquest', item);
    return [
      env('v1.LibrarySubscribed', { itemId, kind: 'material', sourceOrgId: 'langquest', sourceOrgName: 'LangQuest', sourceItemId: item, name, autoUpdate: true, active: true }),
      env('v1.LibraryPinned', { itemId, kind: 'material', docHash: hash })
    ];
  };
  const org = foldOrg([
    ...follow('langquest.fia-words.eng', 'FIA key words (English)', H('1')),
    ...follow('langquest.fia-words.fra', 'FIA key words (French)', H('2')),
    env('v1.LibraryItemDefined', { itemId: 'ours', kind: 'material', name: 'Our team words', description: '' }),
    env('v1.LibraryVersionPublished', { itemId: 'ours', kind: 'material', docHash: H('3') })
  ]);
  const docs: Record<string, LibraryDoc> = {
    [H('1')]: listDoc([w('t104', 'prophet', '')]),
    [H('2')]: listDoc([w('t104', 'prophète', '')], { language: 'fra' }),
    [H('3')]: listDoc([w('w1', 'shepherd', '')], { pattern: undefined, versification: undefined })
  };
  const items = Object.keys(org.library).map((id) => libraryItemView(org.library, id)!).map((it) => ({ it, doc: docs[it.current!]! }));
  const engId = subscriptionItemId('langquest', 'langquest.fia-words.eng');

  it("shows only the FIA language a team chose, even when another team takes FIA's words in another language later", () => {
    // English was chosen while it was the only one held; French came into the library afterwards and was never hidden here.
    const state = foldLanguage([env('v1.ReferenceSet', { itemId: engId, state: 'recommended' }, 'L1')]);
    expect(listsReaching({ items, recommendations: org.recommendations, state }).map((l) => l.name)).toEqual(['FIA key words (English)']);
    // Only what is chosen is fetched: never French, nor a list merely held in the library.
    expect([...chosenItemIds(org.recommendations, state)]).toEqual([engId]);
  });

  it('takes a list chosen here, or for every language by the organization, and none merely held in the library', () => {
    const chosenHere = foldLanguage([env('v1.ReferenceSet', { itemId: 'ours', state: 'recommended' }, 'L1')]);
    expect(listsReaching({ items, recommendations: org.recommendations, state: chosenHere }).map((l) => l.name)).toEqual(['Our team words']);
    const byOrg = foldOrg([env('v1.ReferenceRecommended', { itemId: 'ours', recommended: true })]);
    expect(listsReaching({ items, recommendations: byOrg.recommendations, state: foldLanguage([]) }).map((l) => l.name)).toEqual(['Our team words']);
    expect(listsReaching({ items, recommendations: org.recommendations, state: foldLanguage([]) })).toEqual([]);
  });
});
