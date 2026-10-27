// Get ready, question 2: what can help a language's team, as one list, what
// goes with what (FIA's guides and key words, decision 172) and what a search
// of it finds (src/reference/helpItemsModel.ts).
import { describe, expect, it } from 'vitest';
import {
  foldLanguage, foldOrg, libraryItemView, subscriptionItemId,
  type AnyEvent, type CollectionDoc, type LibraryDoc, type MaterialDoc
} from '@langquest-next/core';
import type { SharedItem } from '../src/library/model';
import type { GuideSet, SetMember } from '../src/reference/guideSets';
import {
  familyItems, guidesArriving, helpItems, helpSections, inLibrary, matchesHelpItem, matchesWords, relatedItems, relatedLinks, relatedMember,
  searchHelps, turnOnSay, turnOnWith, type HelpItem, type HelpItemsInput
} from '../src/reference/helpItemsModel';

const H = (c: string) => c.repeat(64);
let seq = 0;
const envelope = (type: string, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, orgId: 'o', streamId: '_org', actorId: 'admin', deviceId: 'd', hlc: `${String(++seq).padStart(15, '0')}:000000:d`, type, payload }) as AnyEvent;

const fia = (language: string, passages: number): CollectionDoc => ({
  format: 'collection@1', title: `FIA study guides (${language})`, description: '', language, pattern: 'FIA', versification: H('e'),
  entries: Array.from({ length: passages }, (_, i) => ({ ref: `LUK ${i + 1}:1-5`, title: `P${i + 1}`, doc: H('d') })), deps: []
});
const note = (title: string, language = 'eng'): MaterialDoc => ({ format: 'material@1', kind: 'note', title, language, deps: [] });
const shared = (item: string, name: string, hash: string, orgId = 'langquest'): SharedItem => ({
  org_id: orgId, org_name: orgId === 'langquest' ? 'LangQuest' : 'Other', item_id: item, kind: 'material', name, description: '',
  subscribable: true, version_count: 1, latest_hash: hash, updated_hlc: ''
});

const docs: Record<string, LibraryDoc> = {
  [H('1')]: fia('eng', 30), [H('2')]: fia('fra', 12),
  [H('3')]: note('Examples of notes'), [H('4')]: note('Aardvark notes'),
  [H('5')]: fia('hin', 20), [H('6')]: note('Their French note', 'fra'), [H('7')]: note('Their Hindi note', 'hin')
};

function world() {
  const follow = (item: string, name: string, hash: string) => {
    const itemId = subscriptionItemId('langquest', item);
    return [
      envelope('v1.LibrarySubscribed', { itemId, kind: 'material', sourceOrgId: 'langquest', sourceOrgName: 'LangQuest', sourceItemId: item, name, autoUpdate: true, active: true }),
      envelope('v1.LibraryPinned', { itemId, kind: 'material', docHash: hash })
    ];
  };
  const own = (itemId: string, name: string, hash: string) => [
    envelope('v1.LibraryItemDefined', { itemId, kind: 'material', name, description: '' }),
    envelope('v1.LibraryVersionPublished', { itemId, kind: 'material', docHash: hash })
  ];
  const org = foldOrg([
    ...follow('fia.eng', 'FIA study guides (English)', H('1')),
    ...follow('fia.fra', 'FIA study guides (French)', H('2')),
    ...own('ex', 'Examples of notes', H('3')),
    ...own('aa', 'Aardvark notes', H('4'))
  ]);
  const view = (id: string) => libraryItemView(org.library, id)!;
  const items = ['ex', 'aa', 'sub.langquest.fia.eng', 'sub.langquest.fia.fra'].map(view);
  return { org, items, view };
}

function input(over: Partial<HelpItemsInput> = {}): HelpItemsInput {
  const { view, items } = world();
  return {
    items, others: [], doc: (h) => (h ? docs[h] ?? null : null), itemOf: view, recommendations: undefined, state: null,
    offered: new Map(), reads: 'eng', reader: 'eng', guidesIncoming: false, ...over
  };
}

