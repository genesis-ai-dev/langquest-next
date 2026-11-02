import { deriveDownloadWork, deriveUploadWork, evictableBlobs, recordAudio } from '../src/blobs';
import { cleanedFrom, cleanUpOf, mayCleanUp, recordedCard } from '../src/cards';
import { CommandError, commands, type EventSpec } from '../src/commands';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { derivePassage } from '../src/passage';
import { PASSAGE_PART } from '../src/passageParts';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { validateEvent } from '../src/validate';

/**
 * Why: Clean up (decisions.md 176) puts a cleaned sound in a part's place
 * without touching the part as recorded (invariant 4). A version already
 * handed on must keep playing what it had, the draft must play the cleaned
 * sound with the part's verses, the original must still reach the server
 * and no phone may fetch it while the cleaned sound plays, and a cleaned
 * sound must stay playable and uploadable whatever later note wins.
 */
let n = 0;
const ev = <T extends EventType>(type: T, payload: EventPayloads[T], deviceId = 'dA', actorId = 't1'): AnyEvent => {
  n += 1;
  return { id: `cu${String(n).padStart(3, '0')}`, type, orgId: 'org1', streamId: 'L1', actorId, deviceId, hlc: `0017000002${String(n).padStart(4, '0')}:000000:${deviceId}`, payload } as AnyEvent;
};
const base = (): AnyEvent[] => [
  ev('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a0' }),
  ev('v1.UnitAdded', { unitId: 'luke1', parentUnitId: 'luke', kind: 'passage', label: 'Luke 1:1-4', order: 'a0' }),
  ev('v1.RecordingAdded', { recordingId: 'rec1', unitId: 'luke1', kind: 'target', cards: [{ hash: 'a', durationMs: 1200, format: 'm4a' }, { hash: 'b', durationMs: 900, format: 'm4a' }] }),
  ev('v1.TakeComposed', { takeId: 'take1', unitId: 'luke1', cardHashes: ['a', 'b'], parentTakeId: null }),
  ev('v1.CardVerseSet', { unitId: 'luke1', hash: 'a', mark: 'set', from: '1:1', to: '1:2' })
];
const stored = (...hashes: string[]) => hashes.map((hash) => ev('v1.BlobStored', { hash, size: 100 }, 'storage', 'service'));
const fold = (events: AnyEvent[]) => foldLanguage(events, emptyLanguageState());
const apply = (state: LanguageState, specs: EventSpec[], deviceId = 'dB') => foldLanguage(specs.map((s) => ({ ...ev(s.type, s.payload, deviceId), id: s.id })), state);
const hashes = (refs: { hash: string }[]) => refs.map((r) => r.hash);

const clean = (state: LanguageState, cardHashes = ['a', 'b'], cleaned = 'a2') =>
  commands(state).cleanUpPart({ commandId: `cu-${cleaned}`, unitId: 'luke1', actorId: 't1', cardHashes, hash: 'a', tool: 'dfn3', limitDb: 12, use: 'cleaned', cleaned: { hash: cleaned, format: 'm4a' } });

