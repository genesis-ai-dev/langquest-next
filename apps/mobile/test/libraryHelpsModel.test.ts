import { describe, expect, it } from 'vitest';
import {
  emptyLanguageState, withDeps,
  type AlignmentDoc, type ContentsDoc, type HelpBookDoc, type HelpsDoc, type LibraryDoc, type LibraryItemState, type LanguageState, type MaterialDoc, type SourceDoc
} from '@langquest-next/core';
import {
  alignmentHash, articleEntry, helpLink, helpsPassage, linkedQuestions, offeredHelps, offlineHelpDocs, partsFor, passageKeyWords, passageNotes, usesTemplate, verseMarks
} from '../src/helps/libraryHelpsModel';
import type { VerseRow } from '../src/sources/model';

/**
 * A passage's translation helps from the library (src/helps/libraryHelpsModel.ts):
 * which sets it is offered, what of them sits on it, the words of an aligned
 * Bible they are about, and the questions a check asks of it.
 */

const H = (c: string) => c.repeat(64);

const set = (kind: HelpsDoc['kind'], language: string, books: HelpsDoc['books'], extra: Partial<HelpsDoc> = {}): HelpsDoc =>
  withDeps({ format: 'helps@1', kind, title: `${kind} ${language}`, language, license: 'CC-BY-SA-4.0', credit: `credit ${language}`, template: 'x', books, deps: [], ...extra });
const book = (code: string, rows: HelpBookDoc['rows']): HelpBookDoc => ({ format: 'helpBook@1', book: code, rows, deps: [] });
const words = (language: string, entries: ContentsDoc['entries']): ContentsDoc =>
  withDeps({ format: 'contents@1', kind: 'words', title: `words ${language}`, language, license: 'l', credit: 'c', entries, deps: [] });

function library(docs: Record<string, LibraryDoc>) {
  return (h: string | null | undefined) => (h ? docs[h] ?? null : null);
}

const tit = (sc: number, sv: number, ec: number, ev: number) => ({ kind: 'bible' as const, range: { book: 'TIT', start: { chapter: sc, verse: sv }, end: { chapter: ec, verse: ev } }, versification: null });

describe('the sets a passage is offered', () => {
  const docs: Record<string, LibraryDoc> = {
    [H('1')]: set('notes', 'eng', []), [H('2')]: set('notes', 'hin', []), [H('3')]: set('questions', 'fra', []),
    [H('4')]: words('hin', []), [H('5')]: { format: 'material@1', kind: 'note', title: 'n', deps: [] } as MaterialDoc,
    [H('6')]: { ...words('eng', []), kind: 'academy' }, [H('7')]: set('wordLinks', 'eng', [])
  };
  const get = library(docs);

  it('takes the recommended first, each kind in the team\'s languages first', () => {
    const o = offeredHelps({ recommended: [{ key: 'tn.eng', hash: H('1') }, { key: 'tn.hin', hash: H('2') }, { key: 'missing', hash: H('9') }], own: [{ key: 'tq.fra', hash: H('3') }] }, get, ['hin', 'eng']);
    expect(o.notes.map((s) => s.itemId)).toEqual(['tn.hin', 'tn.eng']);
    // Nothing of that kind recommended: the organization's own, only in the team's languages.
    expect(o.questions).toEqual([]);
    const own = offeredHelps({ recommended: [], own: [{ key: 'tq.fra', hash: H('3') }, { key: 'tw.hin', hash: H('4') }, { key: 'note', hash: H('5') }, { key: 'ta', hash: H('6') }, { key: 'twl', hash: H('7') }] }, get, ['fra', 'hin', 'eng']);
    expect(own.questions.map((s) => s.itemId)).toEqual(['tq.fra']);
    expect(own.words.map((s) => s.itemId)).toEqual(['tw.hin']);
    expect(own.academy.map((s) => s.itemId)).toEqual(['ta']);
    expect(own.wordLinks.map((s) => s.itemId)).toEqual(['twl']);
  });

  it('knows a language uses a template it follows or copied', () => {
    const state = (itemId: string): LanguageState => ({ ...emptyLanguageState(), template: { value: { itemId, docHash: H('t'), unitPrefix: itemId }, hlc: 'h', eventId: 'e' } } as LanguageState);
    const item = (sub: string | null, copied: string | null) => ({
      subscription: { value: sub ? { sourceOrgId: 'langquest', sourceOrgName: 'LangQuest', sourceItemId: sub, name: '', autoUpdate: true, active: true } : null, hlc: '', eventId: '' },
      copiedFrom: { value: copied ? { orgId: 'langquest', orgName: 'LangQuest', itemId: copied, docHash: H('t') } : null, hlc: '', eventId: '' }
    }) as unknown as LibraryItemState;
    const lib = { 'sub.obs': item('obs', null), mine: item(null, 'obs'), other: item(null, null) };
    expect(usesTemplate(state('obs'), lib, 'obs')).toBe(true);
    expect(usesTemplate(state('sub.obs'), lib, 'obs')).toBe(true);
    expect(usesTemplate(state('mine'), lib, 'obs')).toBe(true);
    expect(usesTemplate(state('other'), lib, 'obs')).toBe(false);
    expect(usesTemplate(emptyLanguageState(), lib, 'obs')).toBe(false);
  });

  it('reads a story template\'s part as its story', () => {
    expect(helpsPassage(emptyLanguageState(), 'langquest.door43.obs/07', () => null, true)).toEqual({ kind: 'story', story: 7 });
    expect(helpsPassage(emptyLanguageState(), 'langquest.door43.obs/intro', () => null, true)).toBeNull();
    const outline = { ...emptyLanguageState(), template: { value: { itemId: 't', docHash: H('t'), unitPrefix: 't' }, hlc: 'h', eventId: 'e' } } as LanguageState;
    expect(helpsPassage(outline, 't/01', library({ [H('t')]: { format: 'template@2', name: 'o', description: '', structure: 'outline', levels: [], outline: [], deps: [] } }), false)).toBeNull();
    expect(helpsPassage(emptyLanguageState(), 'langquest.bible.chapters/TIT.1', () => null, false)).toMatchObject({ kind: 'bible', range: { book: 'TIT' } });
  });
});

