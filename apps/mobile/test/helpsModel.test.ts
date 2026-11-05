import { describe, expect, it } from 'vitest';
import type { KeyTermView } from '@langquest-next/core';
import {
  firstTouched, keyLabel, keySpan, keyTouches, othersSay, plain, refInPassage, runKey, sameTerm, suggestedWords, tapVerse, wordHits,
  type LanguageTerms, type VerseRun
} from '../src/helps/helpsModel';
import type { VerseRow } from '../src/sources/model';

const row = (chapter: number, verseStart: number, text: string, verseEnd = verseStart): VerseRow =>
  ({ key: verseStart === verseEnd ? `${chapter}:${verseStart}` : `${chapter}:${verseStart}-${verseEnd}`, chapter, verseStart, verseEnd, text });

const rows: VerseRow[] = [
  row(15, 11, 'He said, “A certain man had two sons.'),
  row(15, 12, 'The younger of them said to his father, ‘Father, give me my share of your property.’'),
  row(15, 13, 'Not many days after, the younger son gathered all of this together.'),
  row(15, 18, 'I will get up and go to my father, and will tell him, “Father, I have sinned against heaven.'),
  row(15, 20, 'But while he was still far off, his father saw him, and was moved with compassion.'),
  row(15, 38, 'A bridge of two verses.', 39)
];

const term = (termId: string, word: string, extra: Partial<KeyTermView> = {}): KeyTermView =>
  ({ termId, term: word, gloss: '', unitScope: [], renderings: [], adjustments: [], ...extra });

describe('a note on verses chosen on the text (demo ADR-042)', () => {
  it('taps a verse, then another to run to it; a tap on the one verse goes back to the whole passage', () => {
    let run: VerseRun = null;
    run = tapVerse(run, 1);
    expect(run).toEqual([1, 1]);
    run = tapVerse(run, 3);
    expect(run).toEqual([1, 3]);
    // A run chosen: a tap starts again from that verse.
    run = tapVerse(run, 2);
    expect(run).toEqual([2, 2]);
    // Backwards runs read forwards.
    expect(tapVerse([4, 4], 0)).toEqual([0, 4]);
    expect(tapVerse([2, 2], 2)).toBeNull();
  });

  it('anchors to the verse rows’ own key form: one verse, a run, a bridge, across a chapter', () => {
    expect(runKey(rows, [1, 1])).toBe('15:12');
    expect(runKey(rows, [1, 2])).toBe('15:12-13');
    expect(runKey(rows, [5, 5])).toBe('15:38-39');
    expect(runKey([row(15, 30, 'a'), row(16, 1, 'b'), row(16, 2, 'c')], [0, 2])).toBe('15:30-16:2');
    expect(runKey(rows, [1, 9])).toBeNull();
    expect(keyLabel('15:12-13')).toBe('15:12–13');
  });

  it('puts a note on every verse of its run, and its mark on the first', () => {
    expect(keySpan('15:12-13')).toEqual({ start: { chapter: 15, verse: 12 }, end: { chapter: 15, verse: 13 } });
    expect(keySpan('15:30-16:2')).toEqual({ start: { chapter: 15, verse: 30 }, end: { chapter: 16, verse: 2 } });
    expect(keySpan('the whole thing')).toBeNull();
    expect(keyTouches('15:12-13', rows[1]!)).toBe(true);
    expect(keyTouches('15:12-13', rows[2]!)).toBe(true);
    expect(keyTouches('15:12-13', rows[3]!)).toBe(false);
    // A note on one verse of a bridge is on the bridge.
    expect(keyTouches('15:39', rows[5]!)).toBe(true);
    expect(keyTouches('15:30-16:2', row(16, 1, ''))).toBe(true);
    expect(firstTouched(rows, '15:12-13')).toBe(1);
    expect(firstTouched(rows, '16:1')).toBe(-1);
  });
});

