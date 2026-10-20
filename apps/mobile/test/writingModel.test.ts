// Writing beside recording (decisions.md 147): what the writing screens read
// from the record (writing/model.ts, writing/namesModel.ts), against real
// folds of the event log.
import { describe, expect, it } from 'vitest';
import {
  buildIndexes, commands, derivePassage, foldLanguage, HlcClock, writtenPartId, type AnyEvent, type EventSpec, type KindDef, type MakesSpec
} from '@langquest-next/core';
import {
  boxesChanged, boxesFor, EMPTY_WRITING, heardByVerse, isWritingDraft, writingDraftFor, isPartKey, nfc, partIdFor, partKey, teamLetters, writingSpecs, writtenByVerse
} from '../src/writing/boxesModel';
import { isMaking, leadMedium, makingLanguage, makingSource, otherMedium, readsFor, sourceMedium } from '../src/writing/model';
import { madeTitle, presetName } from '../src/writing/namesModel';

const VERSES = ['15:1', '15:2', '15:3'];

function language() {
  const log: AnyEvent[] = [];
  let wall = 1_700_000_000_000;
  const clock = new HlcClock('d', () => wall);
  const run = (specs: EventSpec[], actorId = 'tr') => {
    for (const s of specs) {
      wall += 1000;
      log.push({ id: s.id, type: s.type, orgId: 'o', streamId: 'L1', actorId, deviceId: 'd', hlc: clock.next(), payload: s.payload, serverSeq: log.length + 1 } as AnyEvent);
    }
  };
  const state = () => foldLanguage(log);
  run([{ id: 'unit', type: 'v1.UnitAdded', payload: { unitId: 'u', parentUnitId: null, kind: 'passage', label: 'Luke 15:1-3', order: 'a' } }], 'lead');
  /** Write the boxes and publish them as a version. */
  const publishWriting = (commandId: string, boxes: { key: string; text: string }[]) => {
    const s = state();
    const { specs, ids } = writingSpecs(s, buildIndexes(s), { commandId, unitId: 'u', boxes, verseKeys: VERSES });
    run(specs);
    run([
      { id: `${commandId}:take`, type: 'v1.TakeComposed', payload: { takeId: `take:${commandId}`, unitId: 'u', cardHashes: ids, parentTakeId: null } },
      { id: `${commandId}:submit`, type: 'v1.TakeSubmitted', payload: { takeId: `take:${commandId}`, questionSetIds: [] } }
    ]);
    return { ids, takeId: `take:${commandId}` };
  };
  return { run, state, publishWriting };
}

const rec = (n: number) => String(n).repeat(64).slice(0, 64);

describe('the words a written version holds, verse by verse', () => {
  it('writes only filled boxes, labels each with its verse, and reads them back', () => {
    const l = language();
    const { ids } = l.publishWriting('v1', [{ key: '15:1', text: ' Tax collectors came near. ' }, { key: '15:2', text: '' }, { key: '15:3', text: 'He told them this story.' }]);
    expect(ids).toEqual([writtenPartId('Tax collectors came near.'), writtenPartId('He told them this story.')]);
    expect(writtenByVerse(l.state(), 'u', ids, VERSES)).toEqual([
      { key: '15:1', text: 'Tax collectors came near.' },
      { key: '15:3', text: 'He told them this story.' }
    ]);
    // The boxes to change it in: every verse, the empty one too.
    expect(boxesFor(VERSES, writtenByVerse(l.state(), 'u', ids, VERSES)).map((b) => b.text)).toEqual(['Tax collectors came near.', '', 'He told them this story.']);
  });

  it('reads parts with no verse as numbered parts, and joins two parts on one verse', () => {
    const l = language();
    const a = writtenPartId('First.');
    const b = writtenPartId('Second.');
    l.run(commands(l.state()).addWriting({ commandId: 'w', unitId: 'u', parts: [{ id: a, text: 'First.' }, { id: b, text: 'Second.' }] }));
    expect(writtenByVerse(l.state(), 'u', [a, b], [])).toEqual([{ key: partKey(0), text: 'First.' }, { key: partKey(1), text: 'Second.' }]);
    l.run(commands(l.state()).setCardVerses({ commandId: 'v', unitId: 'u', cards: [a, b], marks: [{ t: 'set', s: 0, e: 0 }, { t: 'set', s: 0, e: 0 }], verses: VERSES }));
    expect(writtenByVerse(l.state(), 'u', [a, b], VERSES)).toEqual([{ key: '15:1', text: 'First. Second.' }]);
  });

  it('hears a recording verse by verse, with unlabelled parts each on their own', () => {
    const l = language();
    const cards = [rec(1), rec(2), rec(3)];
    expect(heardByVerse(l.state(), 'u', cards, [])).toEqual(cards.map((h, i) => ({ key: partKey(i), hashes: [h] })));
    l.run(commands(l.state()).setCardVerses({ commandId: 'v', unitId: 'u', cards, marks: [{ t: 'set', s: 0, e: 0 }, { t: 'set', s: 0, e: 0 }, { t: 'set', s: 2, e: 2 }], verses: VERSES }));
    expect(heardByVerse(l.state(), 'u', cards, VERSES)).toEqual([{ key: '15:1', hashes: [rec(1), rec(2)] }, { key: '15:3', hashes: [rec(3)] }]);
  });
});

