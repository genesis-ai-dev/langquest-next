// A key word's own page (decision 172, keyTerms/wordPageModel.ts): every
// passage the word is in (its list links it there, the team's Bible says it,
// or a version marked it), where the team stands on each, the counts behind
// the filter chips, and the notes and reviews about the word, newest first.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KeyWordDoc, PassageNote, PassageState, VerseRange, VersificationDoc } from '@langquest-next/core';
import { usedByPassage, wordNotes, wordPassageCounts, wordPassages, type LineGlance } from '../src/keyTerms/wordPageModel';

function loadV11n(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications', `${code}.json`), 'utf8'));
  return {
    format: 'versification@1', code, name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {}, excludedVerses: raw.excludedVerses ?? [], partialVerses: raw.partialVerses ?? {}
  };
}
const eng = loadV11n('eng');
const ENG = 'e'.repeat(64);
const versificationOf = (h: string) => (h === ENG ? eng : null);

const range = (chapter: number, start: number, end: number): VerseRange => ({ book: 'LUK', start: { chapter, verse: start }, end: { chapter, verse: end } });
const PASSAGES = [
  { unitId: 'luk.1b', label: 'Luke 1:67–80', range: range(1, 67, 80) },
  { unitId: 'luk.4b', label: 'Luke 4:16–30', range: range(4, 16, 30) },
  { unitId: 'luk.7a', label: 'Luke 7:1–10', range: range(7, 1, 10) },
  { unitId: 'luk.13c', label: 'Luke 13:31–35', range: range(13, 31, 35) },
  { unitId: 'luk.24a', label: 'Luke 24:13–35', range: range(24, 13, 35) }
];
const TEXT: Record<string, { key: string; text: string }[]> = {
  'luk.4b': [{ key: '4:24', text: 'Truly, I say to you, no prophet is acceptable in his hometown.' }],
  'luk.7a': [{ key: '7:9', text: 'When Jesus heard these things, he marveled at him.' }],
  'luk.13c': [
    { key: '13:33', text: 'For it cannot be that a prophet should perish away from Jerusalem.' },
    { key: '13:34', text: 'O Jerusalem, the city that kills the Prophets!' }
  ]
};
const prophet: KeyWordDoc = { id: 't104', term: 'prophet', gloss: 'a person who gives messages from God', links: [{ ref: 'LUK 1:76' }, { ref: 'LUK 24:19' }] };
const list = { versification: ENG };
const LINES: Record<string, LineGlance> = {
  'luk.1b': { recorded: true, latest: { n: 1, takeId: 'take-1b' } },
  'luk.4b': { recorded: true, latest: { n: 3, takeId: 'take-4b-3' } },
  'luk.13c': { recorded: true, latest: { n: 2, takeId: 'take-13c-2' } }
};
const page = (c: Partial<Parameters<typeof wordPassages>[0]> = {}) => wordPassages({
  passages: PASSAGES, numbering: eng, versificationOf, from: { list, word: prophet }, forms: ['prophet', 'prophets'],
  rowsOf: (unitId) => TEXT[unitId] ?? [], used: new Map(), line: (unitId) => LINES[unitId] ?? { recorded: false }, own: true, ...c
});

