import { describe, expect, it } from 'vitest';
import { filesNamedBy } from '../src/nearbyFilesNamed';

/**
 * What names a file, for a viewer's upload by naming an event (docs/nearby-sync-plan.md
 * section 6, Files). Why: the server frees a file from phones once it holds it under a
 * name, so only an event that makes the reference, under exactly that name, may let
 * someone who only views upload it. SQL `_event_files` is held to this by the parity script.
 */
describe('filesNamedBy', () => {
  const h = (c: string) => c.repeat(64);

  it('names a recording\'s cards and a review\'s artifacts with their format, wav unless said', () => {
    expect(filesNamedBy({ type: 'v1.RecordingAdded', payload: { recordingId: 'r', unitId: 'u', kind: 'target', cards: [{ hash: h('a'), durationMs: 1 }, { hash: h('b'), durationMs: 1, format: 'm4a' }] } }))
      .toEqual([{ hash: h('a'), format: 'wav' }, { hash: h('b'), format: 'm4a' }]);
    expect(filesNamedBy({ type: 'v1.ReviewRecorded', payload: { reviewId: 'r', takeId: 't', kindId: 'k', outcome: 'recorded', via: 'app', commentBlobHash: h('c'), artifacts: [{ hash: h('d'), durationMs: 1 }] } }))
      .toEqual([{ hash: h('d'), format: 'wav' }, { hash: h('c') }]);
  });

  it('names Clean up\'s cleaned file only with its format, and a voice note with no format', () => {
    expect(filesNamedBy({ type: 'v1.CardCleanUpSet', payload: { unitId: 'u', hash: h('a'), use: 'cleaned', cleanedHash: h('e'), cleanedFormat: 'm4a' } })).toEqual([{ hash: h('e'), format: 'm4a' }]);
    expect(filesNamedBy({ type: 'v1.CardCleanUpSet', payload: { unitId: 'u', hash: h('a'), use: 'cleaned', cleanedHash: h('e') } })).toEqual([]);
    expect(filesNamedBy({ type: 'v1.NoteAdded', payload: { noteId: 'n', unitId: 'u', anchor: { kind: 'passage' }, blobHash: h('f') } })).toEqual([{ hash: h('f') }]);
    expect(filesNamedBy({ type: 'v1.NoteAdded', payload: { noteId: 'n', unitId: 'u', anchor: { kind: 'passage' }, blobHash: '' } })).toEqual([]);
  });

  it('names nothing for a take, a verse mark or free text', () => {
    expect(filesNamedBy({ type: 'v1.TakeComposed', payload: { takeId: 't', unitId: 'u', cardHashes: [h('a')], parentTakeId: null } })).toEqual([]);
    expect(filesNamedBy({ type: 'v1.CardVerseSet', payload: { unitId: 'u', hash: h('a'), mark: 'next' } })).toEqual([]);
    expect(filesNamedBy({ type: 'v1.NoteAdded', payload: { noteId: 'n', unitId: 'u', anchor: { kind: 'passage' }, text: h('a') } })).toEqual([]);
  });
});
