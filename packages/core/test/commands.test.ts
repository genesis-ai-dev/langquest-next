import { CommandError, commands } from '../src/commands';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { currentTake, deriveTakeStatus } from '../src/workflow';
import { buildFixture } from './fixtures';
import type { AnyEvent } from '../src/events';

/**
 * Why: a command is the one definition of what a user action means. If
 * "keep" stopped archiving the replaced draft, or "submit" accepted an
 * already-submitted take, the workflow would silently disagree with the UX
 * spec. These tests pin each command to the events that implement it, and
 * to the state it refuses.
 */
describe('commands', () => {
  const events = buildFixture().filter((e) => e.parentEventId === undefined);
  // The reducer folds in place, so every test starts from its own fold.
  const submitted = () => fold(events, emptyState());
  const draft = () => fold(events.filter((e) => e.type !== 'v1.TakeSubmitted' && e.type !== 'v1.ReviewSubmitted'), emptyState());
  const empty = () => fold(events.filter((e) => !e.type.startsWith('v1.Take')), emptyState());
  const card = { hash: 'c9', durationMs: 100 };

  /** Apply command output as t1's events so a command can be checked against the fold it produces. */
  function apply(state: ReturnType<typeof draft>, specs: ReturnType<typeof commands>['keepTake'] extends (...a: never[]) => infer R ? R : never) {
    let s = state;
    for (const [i, spec] of specs.entries()) {
      s = fold([{ ...spec, orgId: 'o', projectId: 'p', actorId: 't1', deviceId: 'dB', hlc: `${900000000000000 + i}:000000:dB` } as AnyEvent], s);
    }
    return s;
  }

  it('event ids are stable per command, so a retried command is absorbed by idempotency', () => {
    const d = draft();
    const a = commands(d).keepTake({ commandId: 'cmd1', unitId: 'luke1', laneId: 'L1', cardHashes: ['c1'] });
    const b = commands(d).keepTake({ commandId: 'cmd1', unitId: 'luke1', laneId: 'L1', cardHashes: ['c1'] });
    expect(a).toEqual(b);
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
    expect(apply(apply(d, a), b).invalidEvents).toEqual(draft().invalidEvents);
    expect(currentTake(apply(apply(draft(), a), b), 'luke1', 'L1')).toBe('take:cmd1');
  });

  it('keepTake composes, selects, and archives the draft it replaces; a submitted take is kept as parent', () => {
    const fromDraft = commands(draft()).keepTake({ commandId: 'k', unitId: 'luke1', laneId: 'L1', cardHashes: ['c1', 'c9'] });
    expect(fromDraft.map((e) => e.type)).toEqual(['v1.TakeComposed', 'v1.TakeSelected', 'v1.TakeArchived']);
    const after = apply(draft(), fromDraft);
    expect(currentTake(after, 'luke1', 'L1')).toBe('take:k');
    expect(after.takes['take2']?.archived).toBe(true);

    const fromSubmitted = commands(submitted()).keepTake({ commandId: 'k2', unitId: 'luke1', laneId: 'L1', cardHashes: ['c9'] });
    expect(fromSubmitted.map((e) => e.type)).toEqual(['v1.TakeComposed', 'v1.TakeSelected']);
    expect(fromSubmitted[0]!.payload).toMatchObject({ parentTakeId: 'take2' });

    expect(() => commands(draft()).keepTake({ commandId: 'k3', unitId: 'luke1', laneId: 'L1', cardHashes: [] })).toThrow(CommandError);
  });

  it('discardCards leaves an archived take so recovery cannot resurrect the audio', () => {
    const specs = commands(empty()).discardCards({ commandId: 'd', unitId: 'luke1', laneId: 'L1', cardHashes: ['c9'] });
    expect(specs.map((e) => e.type)).toEqual(['v1.TakeComposed', 'v1.TakeArchived']);
    const after = apply(empty(), specs);
    expect(currentTake(after, 'luke1', 'L1')).toBeNull();
    expect(commands(empty()).discardCards({ commandId: 'd', unitId: 'luke1', laneId: 'L1', cardHashes: [] })).toEqual([]);
  });

  it('submitTake hands off a draft only, with a response note only when responding to a submitted take', () => {
    const specs = commands(draft()).submitTake({ commandId: 's', unitId: 'luke1', laneId: 'L1', questionSetIds: ['q1'], responseNote: '  fixed ' });
    // take2's parent take1 was never submitted, so no ResponseRecorded.
    expect(specs.map((e) => e.type)).toEqual(['v1.TakeSubmitted']);
    expect(deriveTakeStatus(apply(draft(), specs), 'take2').submitted).toBe(true);
    expect(() => commands(submitted()).submitTake({ commandId: 's2', unitId: 'luke1', laneId: 'L1', questionSetIds: [] })).toThrow('already handed off');
    expect(() => commands(empty()).submitTake({ commandId: 's3', unitId: 'luke1', laneId: 'L1', questionSetIds: [] })).toThrow('Record a take');

    // A response to a submitted take carries the note.
    const responded = apply(submitted(), commands(submitted()).keepTake({ commandId: 'k', unitId: 'luke1', laneId: 'L1', cardHashes: ['c9'] }));
    const resp = commands(responded).submitTake({ commandId: 's4', unitId: 'luke1', laneId: 'L1', questionSetIds: [], responseNote: 'done' });
    expect(resp.map((e) => e.type)).toEqual(['v1.ResponseRecorded', 'v1.TakeSubmitted']);
    expect(resp[0]!.payload).toMatchObject({ takeId: 'take:k', respondsToTakeId: 'take2', note: 'done' });

    // Why: on an oral screen "what changed" may be said, not typed. A voice
    // answer alone is still an answer to the feedback, so it is recorded.
    const voiced = commands(responded).submitTake({ commandId: 's5', unitId: 'luke1', laneId: 'L1', questionSetIds: [], responseBlobHash: 'v1' });
    expect(voiced[0]!.payload).toEqual({ takeId: 'take:k', respondsToTakeId: 'take2', blobHash: 'v1' });
    const silent = commands(responded).submitTake({ commandId: 's6', unitId: 'luke1', laneId: 'L1', questionSetIds: [], responseNote: '  ' });
    expect(silent.map((e) => e.type)).toEqual(['v1.TakeSubmitted']);

    // Why: a translator may keep twice while revising (record, keep, record
    // another part, keep). The response still answers the submitted version,
    // not the intermediate draft that the second keep archived.
    const twice = fold(commands(responded).keepTake({ commandId: 'k2', unitId: 'luke1', laneId: 'L1', cardHashes: ['c9', 'c10'] })
      .map((spec, i) => ({ ...spec, orgId: 'o', projectId: 'p', actorId: 't1', deviceId: 'dB', hlc: `${910000000000000 + i}:000000:dB` } as AnyEvent)), responded);
    const answer = commands(twice).submitTake({ commandId: 's7', unitId: 'luke1', laneId: 'L1', questionSetIds: [], responseNote: 'fixed v.3' });
    expect(answer[0]!.payload).toMatchObject({ takeId: 'take:k2', respondsToTakeId: 'take2', note: 'fixed v.3' });
  });

  it('reviewTake refuses takes that were never handed off', () => {
    expect(commands(submitted()).reviewTake({ commandId: 'r', takeId: 'take2', stepId: 'peer', decision: 'approve', answers: { q: 'Yes' } })[0]!.payload)
      .toEqual({ takeId: 'take2', stepId: 'peer', decision: 'approve', answers: { q: 'Yes' } });
    expect(() => commands(draft()).reviewTake({ commandId: 'r', takeId: 'take2', stepId: 'peer', decision: 'approve' })).toThrow(CommandError);
    expect(() => commands(draft()).reviewTake({ commandId: 'r', takeId: 'nope', stepId: 'peer', decision: 'approve' })).toThrow(CommandError);
  });

  it('addRecording is idempotent by recordingId', () => {
    const c = { commandId: 'a', unitId: 'luke1', laneId: 'L1', recordingId: 'rec1', kind: 'target' as const, card };
    expect(commands(draft()).addRecording(c)).toEqual([]);
    expect(commands(draft()).addRecording({ ...c, recordingId: 'recNew' }).map((e) => e.type)).toEqual(['v1.RecordingAdded']);
  });

  it('adjustKeyTerm saves the card and links it to the take in progress', () => {
    const specs = commands(draft()).adjustKeyTerm({ commandId: 'kt', unitId: 'luke1', laneId: 'L1', termId: 't', recordingId: 'rk', adjustmentId: 'adj', card });
    expect(specs.map((e) => e.type)).toEqual(['v1.RecordingAdded', 'v1.KeyTermAdjusted']);
    expect(specs[1]!.payload).toMatchObject({ termId: 't', adjustmentId: 'adj', blobHash: 'c9', duringTakeId: 'take2' });
  });

  it('savePassageNote defines the guidelines material once, and keeps an existing blob when only text changes', () => {
    const first = commands(draft()).savePassageNote({ commandId: 'n', materialId: 'tg-L1', laneId: 'L1', unitId: 'luke1', text: ' hi ', card, recordingId: 'rn' });
    expect(first.map((e) => e.type)).toEqual(['v1.MaterialDefined', 'v1.RecordingAdded', 'v1.MaterialFieldSet']);
    expect(first[2]!.payload).toMatchObject({ text: 'hi', blobHash: 'c9' });
    const after = apply(draft(), first);
    const second = commands(after).savePassageNote({ commandId: 'n2', materialId: 'tg-L1', laneId: 'L1', unitId: 'luke1', text: 'edit', blobHash: 'c9' });
    expect(second.map((e) => e.type)).toEqual(['v1.MaterialFieldSet']);
    expect(second[0]!.payload).toMatchObject({ text: 'edit', blobHash: 'c9' });
  });
});