describe('the passages a key word is in', () => {
  it('are those its list links it to and those where the Bible says it, in the language\'s order', () => {
    const rows = page();
    expect(rows.map((r) => r.unitId)).toEqual(['luk.1b', 'luk.4b', 'luk.13c', 'luk.24a']);
    expect(rows.find((r) => r.unitId === 'luk.1b')).toMatchObject({ linked: true, verses: [], said: [] });
    expect(rows.find((r) => r.unitId === 'luk.13c')).toMatchObject({ linked: false, verses: ['13:33', '13:34'], said: ['prophet', 'Prophets'] });
  });

  it('lists the passages the team has recorded first, each group in the language\'s order', () => {
    const rows = page({ line: (unitId) => (unitId === 'luk.13c' ? LINES[unitId]! : { recorded: false }), used: usedByPassage([{ unitId: 'luk.24a', n: 1, takeId: 'take-24a' }]) });
    expect(rows.map((r) => [r.unitId, r.status])).toEqual([['luk.24a', 'used'], ['luk.13c', 'notMarked'], ['luk.1b', 'notRecorded'], ['luk.4b', 'notRecorded']]);
  });

  it('says how each verse says it once, whatever its case', () => {
    const rows = page({ rowsOf: () => [{ key: '13:33', text: 'a prophet' }, { key: '13:34', text: 'the Prophet' }] });
    expect(rows.find((r) => r.unitId === 'luk.13c')!.said).toEqual(['prophet']);
  });

  it('marks the team\'s word used where a version marked it, not marked where recorded, and not recorded elsewhere', () => {
    const rows = page({ used: usedByPassage([{ unitId: 'luk.4b', n: 2, takeId: 'take-4b-2' }]) });
    const by = Object.fromEntries(rows.map((r) => [r.unitId, r]));
    // The version that marked it, not the newest one.
    expect(by['luk.4b']).toMatchObject({ status: 'used', version: 2, takeId: 'take-4b-2' });
    expect(by['luk.13c']).toMatchObject({ status: 'notMarked', version: 2, takeId: 'take-13c-2' });
    expect(by['luk.24a']).toMatchObject({ status: 'notRecorded', version: null, takeId: null });
  });

  it('keeps a passage where a version marked it even when neither the list nor the Bible places it there', () => {
    const rows = page({ used: usedByPassage([{ unitId: 'luk.7a', n: 1, takeId: 'take-7a' }]) });
    expect(rows.find((r) => r.unitId === 'luk.7a')).toMatchObject({ status: 'used', linked: false, verses: [] });
  });

  it('places a list\'s word the team has not taken by its links alone, recorded or not', () => {
    const rows = page({ own: false, forms: [] });
    expect(rows.map((r) => [r.unitId, r.status, r.version])).toEqual([['luk.1b', 'recorded', 1], ['luk.24a', 'notRecorded', null]]);
  });

  it('leaves the text out when the Bible is not at hand, and the links still count', () => {
    const rows = page({ rowsOf: () => null });
    expect(rows.map((r) => r.unitId)).toEqual(['luk.1b', 'luk.24a']);
  });

  it('counts the passages behind each chip', () => {
    const rows = page({ used: usedByPassage([{ unitId: 'luk.4b', n: 2, takeId: 'take-4b-2' }]) });
    expect(wordPassageCounts(rows)).toEqual({ all: 4, used: 1, notMarked: 2, notRecorded: 1, recorded: 0 });
  });
});

describe('the versions that marked a word', () => {
  it('keep the newest one in each passage', () => {
    const used = usedByPassage([
      { unitId: 'luk.4b', n: 1, takeId: 'a' }, { unitId: 'luk.4b', n: 3, takeId: 'c' }, { unitId: 'luk.4b', n: 2, takeId: 'b' }, { unitId: 'luk.13c', n: 1, takeId: 'd' }
    ]);
    expect([...used]).toEqual([['luk.4b', { n: 3, takeId: 'c' }], ['luk.13c', { n: 1, takeId: 'd' }]]);
  });
});

describe('the notes and reviews about a word', () => {
  const note = (id: string, hlc: string, over: Partial<PassageNote> = {}): PassageNote => ({
    id, hlc, by: 'rose', eventId: `e-${id}`, unitId: 'luk.4b', anchor: { kind: 'term', termId: 'fia:t104' }, text: id, ...over
  } as PassageNote);
  const state = (notes: PassageNote[], versions: { takeId: string; n: number }[] = []) => ({ notes, versions } as unknown as PassageState);

  it('are the notes on the word across its passages, newest first, each with its version, check and replies', () => {
    const fourB = state([
      note('n1', '0001', { onTakeId: 'take-4b-1', kindId: 'peer', reviewId: 'r1' }),
      note('reply1', '0004', { anchor: { kind: 'term', termId: 'fia:t104', replyTo: 'n1' } }),
      note('reply2', '0005', { anchor: { kind: 'term', termId: 'fia:t104', replyTo: 'n1' } }),
      note('other', '0006', { anchor: { kind: 'term', termId: 'kt-other' } }),
      note('passage', '0007', { anchor: { kind: 'passage' } })
    ], [{ takeId: 'take-4b-1', n: 1 }]);
    const thirteen = state([note('n2', '0003', { unitId: 'luk.13c', kindId: 'record' })]);
    const rows = wordNotes([{ unitId: 'luk.4b', label: 'Luke 4:16–30', state: fourB }, { unitId: 'luk.13c', label: 'Luke 13:31–35', state: thirteen }], 'fia:t104');
    expect(rows.map((r) => [r.note.id, r.label, r.version, r.kindId, r.review, r.replies])).toEqual([
      ['n2', 'Luke 13:31–35', null, 'record', false, 0],
      ['n1', 'Luke 4:16–30', 1, 'peer', true, 2]
    ]);
  });

  it('are none when no note names the word', () => {
    expect(wordNotes([{ unitId: 'luk.4b', label: 'Luke 4:16–30', state: state([]) }], 'fia:t104')).toEqual([]);
  });
});