describe('a cleaned part (decisions.md 176)', () => {
  it('plays its cleaned sound in a new draft with the same verses, and the version before keeps the part as recorded', () => {
    const before = fold(base());
    const specs = clean(before);
    expect(specs.map((s) => s.type)).toEqual(['v1.CardCleanUpSet', 'v1.TakeComposed', 'v1.TakeArchived', 'v1.CardVerseSet']);
    const after = apply(before, specs);
    expect(after.invalidEvents).toEqual({});
    const draft = derivePassage(after, 'luke1').draftTakeId!;
    expect(after.takes[draft]?.cardHashes).toEqual(['a2', 'b']);
    expect(after.takes['take1']?.cardHashes).toEqual(['a', 'b']);
    expect(recordedCard(after, 'a2')).toEqual({ hash: 'a2', durationMs: 1200, format: 'm4a' });
    expect(cleanedFrom(after, 'a2')).toEqual({ unitId: 'luke1', hash: 'a' });
    expect(cleanedFrom(after, 'b')).toBeNull();
    expect(after.cardVerses['luke1']?.['a2']?.value).toEqual({ mark: 'set', from: '1:1', to: '1:2' });
    expect(cleanUpOf(after, 'luke1', 'a')?.value).toMatchObject({ use: 'cleaned', cleanedHash: 'a2', tool: 'dfn3', limitDb: 12, actorId: 't1' });
  });

  it('cannot be cleaned twice, nor can its cleaned sound; another part can', () => {
    const after = apply(fold(base()), clean(fold(base())));
    expect(mayCleanUp(after, 'luke1', 'a')).toBe(false);
    expect(mayCleanUp(after, 'luke1', 'a2')).toBe(false);
    expect(mayCleanUp(after, 'luke1', 'b')).toBe(true);
    expect(() => clean(after, ['a', 'b'], 'a3')).toThrow(CommandError);
    expect(() => clean(fold(base()), ['b'])).toThrow(CommandError);
    expect(() => clean(fold(base()), ['a', 'b'], 'b')).toThrow(CommandError);
  });

  it('several parts at once: one draft holds every cleaned sound, and a part kept as recorded gets only its note', () => {
    const before = fold([...base(), ev('v1.CardVerseSet', { unitId: 'luke1', hash: 'b', mark: 'next' })]);
    const specs = commands(before).cleanUpParts({
      commandId: 'all', unitId: 'luke1', actorId: 't1', cardHashes: ['a', 'b'], tool: 'dfn3', limitDb: 12,
      parts: [{ hash: 'a', use: 'cleaned', cleaned: { hash: 'a2', format: 'm4a' } }, { hash: 'b', use: 'original' }]
    });
    expect(specs.filter((s) => s.type === 'v1.TakeComposed')).toHaveLength(1);
    const after = apply(before, specs);
    expect(after.invalidEvents).toEqual({});
    expect(after.takes[derivePassage(after, 'luke1').draftTakeId!]?.cardHashes).toEqual(['a2', 'b']);
    expect(after.cardVerses['luke1']?.['a2']?.value).toEqual({ mark: 'set', from: '1:1', to: '1:2' });
    expect(cleanUpOf(after, 'luke1', 'b')?.value).toMatchObject({ use: 'original', limitDb: 12 });
    const kept = commands(before).cleanUpParts({ commandId: 'none', unitId: 'luke1', actorId: 't1', cardHashes: ['a', 'b'], tool: 'dfn3', parts: [{ hash: 'b', use: 'original' }] });
    expect(kept.map((s) => s.type)).toEqual(['v1.CardCleanUpSet']);
    const twice = [{ hash: 'a', use: 'original' as const }, { hash: 'a', use: 'original' as const }];
    expect(() => commands(before).cleanUpParts({ commandId: 'x', unitId: 'luke1', actorId: 't1', cardHashes: ['a', 'b'], tool: 'dfn3', parts: twice })).toThrow(CommandError);
    const same = [{ hash: 'a', use: 'cleaned' as const, cleaned: { hash: 'c', format: 'm4a' as const } }, { hash: 'b', use: 'cleaned' as const, cleaned: { hash: 'c', format: 'm4a' as const } }];
    expect(() => commands(before).cleanUpParts({ commandId: 'y', unitId: 'luke1', actorId: 't1', cardHashes: ['a', 'b'], tool: 'dfn3', parts: same })).toThrow(CommandError);
  });

  it('kept as recorded saves only the note, and may be tried again', () => {
    const before = fold(base());
    const specs = commands(before).cleanUpPart({ commandId: 'keep', unitId: 'luke1', actorId: 't1', cardHashes: ['a', 'b'], hash: 'a', tool: 'dfn3', use: 'original' });
    expect(specs).toEqual([{ id: 'keep:0', type: 'v1.CardCleanUpSet', payload: { unitId: 'luke1', hash: 'a', use: 'original', tool: 'dfn3' } }]);
    const after = apply(before, specs);
    expect(derivePassage(after, 'luke1').draftTakeId).toBe('take1');
    expect(cleanUpOf(after, 'luke1', 'a')?.value.use).toBe('original');
    expect(mayCleanUp(after, 'luke1', 'a')).toBe(true);
  });
});