describe('what can help a language\'s team', () => {
  it('lists the organization\'s own material by name, examples last, with the FIA languages as one set', () => {
    const out = helpItems(input());
    expect(out.map((h) => h.name)).toEqual(['Aardvark notes', 'FIA study guides', 'Examples of notes']);
    const set = out[1]!;
    expect(set.key.startsWith('set:')).toBe(true);
    expect(set.kind).toBe('guide');
    expect(set.set!.set.members.map((m) => m.language)).toEqual(['eng', 'fra']);
    expect(set.from).toBe('LangQuest');
  });

  it('turns a note on unless the language hid it, and a Bible only when it is offered', () => {
    const { view } = world();
    const state = { languageReferences: { aa: { value: 'hidden' } } } as never;
    const out = helpItems(input({ state, itemOf: view }));
    expect(out.find((h) => h.name === 'Aardvark notes')!.on).toBe(false);
    expect(out.find((h) => h.name === 'Examples of notes')!.on).toBe(true);
  });

  it('holds the FIA set back while shared documents are still arriving, and its members with it', () => {
    const out = helpItems(input({ guidesIncoming: true }));
    expect(out.map((h) => h.name)).toEqual(['Aardvark notes', 'Examples of notes']);
    expect(out.some((h) => h.set)).toBe(false);
  });

  it('offers another organization\'s guide only in the team\'s language or the reader\'s, and never turned on', () => {
    const others = [
      shared('x.fra', 'Their French guide', H('6'), 'other'),
      shared('x.hin', 'Their Hindi guide', H('7'), 'other')
    ];
    const guides: Record<string, LibraryDoc> = {
      [H('6')]: { ...fia('fra', 3), pattern: undefined, title: 'Their French guide' },
      [H('7')]: { ...fia('hin', 3), pattern: undefined, title: 'Their Hindi guide' }
    };
    const out = helpItems(input({ others, doc: (h) => (h ? guides[h] ?? docs[h] ?? null : null), reads: 'fra' }));
    const theirs = out.filter((h) => h.shared);
    expect(theirs.map((h) => h.name)).toEqual(['Their French guide']);
    expect(theirs[0]).toMatchObject({ on: false, from: 'Other', itemId: null, key: 'shared:other/x.fra' });
  });

  it('skips shared notes (only Bibles and guides are shared in) and documents not yet here', () => {
    const others = [shared('n', 'A shared note', H('4'), 'other'), shared('gone', 'Missing', H('9'), 'other')];
    expect(helpItems(input({ others })).some((h) => h.shared)).toBe(false);
  });

  it('knows when guides are still arriving', () => {
    expect(guidesArriving(false, false, false)).toBe(true);
    expect(guidesArriving(true, true, false)).toBe(true);
    expect(guidesArriving(true, false, false)).toBe(false);
    expect(guidesArriving(false, true, true)).toBe(false);
  });
});

// ---- FIA's key words beside its guides (decision 172) ------------------------------------------

const words = (language: string, count: number): MaterialDoc => ({
  format: 'material@1', kind: 'key_terms', title: `FIA key words (${language})`, language, pattern: 'FIA', deps: [],
  source: 'fia.bible', terms: Array.from({ length: count }, (_, i) => ({ id: `t${i + 1}`, term: `word ${i + 1}`, gloss: '' }))
});

const wordDocs: Record<string, LibraryDoc> = {
  ...docs, [H('8')]: words('eng', 302), [H('9')]: words('fra', 280), [H('a')]: words('hin', 250)
};

/** An organization following LangQuest's FIA guides and key words in English and French, with a note of its own. */
function withWords(say: { itemId: string; state: 'recommended' | 'hidden' | 'inherit' }[] = []) {
  const follow = (item: string, name: string, hash: string) => {
    const itemId = subscriptionItemId('langquest', item);
    return [
      envelope('v1.LibrarySubscribed', { itemId, kind: 'material', sourceOrgId: 'langquest', sourceOrgName: 'LangQuest', sourceItemId: item, name, autoUpdate: true, active: true }),
      envelope('v1.LibraryPinned', { itemId, kind: 'material', docHash: hash })
    ];
  };
  const org = foldOrg([
    ...follow('fia.eng', 'FIA study guides (English)', H('1')),
    ...follow('fia.fra', 'FIA study guides (French)', H('2')),
    ...follow('words.eng', 'FIA key words (English)', H('8')),
    ...follow('words.fra', 'FIA key words (French)', H('9')),
    envelope('v1.LibraryItemDefined', { itemId: 'aa', kind: 'material', name: 'Aardvark notes', description: '' }),
    envelope('v1.LibraryVersionPublished', { itemId: 'aa', kind: 'material', docHash: H('4') })
  ]);
  const view = (id: string) => libraryItemView(org.library, id)!;
  const items = ['aa', 'sub.langquest.fia.eng', 'sub.langquest.fia.fra', 'sub.langquest.words.eng', 'sub.langquest.words.fra'].map(view);
  const state = foldLanguage(say.map((p) => ({ ...envelope('v1.ReferenceSet', p), streamId: 'L1' }) as AnyEvent));
  const others = [shared('words.hin', 'FIA key words (Hindi)', H('a'))];
  return helpItems({
    items, others, doc: (h) => (h ? wordDocs[h] ?? null : null), itemOf: view, recommendations: undefined, state,
    offered: new Map(), reads: 'eng', reader: 'eng', guidesIncoming: false
  });
}

