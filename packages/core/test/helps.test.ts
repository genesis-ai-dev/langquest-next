import { describe, expect, it } from 'vitest';
import {
  alignedQuote, alignedSpans, canonicalJson, emptyLanguageState, helpBookDocs, helpPlace, helpQuestionId, markSpans, passageQuestions, questionsForKind, referencedDocs, rowsByVerse, rowsOnPassage,
  validateDoc, withDeps,
  type AlignmentDoc, type ContentsDoc, type FlowDoc, type HelpBookDoc, type HelpsDoc, type LibraryDoc, type SourceDoc, type VersificationDoc
} from '../src';

/**
 * Translation helps as library documents (helpDocs.ts) and how they sit on
 * a passage (helpsOnPassage.ts): notes, questions and key words by verse,
 * the words of an aligned Bible they are about, and a check's questions.
 */

const H = (c: string) => c.repeat(64);

const book = (rows: HelpBookDoc['rows'], code = 'TIT'): HelpBookDoc => ({ format: 'helpBook@1', book: code, rows, deps: [] });

describe('places', () => {
  it('reads verses, ranges, introductions and whole chapters', () => {
    expect(helpPlace('1:1')).toEqual({ kind: 'verses', chapter: 1, verse: 1, endChapter: 1, endVerse: 1 });
    expect(helpPlace('1:1–3')).toEqual({ kind: 'verses', chapter: 1, verse: 1, endChapter: 1, endVerse: 3 });
    expect(helpPlace('1:30-2:2')).toEqual({ kind: 'verses', chapter: 1, verse: 30, endChapter: 2, endVerse: 2 });
    expect(helpPlace('front:intro')).toEqual({ kind: 'intro', chapter: 'front' });
    expect(helpPlace('3:intro')).toEqual({ kind: 'intro', chapter: 3 });
    expect(helpPlace('7')).toEqual({ kind: 'chapter', chapter: 7 });
    expect(helpPlace('1:0')).toEqual({ kind: 'verses', chapter: 1, verse: 0, endChapter: 1, endVerse: 0 });
    for (const bad of ['', 'x', '1:', '2:5-1:3', '1:5-3', 'front']) expect(helpPlace(bad), bad).toBeNull();
  });
});