describe('notes and key words on a passage', () => {
  const notesSet = set('notes', 'eng', [{ book: 'TIT', doc: H('a'), chapters: [0, 1] }, { book: 'TIT', doc: H('b'), chapters: [2, 3] }], { versification: undefined });
  const links = set('wordLinks', 'eng', [{ book: 'TIT', doc: H('c') }]);
  const otherLinks = set('wordLinks', 'hin', [{ book: 'TIT', doc: H('d') }]);
  const docs: Record<string, LibraryDoc> = {
    [H('a')]: book('TIT', [{ id: 'f', ref: 'front:intro', text: 'Titus' }, { id: 'n1', ref: '1:1', quote: 'Θεοῦ', words: ['Θεοῦ:1'], text: 'God' }, { id: 'n2', ref: '1:3', text: 'later' }]),
    [H('b')]: book('TIT', [{ id: 'n3', ref: '2:1', text: 'two' }]),
    [H('c')]: book('TIT', [
      { id: 'w1', ref: '1:1', quote: 'Παῦλος', words: ['Παῦλος:1'], text: '', article: 'names/paul' },
      { id: 'w2', ref: '1:1', quote: 'Θεοῦ', words: ['Θεοῦ:1'], text: '', article: 'kt/god' },
      { id: 'w3', ref: '1:2', quote: 'θεὸς', words: ['θεὸς:1'], text: '', article: 'kt/god' },
      { id: 'w4', ref: '1:9', text: '', article: 'kt/faith' }
    ]),
    [H('d')]: book('TIT', [{ id: 'x', ref: '1:1', text: '', article: 'kt/love' }])
  };
  const get = library(docs);
  const offered = (s: HelpsDoc, itemId: string, hash: string) => ({ itemId, hash, doc: s });
  const tw = [
    { itemId: 'tw.hin', hash: H('e'), doc: words('hin', [{ id: 'kt/god', title: 'परमेश्वर', doc: H('g') }]) },
    { itemId: 'tw.eng', hash: H('f'), doc: words('eng', [{ id: 'kt/god', title: 'God', doc: H('h') }, { id: 'names/paul', title: 'Paul', doc: H('i') }]) }
  ];

  it('fetches only the parts of a book a passage is in', () => {
    expect(partsFor(tit(1, 1, 1, 4), [offered(notesSet, 'tn', H('9'))])).toEqual([H('a')]);
    expect(partsFor(tit(1, 5, 2, 2), [offered(notesSet, 'tn', H('9')), offered(links, 'twl', H('8'))])).toEqual([H('a'), H('b'), H('c')]);
    expect(partsFor({ kind: 'story', story: 3 }, [offered(notesSet, 'tn', H('9'))])).toEqual([]);
  });

  it('puts each set\'s notes under the verse each is on', () => {
    const groups = passageNotes(tit(1, 1, 1, 2), [offered(notesSet, 'tn', H('9'))], get);
    expect(groups).toEqual([{ itemId: 'tn', title: 'notes eng', credit: 'credit eng', language: 'eng', byVerse: [['', [docs[H('a')] && (docs[H('a')] as HelpBookDoc).rows[0]]], ['1:1', [(docs[H('a')] as HelpBookDoc).rows[1]]]] }]);
    expect(passageNotes(tit(3, 1, 3, 2), [offered(notesSet, 'tn', H('9'))], get)).toEqual([]);
  });

  it('gathers each key word once, named and opened from the team\'s key-word set', () => {
    const k = passageKeyWords(tit(1, 1, 1, 2), [offered(links, 'twl', H('8')), offered(otherLinks, 'twl.hin', H('7'))], tw, get);
    // By the verse each is first on, then by name.
    expect(k).toEqual([
      { article: 'names/paul', title: 'Paul', at: ['1:1'], words: ['Παῦλος:1'], doc: H('i'), from: 'tw.eng' },
      { article: 'kt/god', title: 'परमेश्वर', at: ['1:1', '1:2'], words: ['Θεοῦ:1', 'θεὸς:1'], doc: H('g'), from: 'tw.hin' }
    ]);
    // A word no key-word set has keeps the last part of its id.
    expect(passageKeyWords(tit(1, 9, 1, 9), [offered(links, 'twl', H('8'))], [], get)).toEqual([{ article: 'kt/faith', title: 'faith', at: ['1:9'], words: [] }]);
  });

  it('marks the words of an aligned Bible the notes and key words are about', () => {
    const al: AlignmentDoc = {
      format: 'alignment@1', book: 'TIT', text: H('s'), original: 'grc', deps: [H('s')],
      chapters: [{ chapter: 1, verses: [{ verse: 1, words: [[0, 4], [6, 7], [8, 15], [16, 18], [19, 22]], groups: [[['Παῦλος:1'], [0]], [['Θεοῦ:1'], [3, 4]]] }] }]
    };
    const row: VerseRow = { key: '1:1', chapter: 1, verseStart: 1, verseEnd: 1, text: 'Paul, a servant of God' };
    const notes = passageNotes(tit(1, 1, 1, 2), [offered(notesSet, 'tn', H('9'))], get);
    expect(verseMarks(row, al, notes, [])).toEqual([[16, 22]]);
    expect(verseMarks(row, al, [], [{ article: 'names/paul', title: 'Paul', at: ['1:1'], words: ['Παῦλος:1'] }])).toEqual([[0, 4]]);
    expect(verseMarks(row, null, notes, [])).toEqual([]);
    const src = { books: [{ book: 'TIT', name: 'Titus', doc: H('s'), alignment: H('t') }] } as unknown as SourceDoc;
    expect(alignmentHash(src, 'TIT')).toBe(H('t'));
    expect(alignmentHash(src, 'GEN')).toBeUndefined();
    expect(alignmentHash(null, 'TIT')).toBeUndefined();
  });

  it('takes the kept passages\' parts offline, then their key words\' articles', () => {
    const sets = { notes: [offered(notesSet, 'tn', H('9'))], questions: [], wordLinks: [offered(links, 'twl', H('8'))], words: tw, academy: [] };
    expect(offlineHelpDocs([tit(1, 1, 1, 2)], sets, get)).toEqual({ pieces: [H('a'), H('c')], articles: [H('i'), H('g')] });
  });
});