describe('the writing boxes', () => {
  it('give one box per verse, else per part there is, else one', () => {
    expect(boxesFor(['1', '2'], [{ key: '2', text: 'Two' }])).toEqual([{ key: '1', text: '' }, { key: '2', text: 'Two' }]);
    expect(boxesFor([], [{ key: 'x', text: 'A' }, { key: 'y', text: 'B' }])).toEqual([{ key: partKey(0), text: 'A' }, { key: partKey(1), text: 'B' }]);
    expect(boxesFor([], [])).toEqual([{ key: partKey(0), text: '' }]);
    expect(isPartKey(partKey(3))).toBe(true);
    expect(isPartKey('15:3')).toBe(false);
  });

  it('count as changed only when the words differ, not their spaces, empty boxes or how an accent was typed', () => {
    const start = [{ key: '1', text: 'café' }, { key: '2', text: '' }];
    expect(boxesChanged([{ key: '1', text: ' café ' }, { key: '2', text: '  ' }], start)).toBe(false);
    expect(boxesChanged([{ key: '1', text: 'cafe' }, { key: '2', text: '' }], start)).toBe(true);
    expect(boxesChanged([{ key: '1', text: 'café' }, { key: '2', text: 'More' }], start)).toBe(true);
  });

  it('keep a draft only while the words differ from where they started (decisions.md 127)', () => {
    const start = [{ key: '1', text: 'One' }];
    expect(writingDraftFor([{ key: '1', text: 'One ' }], start)).toEqual(EMPTY_WRITING);
    expect(writingDraftFor([{ key: '1', text: 'Uno' }], start)).toEqual({ boxes: [{ key: '1', text: 'Uno' }] });
    expect(isWritingDraft({ boxes: [{ key: '1', text: 'Uno' }] })).toBe(true);
    expect(isWritingDraft(EMPTY_WRITING)).toBe(true);
    expect(isWritingDraft({ boxes: [{ key: 1, text: 'x' }] })).toBe(false);
    expect(isWritingDraft({ boxes: 'x' })).toBe(false);
    expect(isWritingDraft(null)).toBe(false);
  });

  it('name the same words typed two ways alike', () => {
    expect(nfc('café')).toBe('café');
    expect(partIdFor('  café ')).toBe(writtenPartId('café'));
  });
});

describe('the letters strip above the keyboard', () => {
  it('learns the letters a plain keyboard lacks, most used first, marks kept on their letter', () => {
    const l = language();
    const words = ['Ɛ̈ ŋa ɛ̈ ɛ̈', 'ŋɔ ŋɔ ɛ̈', 'plain words only'];
    l.run(commands(l.state()).addWriting({ commandId: 'w', unitId: 'u', parts: words.map((text) => ({ id: writtenPartId(text), text })) }));
    expect(teamLetters(l.state())).toEqual(['ɛ̈', 'ŋ', 'ɔ']);
    expect(teamLetters(l.state(), 1)).toEqual(['ɛ̈']);
    expect(teamLetters(language().state())).toEqual([]);
  });
});