describe('the formats', () => {
  const rows: HelpBookDoc['rows'] = [
    { id: 'n1', ref: '1:1', quote: 'Θεοῦ', occurrence: 1, words: ['Θεοῦ:1'], text: 'God here is the Father.', support: 'translate/figs-metonymy' },
    { id: 'q1', ref: '1:2', text: 'Does God lie?', answer: 'No.' }
  ];

  it('accepts a book of helps, a set, an alignment and contents, with deps from what they name', () => {
    const b = book(rows);
    const set: HelpsDoc = withDeps({ format: 'helps@1', kind: 'notes', title: 'Translation Notes', language: 'eng', license: 'CC-BY-SA-4.0', credit: 'The original work…', versification: H('a'), books: [{ book: 'TIT', doc: H('b') }], deps: [] });
    const stories: HelpsDoc = withDeps({ format: 'helps@1', kind: 'questions', title: 'Story questions', language: 'eng', license: 'CC-BY-SA-4.0', credit: 'c', template: 'langquest.door43.obs', books: [{ book: 'OBS', doc: H('c') }], deps: [] });
    const al: AlignmentDoc = withDeps({ format: 'alignment@1', book: 'TIT', text: H('d'), original: 'grc', chapters: [{ chapter: 1, verses: [{ verse: 1, words: [[0, 4], [6, 7]], groups: [[['Παῦλος:1'], [0]]] }] }], deps: [] });
    const contents: ContentsDoc = withDeps({ format: 'contents@1', kind: 'words', title: 'Translation Words', language: 'eng', license: 'CC-BY-SA-4.0', credit: 'c', entries: [{ id: 'kt/god', title: 'God', doc: H('e'), section: 'kt' }], deps: [] });
    for (const d of [b, set, stories, al, contents] as LibraryDoc[]) expect(validateDoc(d), d.format).toBeNull();
    expect(set.deps).toEqual([H('a'), H('b')]);
    expect(al.deps).toEqual([H('d')]);
    expect(referencedDocs(contents)).toEqual([H('e')]);
    expect(validateDoc({ ...set, deps: [] })).toMatch(/deps/);
  });

  it('says what is wrong with each', () => {
    const bad: [unknown, RegExp][] = [
      [{ format: 'helpBook@1', book: 'tit', rows: [], deps: [] }, /book/],
      [{ format: 'helpBook@1', book: 'TIT', rows: {}, deps: [] }, /array/],
      [book([{ id: 'a', ref: 'nowhere', text: '' }]), /place/],
      [book([{ id: 'a', ref: '1:1', text: 3 } as never]), /text/],
      [book([{ id: 'a', ref: '1:1', text: '', answer: 4 } as never]), /text/],
      [book([{ id: 'a', ref: '1:1', text: '', occurrence: 1.5 }]), /whole/],
      [book([{ id: 'a', ref: '1:1', text: '', words: ['Θεοῦ'] }]), /word:occurrence/],
      [book([{ id: 'a', ref: '1:1', text: '' }, { id: 'a', ref: '1:2', text: '' }]), /repeated/],
      [{ format: 'alignment@1', book: 'TIT', text: 'x', original: 'grc', chapters: [], deps: [] }, /text/],
      [{ format: 'alignment@1', book: 'TI', text: H('d'), original: 'grc', chapters: [], deps: [H('d')] }, /book/],
      [{ format: 'alignment@1', book: 'TIT', text: H('d'), original: 'grc', chapters: {}, deps: [H('d')] }, /array/],
      [{ format: 'alignment@1', book: 'TIT', text: H('d'), original: 'grc', chapters: [{ chapter: 'a', verses: [] }], deps: [H('d')] }, /number/],
      [{ format: 'alignment@1', book: 'TIT', text: H('d'), original: 'grc', chapters: [{ chapter: 1, verses: [{ verse: 1, words: [[3, 1]], groups: [] }] }], deps: [H('d')] }, /start, end/],
      [{ format: 'alignment@1', book: 'TIT', text: H('d'), original: 'grc', chapters: [{ chapter: 1, verses: [{ verse: 1, groups: [] }] }], deps: [H('d')] }, /words and groups/],
      [{ format: 'alignment@1', book: 'TIT', text: H('d'), original: 'grc', chapters: [{ chapter: 1, verses: [{ verse: 1, words: [[0, 1]], groups: [[['a:1'], [2]]] }] }], deps: [H('d')] }, /indexes/],
      [{ format: 'helps@1', kind: 'tips', title: 't', language: 'eng', license: 'l', credit: 'c', versification: H('a'), books: [], deps: [H('a')] }, /kind/],
      [{ format: 'helps@1', kind: 'notes', title: '', language: 'eng', license: 'l', credit: 'c', versification: H('a'), books: [], deps: [H('a')] }, /title/],
      [{ format: 'helps@1', kind: 'notes', title: 't', language: 'eng', license: '', credit: 'c', versification: H('a'), books: [], deps: [H('a')] }, /license/],
      [{ format: 'helps@1', kind: 'notes', title: 't', language: 'eng', license: 'l', credit: 'c', description: 4, versification: H('a'), books: [], deps: [H('a')] }, /description/],
      [{ format: 'helps@1', kind: 'notes', title: 't', language: 'eng', license: 'l', credit: 'c', books: [], deps: [] }, /not both/],
      [{ format: 'helps@1', kind: 'notes', title: 't', language: 'eng', license: 'l', credit: 'c', versification: 'v', books: [], deps: [] }, /hash/],
      [{ format: 'helps@1', kind: 'notes', title: 't', language: 'eng', license: 'l', credit: 'c', template: '', books: [], deps: [] }, /item id/],
      [{ format: 'helps@1', kind: 'notes', title: 't', language: 'eng', license: 'l', credit: 'c', template: 'x', books: {}, deps: [] }, /listed/],
      [{ format: 'helps@1', kind: 'notes', title: 't', language: 'eng', license: 'l', credit: 'c', template: 'x', books: [{ book: 'TIT' }], deps: [] }, /USFM/],
      [{ format: 'helps@1', kind: 'notes', title: 't', language: 'eng', license: 'l', credit: 'c', template: 'x', books: [{ book: 'TIT', doc: H('b') }, { book: 'TIT', doc: H('b') }], deps: [H('b')] }, /twice/],
      [{ format: 'contents@1', kind: 'films', title: 't', language: 'eng', license: 'l', credit: 'c', entries: [], deps: [] }, /kind/],
      [{ format: 'contents@1', kind: 'words', title: 't', language: '', license: 'l', credit: 'c', entries: [], deps: [] }, /language/],
      [{ format: 'contents@1', kind: 'words', title: 't', language: 'eng', license: 'l', credit: '', entries: [], deps: [] }, /credit/],
      [{ format: 'contents@1', kind: 'words', title: 't', language: 'eng', license: 'l', credit: 'c', template: 4, entries: [], deps: [] }, /template/],
      [{ format: 'contents@1', kind: 'stories', title: 't', language: 'eng', license: 'l', credit: 'c', entries: [], deps: [] }, /template/],
      [{ format: 'contents@1', kind: 'words', title: 't', language: 'eng', license: 'l', credit: 'c', entries: {}, deps: [] }, /listed/],
      [{ format: 'contents@1', kind: 'words', title: 't', language: 'eng', license: 'l', credit: 'c', entries: [{ id: 'a', title: '', doc: H('e') }], deps: [H('e')] }, /entries need/],
      [{ format: 'contents@1', kind: 'words', title: 't', language: 'eng', license: 'l', credit: 'c', entries: [{ id: 'a', title: 'A', doc: H('e') }, { id: 'a', title: 'A', doc: H('e') }], deps: [H('e')] }, /twice/]
    ];
    for (const [doc, why] of bad) expect(validateDoc(doc), canonicalJson(doc).slice(0, 80)).toMatch(why);
  });

  it('splits a big book into parts by chapter, and a passage fetches only the parts it is in', () => {
    const set: HelpsDoc = withDeps({
      format: 'helps@1', kind: 'notes', title: 'TN', language: 'eng', license: 'l', credit: 'c', versification: H('a'),
      books: [{ book: 'PSA', doc: H('1'), chapters: [0, 40] }, { book: 'PSA', doc: H('2'), chapters: [41, 150] }, { book: 'TIT', doc: H('3') }], deps: []
    });
    expect(validateDoc(set)).toBeNull();
    expect(helpBookDocs(set, 'PSA', [23, 23])).toEqual([H('1')]);
    expect(helpBookDocs(set, 'PSA', [40, 41])).toEqual([H('1'), H('2')]);
    expect(helpBookDocs(set, 'TIT', [2, 2])).toEqual([H('3')]);
    expect(helpBookDocs(set, 'GEN', [1, 1])).toEqual([]);
    expect(validateDoc({ ...set, books: [{ book: 'PSA', doc: H('1'), chapters: [0, 41] }, { book: 'PSA', doc: H('2'), chapters: [41, 150] }] })).toMatch(/twice/);
    expect(validateDoc({ ...set, books: [{ book: 'PSA', doc: H('1'), chapters: [5, 1] }] })).toMatch(/first, last/);
  });

  it('lets a source name its books\' alignments without counting them as deps, so older phones still read it', () => {
    const src: SourceDoc = withDeps({
      format: 'source@1', name: 'Literal Text', abbreviation: 'ULT', language: 'eng', versification: H('a'), provider: { kind: 'library' }, offline: 'allowed',
      copyright: {}, books: [{ book: 'TIT', name: 'Titus', doc: H('b'), alignment: H('c') }], deps: []
    });
    expect(src.deps).toEqual([H('a'), H('b')]);
    expect(validateDoc(src)).toBeNull();
    expect(validateDoc({ ...src, books: [{ book: 'TIT', name: 'Titus', doc: H('b'), alignment: 'x' }] })).toMatch(/USFM/);
  });

  it('lets a flow carry helps and shows for its own checks only', () => {
    const flow: FlowDoc = {
      format: 'flow@1', name: 'Checking Manual', description: '', kinds: [{ id: 'k', name: 'Community check', description: '', usualReviewer: '' }], steps: [{ stepId: 's1', kindIds: ['k'] }],
      helps: [{ kindId: 'k', itemId: 'tq' }], shows: [{ kindId: 'k', what: 'bibleText', shown: false }], pattern: 'door43-checking', deps: []
    };
    expect(validateDoc(flow)).toBeNull();
    expect(validateDoc({ ...flow, helps: [{ kindId: 'other', itemId: 'tq' }] })).toMatch(/helps/);
    expect(validateDoc({ ...flow, shows: [{ kindId: 'k', what: 'everything', shown: false }] })).toMatch(/shows/);
    expect(validateDoc({ ...flow, pattern: 3 })).toMatch(/pattern/);
  });
});