describe('the files of a cleaned part', () => {
  it('uploads the part as recorded and its cleaned sound', () => {
    const after = apply(fold(base()), clean(fold(base())));
    expect(hashes(deriveUploadWork(after, new Set(['a', 'b', 'a2'])))).toEqual(['a', 'b', 'a2']);
  });

  it('never downloads the part as recorded while its cleaned sound plays, and lets a phone free it', () => {
    const after = apply(fold([...base(), ...stored('a', 'b')]), clean(fold([...base(), ...stored('a', 'b')])));
    const done = foldLanguage(stored('a2'), after);
    expect(hashes(deriveDownloadWork(done, new Set()))).toEqual(['b', 'a2']);
    expect(hashes(deriveDownloadWork(done, new Set(), new Set(['luke1'])))).toEqual(['b', 'a2']);
    expect(hashes(evictableBlobs(done, new Set(['a', 'b', 'a2']), new Set(['luke1'])))).toEqual(['a']);
  });

  it('Undo puts the part as recorded back, and the cleaned sound still plays where a version holds it', () => {
    const start = fold([...base(), ...stored('a', 'b', 'a2')]);
    const cleaned = apply(start, clean(start));
    const specs = commands(cleaned).undoCleanUp({ commandId: 'undo', unitId: 'luke1', actorId: 't1', cardHashes: ['a2', 'b'], hash: 'a' });
    expect(specs.map((s) => s.type)).toEqual(['v1.CardCleanUpSet', 'v1.TakeComposed', 'v1.TakeArchived']);
    const undone = apply(cleaned, specs);
    expect(undone.takes[derivePassage(undone, 'luke1').draftTakeId!]?.cardHashes).toEqual(['a', 'b']);
    expect(cleanUpOf(undone, 'luke1', 'a')).toBeNull();
    expect(mayCleanUp(undone, 'luke1', 'a')).toBe(true);
    expect(recordedCard(undone, 'a2')?.format).toBe('m4a');
    expect(hashes(deriveDownloadWork(undone, new Set()))).toEqual(['a', 'b', 'a2']);
    expect(commands(undone).undoCleanUp({ commandId: 'again', unitId: 'luke1', actorId: 't1', cardHashes: ['a', 'b'], hash: 'a' })).toEqual([]);
  });

  it('Undo carries a verse mark changed on the cleaned sound back to the part', () => {
    const start = fold(base());
    const cleaned = apply(start, [...clean(start), { id: 'mark', type: 'v1.CardVerseSet', payload: { unitId: 'luke1', hash: 'a2', mark: 'next' } }]);
    const specs = commands(cleaned).undoCleanUp({ commandId: 'undo', unitId: 'luke1', actorId: 't1', cardHashes: ['a2', 'b'], hash: 'a' });
    expect(specs.at(-1)).toMatchObject({ type: 'v1.CardVerseSet', payload: { unitId: 'luke1', hash: 'a', mark: 'next' } });
  });
});

describe('two phones choose for the same part', () => {
  const cleanedOn = (deviceId: string, cleanedHash: string) => ev('v1.CardCleanUpSet', { unitId: 'luke1', hash: 'a', use: 'cleaned', cleanedHash, cleanedFormat: 'm4a', tool: 'dfn3' }, deviceId);
  const keptOn = (deviceId: string) => ev('v1.CardCleanUpSet', { unitId: 'luke1', hash: 'a', use: 'original', tool: 'dfn3' }, deviceId);

  it('a later "kept as recorded" wins, and the cleaned sound the first phone made still goes up and plays', () => {
    const first = cleanedOn('dA', 'a2');
    const later = keptOn('dB');
    const one = fold([...base(), first, later]);
    const other = fold([...base(), later, first]);
    expect(one.cardCleanUps).toEqual(other.cardCleanUps);
    expect(cleanUpOf(one, 'luke1', 'a')?.value.use).toBe('original');
    expect(recordedCard(one, 'a2')).toEqual({ hash: 'a2', durationMs: 1200, format: 'm4a' });
    expect(hashes(deriveUploadWork(one, new Set(['a2'])))).toEqual(['a2']);
    expect(hashes(deriveDownloadWork(foldLanguage(stored('a', 'a2'), one), new Set()))).toEqual(['a', 'a2']);
  });

  it('two cleaned sounds both stay named; only the later one plays instead of the part', () => {
    const one = fold([...base(), cleanedOn('dA', 'a2'), cleanedOn('dB', 'a3')]);
    expect(Object.keys(one.cardCleanUps['luke1']!['a']!.value.files)).toEqual(['a2', 'a3']);
    expect(recordAudio('cardCleanUps', one.cardCleanUps['luke1'])).toEqual([{ hash: 'a2', format: 'm4a' }, { hash: 'a3', format: 'm4a', replaces: 'a' }]);
  });

  it('two copies of a passage, each folded from some of the notes, combine into the fold of all of them', () => {
    const notes = [cleanedOn('dA', 'a2'), keptOn('dB'), cleanedOn('dC', 'a3')];
    const all = fold([...base(), ...notes]).cardCleanUps['luke1'];
    for (const one of notes) {
      const a = fold([...base(), one]).cardCleanUps['luke1'];
      const b = fold([...base(), ...notes.filter((e) => e !== one)]).cardCleanUps['luke1'];
      expect(PASSAGE_PART.cardCleanUps.merge(a, b)).toEqual(all);
      expect(PASSAGE_PART.cardCleanUps.merge(b, a)).toEqual(all);
    }
  });
});

