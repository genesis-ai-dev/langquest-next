import { emptyState, fold, type AnyEvent, type EventPayloads, type EventType } from '@langquest-next/core';
import { handoffState, passageProgress } from '../src/passageFlow';

function history() {
  const events: AnyEvent[] = [];
  const add = <T extends EventType>(type: T, payload: EventPayloads[T]) => {
    events.push({ type, payload, id: `event-${events.length}`, actorId: 'me',
      orgId: 'org', partitionId: 'partition', deviceId: 'device',
      hlc: `${String(events.length + 1).padStart(15, '0')}:000000:device`
    } as AnyEvent);
  };
  add('v1.PartitionCreated', { name: 'Test', sourceLanguoidId: 'eng' });
  add('v1.MemberAdded', { profileId: 'me', role: 'translator' });
  add('v1.LaneAdded', { laneId: 'lane', languoidId: 'target' });
  add('v1.UnitAdded', { unitId: 'passage', parentUnitId: null, kind: 'passage', label: '1:1', order: 'a' });
  return { add, state: () => fold(events, emptyState()) };
}

describe('passage next action', () => {
  it('guides reference, missing terms, recording, then hand-off from events', () => {
    const h = history();
    h.add('v1.KeyTermDefined', { termId: 'term', laneId: 'lane', term: 'word', gloss: '', unitScope: [] });
    expect(passageProgress(h.state(), 'lane', 'passage', true).next).toBe('reference');
    expect(passageProgress(h.state(), 'lane', 'passage', false).next).toBe('terms');
    h.add('v1.KeyTermAdjusted', { termId: 'term', adjustmentId: 'audio', note: '', blobHash: 'term-audio' });
    expect(passageProgress(h.state(), 'lane', 'passage', false).next).toBe('record');
    h.add('v1.TakeComposed', { takeId: 'take', laneId: 'lane', unitId: 'passage', parentTakeId: null, cardHashes: ['audio'] });
    expect(passageProgress(h.state(), 'lane', 'passage', false).next).toBe('submit');
    h.add('v1.TakeSubmitted', { takeId: 'take' });
    expect(passageProgress(h.state(), 'lane', 'passage', false).next).toBe('done');
  });

  it('credits partition glossary audio, but only relevant missing terms block guidance', () => {
    const h = history();
    h.add('v1.KeyTermDefined', { termId: 'other', laneId: 'lane', term: 'other', gloss: '', unitScope: ['another-passage'] });
    h.add('v1.KeyTermAdjusted', { termId: 'other', adjustmentId: 'audio', note: '', blobHash: 'other-audio' });
    h.add('v1.KeyTermDefined', { termId: 'wrong-language', laneId: 'different', term: 'word', gloss: '', unitScope: [] });
    const progress = passageProgress(h.state(), 'lane', 'passage', false);
    expect(progress.recordedTerms).toBe(1);
    expect(progress.totalTerms).toBe(1);
    expect(progress.remainingTerms).toHaveLength(0);
    expect(progress.next).toBe('record');
  });

  it('never enables hand-off for an empty take', () => {
    const h = history();
    h.add('v1.TakeComposed', { takeId: 'empty', laneId: 'lane', unitId: 'passage', parentTakeId: null, cardHashes: [] });
    expect(passageProgress(h.state(), 'lane', 'passage', false).canSubmit).toBe(false);
    expect(passageProgress(h.state(), 'lane', 'passage', false).next).toBe('record');
  });

  it('uses the newly selected draft even when an earlier take is approved', () => {
    const h = history();
    h.add('v1.PartitionConfigChanged', { config: { unitKinds: [], workflow: [] } });
    h.add('v1.TakeComposed', { takeId: 'approved', laneId: 'lane', unitId: 'passage', parentTakeId: null, cardHashes: ['old'] });
    h.add('v1.TakeSubmitted', { takeId: 'approved' });
    h.add('v1.TakeComposed', { takeId: 'draft', laneId: 'lane', unitId: 'passage', parentTakeId: 'approved', cardHashes: ['new'] });
    h.add('v1.TakeSelected', { takeId: 'draft', laneId: 'lane', unitId: 'passage' });
    expect(passageProgress(h.state(), 'lane', 'passage', false).next).toBe('submit');
  });
});

describe('honest hand-off feedback', () => {
  const sent = { pending: 0, online: true, refused: null, tooOld: false, audioStored: true };
  it('requires acknowledged events and audio before showing sent', () => {
    expect(handoffState(sent)).toBe('sent');
    expect(handoffState({ ...sent, pending: 1 })).toBe('queued');
    expect(handoffState({ ...sent, audioStored: false })).toBe('queued');
    expect(handoffState({ ...sent, online: null })).toBe('queued');
    expect(handoffState({ ...sent, online: false })).toBe('queued');
  });
  it('distinguishes refusal and upgrade requirements from offline queues', () => {
    expect(handoffState({ ...sent, refused: 'membership removed' })).toBe('blocked');
    expect(handoffState({ ...sent, tooOld: true })).toBe('blocked');
  });
});