/** A help made by hand, for the choices that only read its key, family, kind and switch. */
const help = (key: string, over: Partial<HelpItem> = {}): HelpItem => ({
  key, itemId: key, shared: null, name: key, kind: 'note', doc: note(key), on: false, owner: '', from: null, ...over
});
const member = (language: string, itemId: string | null = `m.${language}`): SetMember => ({ itemId, shared: null, name: language, language, passages: 10 });
const setOf = (key: string, languages: string[]): GuideSet => ({ key, pattern: 'FIA', name: 'FIA key words', members: languages.map((l) => member(l)) });

describe('FIA\'s key words beside its guides', () => {
  it('makes one row of FIA\'s key words in every language, a key-words row, in the same family as the guides', () => {
    const out = withWords();
    const kw = out.find((h) => h.kind === 'words')!;
    expect(kw).toMatchObject({ key: 'set:langquest|FIA|words', name: 'FIA key words', family: 'langquest|FIA', on: true });
    // Hindi, shared by LangQuest and not yet followed, is one more language of the set.
    expect(kw.set!.set.members.map((m) => [m.language, m.passages])).toEqual([['eng', 302], ['fra', 280], ['hin', 250]]);
    const guides = out.find((h) => h.kind === 'guide')!;
    expect(guides.family).toBe('langquest|FIA');
    expect(relatedItems(guides, out)).toEqual([kw]);
    expect(relatedItems(kw, out)).toEqual([guides]);
    expect(relatedItems(out.find((h) => h.name === 'Aardvark notes')!, out)).toEqual([]);
    expect(familyItems('langquest|FIA', out).map((h) => h.name)).toEqual(['FIA key words', 'FIA study guides']);
  });

  it('finds an item by name, kind, method, who it is from or its language, every word in any order, ignoring case and accents', () => {
    const out = withWords();
    const kw = out.find((h) => h.kind === 'words')!;
    const aa = out.find((h) => h.name === 'Aardvark notes')!;
    expect(matchesHelpItem(kw, '')).toBe(true);
    expect(matchesHelpItem(kw, 'fia')).toBe(true);
    expect(matchesHelpItem(kw, 'words key')).toBe(true);
    expect(matchesHelpItem(kw, 'langquest')).toBe(true);
    // Every language of a set: Hindi too, though only English and French are in the library.
    expect(matchesHelpItem(kw, 'hindi')).toBe(true);
    expect(matchesHelpItem(kw, 'fia.bible')).toBe(true);
    expect(matchesHelpItem(kw, 'aardvark')).toBe(false);
    expect(matchesHelpItem(aa, 'AARDVARK english')).toBe(true);
    expect(matchesWords('Español', 'espanol')).toBe(true);
    expect(matchesWords('Notes on FIA passages', 'passages fia')).toBe(true);
    expect(matchesWords('Notes', 'notes fia')).toBe(false);
  });

  it('knows what the organization has: its own items and sets it has a language of, not what others share', () => {
    expect(inLibrary(help('own'))).toBe(true);
    expect(inLibrary(help('theirs', { itemId: null, shared: shared('x', 'X', H('4'), 'other') }))).toBe(false);
    const held = { set: setOf('langquest|FIA|words', ['eng', 'fra']), reach: [] };
    expect(inLibrary(help('set', { itemId: null, set: held }))).toBe(true);
    const none = { ...held.set, members: held.set.members.map((m) => ({ ...m, itemId: null })) };
    expect(inLibrary(help('set', { itemId: null, set: { set: none, reach: [] } }))).toBe(false);
  });

  it('searches within a "Goes with" filter, typed words narrowing it, and sections what it finds, what is not had yet last', () => {
    const out = withWords();
    expect(searchHelps(out, '', 'langquest|FIA').map((h) => h.name)).toEqual(['FIA key words', 'FIA study guides']);
    expect(searchHelps(out, 'key', 'langquest|FIA').map((h) => h.name)).toEqual(['FIA key words']);
    expect(searchHelps(out, 'notes', null).map((h) => h.name)).toEqual(['Aardvark notes']);
    const theirs = help('Their guide', { kind: 'guide', itemId: null, shared: shared('g', 'Their guide', H('4'), 'other') });
    const theirBible = help('Their Bible', { kind: 'source', itemId: null, shared: shared('b', 'Their Bible', H('4'), 'other') });
    const list = [theirs, ...out, theirBible];
    const apart = helpSections(list, true);
    expect(apart.guides.map((h) => h.name)).toEqual(['FIA study guides']);
    expect(apart.words.map((h) => h.name)).toEqual(['FIA key words']);
    expect(apart.notes.map((h) => h.name)).toEqual(['Aardvark notes']);
    // Not had yet: last, by kind (Bibles, guides, key words, notes), whatever order they came in.
    expect(apart.notYet.map((h) => h.name)).toEqual(['Their Bible', 'Their guide']);
    // Not searching, everything sits in its kind's section.
    const together = helpSections(list, false);
    expect(together.guides.map((h) => h.name)).toEqual(['Their guide', 'FIA study guides']);
    expect(together.bibles.map((h) => h.name)).toEqual(['Their Bible']);
    expect(together.notYet).toEqual([]);
  });

  it('says once in a family how many related resources are on, on the first row that is on', () => {
    const guides = help('guides', { kind: 'guide', family: 'lq|FIA', on: true });
    const kw = help('words', { kind: 'words', family: 'lq|FIA', on: true });
    const notes = help('fia notes', { family: 'lq|FIA', on: true });
    const lone = help('lone', { family: 'other|FIA', on: true });
    expect([...relatedLinks([guides, kw, notes, lone], [guides, kw, notes, lone])]).toEqual([['guides', 2]]);
    // Off rows and rows with nothing related on say nothing.
    const off = { ...guides, on: false };
    expect([...relatedLinks([off, kw, notes], [off, kw, notes])]).toEqual([['words', 1]]);
    expect([...relatedLinks([off, { ...kw, on: false }], [off, { ...kw, on: false }])]).toEqual([]);
  });

  it('turns on what goes with an item turned on: a set in the same language, else English, else the reader\'s', () => {
    const kwSet = setOf('lq|FIA|words', ['eng', 'fra', 'hin']);
    const kw = help('words', { kind: 'words', family: 'lq|FIA', itemId: null, set: { set: kwSet, reach: [] } });
    const guides = help('guides', { kind: 'guide', family: 'lq|FIA' });
    const note1 = help('fia notes', { family: 'lq|FIA' });
    const items = [guides, kw, note1];
    expect(turnOnWith(guides, items, 'fra', 'eng')).toEqual([{ item: kw, member: kwSet.members[1] }, { item: note1, member: null }]);
    // No Swahili key words: English.
    expect(turnOnWith(guides, items, 'swa', 'hin')[0]!.member!.language).toBe('eng');
    // No English either: the reader's.
    const noEnglish = { ...kwSet, members: kwSet.members.filter((m) => m.language !== 'eng') };
    expect(relatedMember(noEnglish, 'swa', 'hin').language).toBe('hin');
    expect(relatedMember(noEnglish, null, 'amh').language).toBe('fra');
    // What is on already stays as it is, and an item already on (a new language for it) turns nothing on.
    expect(turnOnWith(guides, [guides, { ...kw, on: true }, note1], 'fra', 'eng')).toEqual([{ item: note1, member: null }]);
    expect(turnOnWith({ ...guides, on: true }, items, 'fra', 'eng')).toEqual([]);
    expect(turnOnWith(help('alone'), items, 'eng', 'eng')).toEqual([]);
  });

  it('turns an item on as its switch does: what was hidden follows the organization again, else it is recommended here', () => {
    expect(turnOnSay('x', 'words', { org: false, language: null, effective: null })).toEqual({ itemId: 'x', state: 'recommended' });
    expect(turnOnSay('x', 'words', { org: false, language: 'hidden', effective: null })).toEqual({ itemId: 'x', state: 'inherit' });
    expect(turnOnSay('b', 'source', { org: false, language: 'hidden', effective: null })).toEqual({ itemId: 'b', state: 'recommended' });
    expect(turnOnSay('b', 'source', { org: true, language: 'hidden', effective: null })).toEqual({ itemId: 'b', state: 'inherit' });
  });

  it('shows FIA\'s key words off once the language hides every language of them', () => {
    const out = withWords([
      { itemId: 'sub.langquest.words.eng', state: 'hidden' }, { itemId: 'sub.langquest.words.fra', state: 'hidden' }
    ]);
    const kw = out.find((h) => h.kind === 'words')!;
    expect(kw.on).toBe(false);
    const guides = out.find((h) => h.kind === 'guide')!;
    expect(turnOnWith(kw, out, 'fra', 'eng')).toEqual([]);
    expect(turnOnWith({ ...guides, on: false }, out, 'fra', 'eng').map((p) => [p.item.key, p.member?.language])).toEqual([['set:langquest|FIA|words', 'fra']]);
  });
});