describe('what a passage leads with', () => {
  it('records until the language says otherwise, and offers the other only when both are allowed', () => {
    const l = language();
    expect(leadMedium(l.state())).toBe('recording');
    expect(otherMedium(l.state())).toBeNull();
    l.run(commands(l.state()).setMediaAllowed({ commandId: 'm1', recording: true, writing: true, first: 'writing' }), 'lead');
    expect(leadMedium(l.state())).toBe('writing');
    expect(otherMedium(l.state())).toBe('recording');
    l.run(commands(l.state()).setMediaAllowed({ commandId: 'm2', recording: true, writing: true, first: 'recording' }), 'lead');
    expect(otherMedium(l.state())).toBe('writing');
    l.run(commands(l.state()).setMediaAllowed({ commandId: 'm3', recording: false, writing: true, first: 'writing' }), 'lead');
    expect(leadMedium(l.state())).toBe('writing');
    expect(otherMedium(l.state())).toBeNull();
  });
});

describe('what a making step works from, and what a check reads', () => {
  const writeDown: MakesSpec = { from: 'recording', to: 'writing', language: 'same', result: 'beside' };
  const bt: MakesSpec = { from: 'either', to: 'writing', language: 'other', result: 'beside' };
  const kind = (id: string, extra: Partial<KindDef> = {}): KindDef => ({ id, name: id, description: '', usualReviewer: '', ...extra });

  it('works from the latest version, or from what the step before it made', () => {
    const l = language();
    expect(makingSource(derivePassage(l.state(), 'u'), writeDown)).toBeNull();
    const { takeId } = l.publishWriting('v1', [{ key: '15:1', text: 'Words.' }]);
    const p = derivePassage(l.state(), 'u');
    const src = makingSource(p, writeDown)!;
    expect(src).toMatchObject({ kind: 'version', version: { takeId } });
    expect(sourceMedium(src)).toBe('writing');
    expect(makingSource(p, { ...bt, fromKindId: 'writeDown' })).toBeNull();

    const said = { hash: rec(7), durationMs: 1200 };
    l.run(commands(l.state()).make({ commandId: 'said', unitId: 'u', kindId: 'readAloud', fromTakeId: takeId, parts: [said] }));
    const after = derivePassage(l.state(), 'u');
    const made = makingSource(after, { ...bt, fromKindId: 'readAloud' })!;
    expect(made).toMatchObject({ kind: 'made', made: { kindId: 'readAloud' } });
    expect(sourceMedium(made)).toBe('recording');

    // A check that reads what the step made from this version, else the version itself.
    const version = after.latest!;
    expect(readsFor(after, kind('peer', { looksAt: 'readAloud' }), version)).toMatchObject({ medium: 'recording', parts: [rec(7)] });
    expect(readsFor(after, kind('peer', { looksAt: 'other' }), version)).toEqual({ medium: 'writing', parts: version.cardHashes });
    expect(readsFor(after, kind('peer'), version)).toEqual({ medium: 'writing', parts: version.cardHashes });
  });

  it('makes in the team language, the named one, or the reference language', () => {
    expect(makingLanguage(writeDown, 'eng')).toBeUndefined();
    expect(makingLanguage(bt, 'eng')).toBe('eng');
    expect(makingLanguage({ ...bt, otherLanguage: 'fra' }, 'eng')).toBe('fra');
  });

  it('counts both new making steps and the shipped back translation as making', () => {
    expect(isMaking(kind('w', { makes: writeDown }))).toBe(true);
    expect(isMaking(kind('bt', { produces: { what: 'back translation', into: 'English', action: 'Back-translate it', checkedBy: 'consultant' } as KindDef['produces'] }))).toBe(true);
    expect(isMaking(kind('peer'))).toBe(false);
  });
});

describe('what made things are called', () => {
  const v = { kind: (id: string) => ({ ...({} as KindDef), id, name: id === 'wd' ? 'Write it down' : id }) };
  it('by their step, else by what they are', () => {
    expect(madeTitle(v as never, { kindId: 'wd', medium: 'writing' })).toBe('Write it down');
    expect(madeTitle(v as never, { medium: 'writing', language: 'eng' })).toMatch(/^Written in /);
    expect(madeTitle(v as never, { medium: 'recording', language: 'eng' })).toMatch(/^Said in /);
    expect(madeTitle(v as never, { medium: 'writing' })).toBe('Written down');
    expect(madeTitle(v as never, { medium: 'recording' })).toBe('Recorded again');
  });

  it('ready-made steps by name, and anything else by its id', () => {
    expect(['make-bt-said', 'make-bt-written', 'make-write-down', 'make-read-aloud', 'make-final', 'mine'].map(presetName))
      .toEqual(['Back translation', 'Written back translation', 'Write it down', 'Read it aloud', 'Final recording', 'mine']);
  });
});