describe('helps on a passage', () => {
  const tit = book([
    { id: 'f', ref: 'front:intro', text: 'Titus' },
    { id: 'i1', ref: '1:intro', text: 'Chapter one' },
    { id: 'a', ref: '1:1', text: 'one' },
    { id: 'b', ref: '1:4-6', text: 'four to six' },
    { id: 'i2', ref: '2:intro', text: 'Chapter two' },
    { id: 'c', ref: '2:1', text: 'two one' },
    { id: 'whole', ref: '2', text: 'all of two' },
    { id: 'bad', ref: 'somewhere', text: '' }
  ]);
  const passage = (sc: number, sv: number, ec: number, ev: number) => ({ kind: 'bible' as const, range: { book: 'TIT', start: { chapter: sc, verse: sv }, end: { chapter: ec, verse: ev } }, versification: null });

  it('takes the rows whose verses meet it, and the introductions it starts', () => {
    expect(rowsOnPassage(tit, passage(1, 1, 1, 4), null).map((r) => [r.row.id, r.at ?? (r.intro ? 'intro' : '')])).toEqual([['f', 'intro'], ['i1', 'intro'], ['a', '1:1'], ['b', '1:4']]);
    // A passage in the middle of a range sits on it from its own first verse.
    expect(rowsOnPassage(tit, passage(1, 5, 2, 1), null).map((r) => [r.row.id, r.at ?? ''])).toEqual([['b', '1:5'], ['i2', ''], ['c', '2:1'], ['whole', '']]);
    expect(rowsOnPassage(tit, passage(1, 7, 1, 9), null)).toEqual([]);
    expect(rowsOnPassage(book([{ id: 'x', ref: '1:1', text: '' }], 'JHN'), passage(1, 1, 1, 2), null)).toEqual([]);
    expect(rowsByVerse(rowsOnPassage(tit, passage(1, 1, 1, 4), null)).map(([k, rs]) => [k, rs.map((r) => r.id)])).toEqual([['', ['f', 'i1']], ['1:1', ['a']], ['1:4', ['b']]]);
  });

  it('reads a story as every frame of it', () => {
    const obs = book([{ id: 't', ref: '1:0', text: 'title' }, { id: 'f1', ref: '1:1', text: 'frame' }, { id: 'f9', ref: '2:1', text: 'next story' }, { id: 's', ref: '1', text: 'story' }], 'OBS');
    expect(rowsOnPassage(obs, { kind: 'story', story: 1 }, null).map((r) => r.row.id)).toEqual(['t', 'f1', 's']);
    expect(rowsOnPassage(tit, { kind: 'story', story: 1 }, null)).toEqual([]);
  });

  it('meets a passage numbered another way through the versification', () => {
    const eng: VersificationDoc = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { MAL: ['14', '17', '18', '6'].map(Number) }, mappedVerses: { 'MAL 4:1-6': 'MAL 3:19-24' } };
    const org: VersificationDoc = { format: 'versification@1', code: 'org', name: 'Original', maxVerses: { MAL: [14, 17, 24] }, mappedVerses: {} };
    const mal = book([{ id: 'n', ref: '4:1', text: 'the day' }], 'MAL');
    const p = { kind: 'bible' as const, range: { book: 'MAL', start: { chapter: 3, verse: 19 }, end: { chapter: 3, verse: 20 } }, versification: org };
    expect(rowsOnPassage(mal, p, eng).map((r) => r.at)).toEqual(['4:1']);
  });

  it('underlines the words that stand for the original words a note is about', () => {
    const text = 'Paul, a servant of God and an apostle';
    const al: AlignmentDoc = {
      format: 'alignment@1', book: 'TIT', text: H('d'), original: 'grc', deps: [H('d')],
      chapters: [{ chapter: 1, verses: [{ verse: 1, words: [[0, 4], [6, 7], [8, 15], [16, 18], [19, 22], [23, 26]], groups: [[['Παῦλος:1'], [0]], [['δοῦλος:1'], [1, 2]], [['Θεοῦ:1'], [3, 4]]] }] }]
    };
    const spans = alignedSpans(al, 1, 1, ['δοῦλος:1', 'Θεοῦ:1'], text);
    expect(spans).toEqual([[6, 22]]);
    expect(markSpans(text, spans).filter((p) => p.marked).map((p) => p.text)).toEqual(['a servant of God']);
    expect(alignedSpans(al, 1, 1, ['Παῦλος:1'], text)).toEqual([[0, 4]]);
    expect(alignedSpans(al, 1, 2, ['Παῦλος:1'], text)).toEqual([]);
    expect(alignedSpans(null, 1, 1, ['Παῦλος:1'], text)).toEqual([]);
    expect(alignedSpans(al, 1, 1, [], text)).toEqual([]);
    expect(alignedQuote(al, 1, 1, ['δοῦλος:1', 'Θεοῦ:1'], text)).toBe('a servant of God');
    expect(alignedQuote(al, 1, 1, ['Παῦλος:1', 'Θεοῦ:1'], text)).toBe('Paul … of God');
    expect(alignedQuote(al, 1, 2, ['Παῦλος:1'], text)).toBeNull();
    // Punctuation between the words is kept, not taken for words left out.
    expect(alignedQuote(al, 1, 1, ['Παῦλος:1', 'δοῦλος:1'], text)).toBe('Paul, a servant');
    expect(markSpans('abc', [[1, 2], [0, 5]])).toEqual([{ text: 'a', marked: false }, { text: 'b', marked: true }, { text: 'c', marked: false }]);
  });

  it('gives a check the questions of a linked set that sit on the passage, with stable ids and the answer', () => {
    const set: HelpsDoc = withDeps({ format: 'helps@1', kind: 'questions', title: 'TQ', language: 'eng', license: 'l', credit: 'c', versification: H('a'), books: [{ book: 'TIT', doc: H('b') }], deps: [] });
    const qs = book([{ id: 'y5pp', ref: '1:1', text: 'What was Paul\'s purpose?', answer: 'To build up the faith.' }, { id: 'later', ref: '3:1', text: 'Later?', answer: '' }]);
    const found = passageQuestions('langquest.door43.tq', set, qs, passage(1, 1, 1, 4), null);
    expect(found).toEqual([{ q: { id: helpQuestionId('langquest.door43.tq', 'TIT', 'y5pp'), text: 'What was Paul\'s purpose?', type: 'text' }, answer: 'To build up the faith.', at: '1:1', itemId: 'langquest.door43.tq' }]);
    expect(passageQuestions('x', { ...set, kind: 'notes' }, qs, passage(1, 1, 1, 4), null)).toEqual([]);
    expect(passageQuestions('x', set, null, passage(1, 1, 1, 4), null)).toEqual([]);
    const asked = questionsForKind(emptyLanguageState(), 'community', undefined, [
      ...found.map((f) => ({ q: f.q, source: 'library' as const, required: false, answer: f.answer, at: f.at! })),
      { q: found[0]!.q, source: 'library' as const, required: false }
    ]);
    expect(asked).toEqual([{ q: found[0]!.q, source: 'library', required: false, answer: 'To build up the faith.', at: '1:1' }]);
  });
});