describe('a kept language\'s audio rows (decisions.md 143)', () => {
  it('say the cleaned sound plays instead of the part while it does, and stop saying so after Undo', () => {
    const start = fold(base());
    const cleaned = apply(start, clean(start));
    expect(recordAudio('cardCleanUps', cleaned.cardCleanUps['luke1'])).toEqual([{ hash: 'a2', format: 'm4a', replaces: 'a' }]);
    const undone = apply(cleaned, commands(cleaned).undoCleanUp({ commandId: 'undo', unitId: 'luke1', actorId: 't1', cardHashes: ['a2', 'b'], hash: 'a' }));
    expect(recordAudio('cardCleanUps', undone.cardCleanUps['luke1'])).toEqual([{ hash: 'a2', format: 'm4a' }]);
  });
});

describe('what a note may say', () => {
  const note = (payload: Record<string, unknown>) => validateEvent(ev('v1.CardCleanUpSet', { unitId: 'luke1', hash: 'a', ...payload } as EventPayloads['v1.CardCleanUpSet']));
  it.each([
    [{ use: 'cleaned', cleanedHash: 'a2', cleanedFormat: 'm4a', tool: 'dfn3', limitDb: 12 }, null],
    [{ use: 'cleaned', cleanedHash: 'a2', cleanedFormat: 'wav', tool: 'dfn3' }, null],
    [{ use: 'original', tool: 'dfn3', limitDb: 100 }, null],
    [{ use: 'none' }, null],
    [{ use: 'cleaned', tool: 'dfn3' }, 'cleanedHash must be a non-empty string'],
    [{ use: 'cleaned', cleanedHash: 'a', cleanedFormat: 'm4a', tool: 'dfn3' }, 'cleanedHash must not be hash'],
    [{ use: 'cleaned', cleanedHash: 'a2', cleanedFormat: 'mp3', tool: 'dfn3' }, 'cleanedFormat must be one of wav, m4a'],
    [{ use: 'cleaned', cleanedHash: 'a2', cleanedFormat: 'm4a' }, 'tool must be a non-empty string'],
    [{ use: 'original', tool: 'dfn3', cleanedHash: 'a2', cleanedFormat: 'm4a' }, 'cleanedHash and cleanedFormat belong to cleaned only'],
    [{ use: 'none', cleanedHash: 'a2', cleanedFormat: 'm4a' }, 'cleanedHash and cleanedFormat belong to cleaned only'],
    [{ use: 'none', tool: 'dfn3' }, 'none names no tool'],
    [{ use: 'original', tool: 'dfn3', limitDb: 0 }, 'limitDb must be a number above 0 and at most 100'],
    [{ use: 'original', tool: 'dfn3', limitDb: 100.5 }, 'limitDb must be a number above 0 and at most 100'],
    [{ use: 'kept', tool: 'dfn3' }, 'use must be one of cleaned, original, none']
  ])('%j: %s', (payload, error) => {
    expect(note(payload)).toBe(error);
  });
});