describe('what a help says here', () => {
  it('takes markdown and line breaks out of a preview', () => {
    expect(plain('## Hear and Heart\n\n> [!action] **Stop** and [listen](#a1) again')).toBe('Hear and Heart Stop and listen again');
  });

  it('names where a note’s verse links meet the passage', () => {
    const range = { book: 'LUK', start: { chapter: 15, verse: 11 }, end: { chapter: 15, verse: 32 } };
    expect(refInPassage(['LUK 15:20'], range)).toBe('15:20');
    expect(refInPassage(['LUK 14:1-10', 'LUK 15:20-24'], range)).toBe('15:20–24');
    expect(refInPassage(['MRK 15:20'], range)).toBeNull();
    expect(refInPassage(['LUK 15:1-10'], range)).toBeNull();
    expect(refInPassage(['LUK 15:20'], null)).toBeNull();
  });
});

describe('a key word on a passage', () => {
  it('finds the verses a word is in, whole words only, marking each place', () => {
    const hits = wordHits(rows, 'Father');
    expect(hits.map((h) => h.row.key)).toEqual(['15:12', '15:18', '15:20']);
    expect(hits[0]!.parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['father', 'Father']);
    // "sin" is not "sinned"; a term is also found by the words in brackets.
    expect(wordHits(rows, 'sin')).toEqual([]);
    expect(wordHits(rows, 'mercy (compassion)').map((h) => h.row.key)).toEqual(['15:20']);
    expect(wordHits(null, 'father')).toEqual([]);
  });

  it('knows the same term in another language by its id, else by its word', () => {
    const theirs = [term('fia:sin', 'Sin'), term('kt-2', 'Compassion')];
    expect(sameTerm(theirs, term('fia:sin', 'sin (hamartia)'))?.termId).toBe('fia:sin');
    expect(sameTerm(theirs, term('kt-9', '  compassion ')).termId).toBe('kt-2');
    expect(sameTerm(theirs, term('kt-9', 'grace'))).toBeNull();
  });

  it('says how other languages here say it, by name, only where they said or wrote it', () => {
    const languages: LanguageTerms[] = [
      { languageId: 'din', name: 'Dinka', terms: [term('kt-d', 'compassion', { gloss: 'pity', renderings: [{ renderingId: 'r1', rendering: 'piɔ̈u', context: 'a heart that is moved' }], adjustments: [{ adjustmentId: 'a', note: '', blobHash: 'h1', actorId: 'p', hlc: '1' }] })] },
      { languageId: 'nus', name: 'Nuer', terms: [term('kt-n', 'compassion')] },
      { languageId: 'acd', name: 'Acholi', terms: [term('kt-a', 'Compassion', { gloss: 'mercy', renderings: [{ renderingId: 'r', rendering: 'kica', context: '' }] })] }
    ];
    expect(othersSay(languages, term('kt-b', 'compassion'))).toEqual([
      { languageId: 'acd', name: 'Acholi', termId: 'kt-a', word: 'kica', means: 'mercy' },
      { languageId: 'din', name: 'Dinka', termId: 'kt-d', word: 'piɔ̈u', means: 'a heart that is moved', voice: 'h1' }
    ]);
  });

  it('suggests the words other languages use in these verses that this language has not added, most used first', () => {
    const languages: LanguageTerms[] = [
      { languageId: 'din', name: 'Dinka', terms: [term('kt-d', 'compassion', { gloss: 'pity' }), term('kt-s', 'sinned'), term('kt-x', 'grace')] },
      { languageId: 'acd', name: 'Acholi', terms: [term('kt-a', 'Compassion')] }
    ];
    expect(suggestedWords(languages, rows, [term('kt-s2', 'Sinned')])).toEqual([
      { termId: 'kt-d', term: 'compassion', gloss: 'pity', languages: ['Dinka', 'Acholi'] }
    ]);
    expect(suggestedWords(languages, null, [])).toEqual([]);
  });
});
