import { CommandError, commands, type EventSpec } from '../src/commands';
import { TG_MATERIAL_ID } from '../src/materials';
import { derivePassage } from '../src/passage';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { buildFixture } from './fixtures';
import type { AnyEvent } from '../src/events';

/**
 * Why: a command is the one definition of what a user action means. If
 * "keep" stopped archiving the replaced draft, or archived a teammate's, or
 * a review accepted a take nobody published, the record would silently
 * disagree with the UX spec. These tests pin each command to the events
 * that implement it, and to the state it refuses.
 */
describe('commands', () => {
  const events = buildFixture().filter((e) => e.parentEventId === undefined);
  // The reducer folds in place, so every test starts from its own fold.
  const submitted = () => foldLanguage(events, emptyLanguageState());
  /** take2 is t1's unpublished draft. */
  const draft = () => foldLanguage(events.filter((e) => e.type !== 'v1.TakeSubmitted' && e.type !== 'v1.ReviewRecorded'), emptyLanguageState());
  const empty = () => foldLanguage(events.filter((e) => !e.type.startsWith('v1.Take')), emptyLanguageState());
  const card = { hash: 'c9', durationMs: 100 };

  /** Apply command output as `actorId`'s events so a command can be checked against the fold it produces. */
  function apply(state: LanguageState, specs: EventSpec[], actorId = 't1') {
    let s = state;
    for (const [i, spec] of specs.entries()) {
      s = foldLanguage([{ ...spec, orgId: 'o', streamId: 'L1', actorId, deviceId: 'dB', hlc: `${900000000000000 + i}:000000:dB` } as AnyEvent], s);
    }
    return s;
  }

  it('event ids are stable per command, so a retried command is absorbed by idempotency', () => {
    const d = draft();
    const a = commands(d).keepTake({ commandId: 'cmd1', unitId: 'luke1', cardHashes: ['c1'], actorId: 't1' });
    const b = commands(d).keepTake({ commandId: 'cmd1', unitId: 'luke1', cardHashes: ['c1'], actorId: 't1' });
    expect(a).toEqual(b);
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
    expect(apply(apply(d, a), b).invalidEvents).toEqual(draft().invalidEvents);
    expect(derivePassage(apply(apply(draft(), a), b), 'luke1').draftTakeId).toBe('take:cmd1');
  });

  it('keepTake composes and archives the actor\'s own draft it replaces; a published take is kept as parent', () => {
    const fromDraft = commands(draft()).keepTake({ commandId: 'k', unitId: 'luke1', cardHashes: ['c1', 'c9'], actorId: 't1' });
    expect(fromDraft.map((e) => e.type)).toEqual(['v1.TakeComposed', 'v1.TakeArchived']);
    expect(fromDraft[0]!.payload).toMatchObject({ parentTakeId: 'take2' });
    const after = apply(draft(), fromDraft);
    expect(derivePassage(after, 'luke1').draftTakeId).toBe('take:k');
    expect(after.takes['take2']?.archived).toBe(true);

    const fromSubmitted = commands(submitted()).keepTake({ commandId: 'k2', unitId: 'luke1', cardHashes: ['c9'], actorId: 't1' });
    expect(fromSubmitted.map((e) => e.type)).toEqual(['v1.TakeComposed']);
    expect(fromSubmitted[0]!.payload).toMatchObject({ parentTakeId: 'take2' });

    expect(() => commands(draft()).keepTake({ commandId: 'k3', unitId: 'luke1', cardHashes: [], actorId: 't1' })).toThrow(CommandError);
  });

  it('keepTake never archives a teammate\'s draft', () => {
    // Why: archiving is add-wins. Two translators on one passage must not
    // be able to throw away each other's unpublished work by keeping their own.
    const specs = commands(draft()).keepTake({ commandId: 'mine', unitId: 'luke1', cardHashes: ['c9'], actorId: 't2' });
    expect(specs.map((e) => e.type)).toEqual(['v1.TakeComposed']);
    expect(specs[0]!.payload).toMatchObject({ parentTakeId: null });
    const after = apply(draft(), specs, 't2');
    expect(after.takes['take2']?.archived).toBe(false);
    expect(after.takes['take:mine']?.actorId).toBe('t2');
  });

  it('discardCards leaves an archived take so recovery cannot resurrect the audio', () => {
    const specs = commands(empty()).discardCards({ commandId: 'd', unitId: 'luke1', cardHashes: ['c9'] });
    expect(specs.map((e) => e.type)).toEqual(['v1.TakeComposed', 'v1.TakeArchived']);
    const after = apply(empty(), specs);
    expect(derivePassage(after, 'luke1').drafting).toBe(false);
    expect(after.takes['take:d']?.archived).toBe(true);
    expect(commands(empty()).discardCards({ commandId: 'd', unitId: 'luke1', cardHashes: [] })).toEqual([]);
  });

  it('publishVersion replaces only the publisher\'s draft, and refuses a version that changes nothing', () => {
    const own = commands(draft()).publishVersion({ commandId: 'p', unitId: 'luke1', cardHashes: ['c1', 'c3'], actorId: 't1' });
    expect(own.map((e) => e.type)).toEqual(['v1.TakeComposed', 'v1.TakeArchived', 'v1.TakeSubmitted']);
    const theirs = commands(draft()).publishVersion({ commandId: 'p', unitId: 'luke1', cardHashes: ['c1', 'c3'], actorId: 't2' });
    expect(theirs.map((e) => e.type)).toEqual(['v1.TakeComposed', 'v1.TakeSubmitted']);
    expect(() => commands(submitted()).publishVersion({ commandId: 'same', unitId: 'luke1', cardHashes: ['c1', 'c3'], note: 'x' })).toThrow(/Nothing changed/);
    expect(() => commands(submitted()).publishVersion({ commandId: 'mute', unitId: 'luke1', cardHashes: ['c9'] })).toThrow(/Say what changed/);
  });

  it('recordReview refuses takes that were never published', () => {
    expect(commands(submitted()).recordReview({ commandId: 'r', takeIds: ['take2'], kindId: 'peer', outcome: 'looks_good', via: 'app', answers: { q: 'Yes' } })[0]!.payload)
      .toEqual({ reviewId: 'review:r:0', takeId: 'take2', kindId: 'peer', outcome: 'looks_good', via: 'app', answers: { q: 'Yes' } });
    expect(() => commands(draft()).recordReview({ commandId: 'r', takeIds: ['take2'], kindId: 'peer', outcome: 'looks_good', via: 'app' })).toThrow(CommandError);
    expect(() => commands(draft()).recordReview({ commandId: 'r', takeIds: ['nope'], kindId: 'peer', outcome: 'looks_good', via: 'app' })).toThrow(CommandError);
  });

  it('addRecording is idempotent by recordingId', () => {
    const c = { commandId: 'a', unitId: 'luke1', recordingId: 'rec1', kind: 'target' as const, card };
    expect(commands(draft()).addRecording(c)).toEqual([]);
    expect(commands(draft()).addRecording({ ...c, recordingId: 'recNew' }).map((e) => e.type)).toEqual(['v1.RecordingAdded']);
  });

  it('adjustKeyTermRendering records why, ties it to the take in progress, and links the term once', () => {
    const specs = commands(draft()).adjustKeyTermRendering({ commandId: 'kt', termId: 't', note: '', blobHash: 'c9', duringTakeId: 'take2', tieToTakeId: 'take2' });
    expect(specs.map((e) => e.type)).toEqual(['v1.KeyTermAdjusted', 'v1.KeyTermLinked']);
    expect(specs[0]!.payload).toMatchObject({ termId: 't', adjustmentId: 'adjustment:kt', blobHash: 'c9', duringTakeId: 'take2' });
    const after = apply(draft(), specs);
    expect(commands(after).adjustKeyTermRendering({ commandId: 'kt2', termId: 't', note: 'again', tieToTakeId: 'take2' }).map((e) => e.type)).toEqual(['v1.KeyTermAdjusted']);
    expect(() => commands(draft()).adjustKeyTermRendering({ commandId: 'kt3', termId: 't', note: ' ' })).toThrow(CommandError);
  });

  it('savePassageNote defines the guidelines material once, and keeps an existing blob when only text changes', () => {
    const first = commands(draft()).savePassageNote({ commandId: 'n', unitId: 'luke1', text: ' hi ', card, recordingId: 'rn' });
    expect(first.map((e) => e.type)).toEqual(['v1.MaterialDefined', 'v1.RecordingAdded', 'v1.MaterialFieldSet']);
    expect(first[0]!.payload).toMatchObject({ materialId: TG_MATERIAL_ID, kind: 'tg' });
    expect(first[2]!.payload).toMatchObject({ materialId: TG_MATERIAL_ID, fieldId: 'luke1', text: 'hi', blobHash: 'c9' });
    const after = apply(draft(), first);
    const second = commands(after).savePassageNote({ commandId: 'n2', unitId: 'luke1', text: 'edit', blobHash: 'c9' });
    expect(second.map((e) => e.type)).toEqual(['v1.MaterialFieldSet']);
    expect(second[0]!.payload).toMatchObject({ text: 'edit', blobHash: 'c9' });
  });
});