describe('links and articles', () => {
  it('reads the links in help text', () => {
    expect(helpLink('ta:translate/figs-metaphor')).toEqual({ kind: 'academy', id: 'translate/figs-metaphor' });
    expect(helpLink('tw:kt/god')).toEqual({ kind: 'words', id: 'kt/god' });
    expect(helpLink('bible:1JN 1:7')).toEqual({ kind: 'bible', ref: '1JN 1:7' });
    expect(helpLink('m387')).toBeNull();
    const sets = [{ itemId: 'tw', hash: H('1'), doc: words('eng', [{ id: 'kt/god', title: 'God', doc: H('2') }]) }];
    expect(articleEntry(sets, 'kt/god')).toMatchObject({ doc: H('2'), title: 'God' });
    expect(articleEntry(sets, 'kt/love')).toBeNull();
  });
});

describe('a check\'s questions from the library', () => {
  const tq = set('questions', 'eng', [{ book: 'TIT', doc: H('q') }]);
  const form: MaterialDoc = { format: 'material@1', kind: 'questions', title: 'Evaluation', questions: [{ id: 'a1', text: 'We checked with old and young.', type: 'yesno' }], deps: [] };
  const get = library({ [H('q')]: book('TIT', [{ id: 'y5pp', ref: '1:1', text: 'Why?', answer: 'Because.' }, { id: 'z', ref: '3:1', text: 'Later?', answer: '' }]) });

  it('asks a verse set\'s questions on the passage, with their answers, and a form\'s on every passage', () => {
    const qs = linkedQuestions(tit(1, 1, 1, 4), [{ itemId: 'tq', doc: tq }, { itemId: 'form', doc: form }, { itemId: 'gone', doc: null }], get);
    expect(qs).toEqual([
      { q: { id: 'tq/TIT/y5pp', text: 'Why?', type: 'text' }, source: 'library', required: false, answer: 'Because.', at: '1:1' },
      { q: { id: 'form/a1', text: 'We checked with old and young.', type: 'yesno' }, source: 'library', required: false }
    ]);
    // A story or a passage without verses still asks every passage's questions.
    expect(linkedQuestions(null, [{ itemId: 'tq', doc: tq }, { itemId: 'form', doc: form }], get).map((q) => q.q.id)).toEqual(['form/a1']);
  });
});
