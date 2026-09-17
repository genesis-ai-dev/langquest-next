import { emptyState, fold, type AnyEvent, type EventPayloads, type EventType } from '@langquest-next/core';
import { pendingPassageCards } from '../src/recordingFlow';

function history() {
  const events: AnyEvent[] = [];
  const add = <T extends EventType>(type: T, payload: EventPayloads[T], actorId = 'me') => {
    events.push({ type, payload, id: `event-${events.length}`, actorId,
      orgId: 'org', projectId: 'project', deviceId: 'device',
      hlc: `${String(events.length + 1).padStart(15, '0')}:000000:device`
    } as AnyEvent);
  };
  add('v1.ProjectCreated', { name: 'Test', sourceLanguoidId: 'eng' });
  add('v1.LaneAdded', { laneId: 'lane', languoidId: 'target' });
  add('v1.UnitAdded', { unitId: 'passage', parentUnitId: null, kind: 'passage', label: '1:1', order: 'a' });
  return { add, state: () => fold(events, emptyState()) };
}

describe('pendingPassageCards', () => {
  it('recovers successive parts in recording order and composes one take', () => {
    const h = history();
    for (const id of ['part-1', 'part-2', 'part-3']) {
      h.add('v1.RecordingAdded', { recordingId: id, unitId: 'passage',
        laneId: 'lane', kind: 'target',
        cards: [{ hash: id, durationMs: 800 }] });
    }
    const hashes = pendingPassageCards(h.state(), 'passage', 'lane', 'me')
      .map((card) => card.hash);
    expect(hashes).toEqual(['part-1', 'part-2', 'part-3']);
    h.add('v1.TakeComposed', { takeId: 'complete', unitId: 'passage',
      laneId: 'lane', parentTakeId: null, cardHashes: hashes });
    expect(h.state().takes.complete?.cardHashes).toEqual(hashes);
    expect(pendingPassageCards(h.state(), 'passage', 'lane', 'me'))
      .toEqual([]);
  });
  it('recovers only uncomposed target cards for this passage, lane, and actor', () => {
    const h = history();
    h.add('v1.RecordingAdded', { recordingId: 'own', unitId: 'passage', laneId: 'lane', kind: 'target', cards: [
      { hash: 'keep', durationMs: 500 }, { hash: 'composed', durationMs: 500 }
    ] });
    h.add('v1.RecordingAdded', { recordingId: 'source', unitId: 'passage', laneId: 'lane', kind: 'source', cards: [{ hash: 'source', durationMs: 500 }] });
    h.add('v1.RecordingAdded', { recordingId: 'wrong-lane', unitId: 'passage', laneId: 'other', kind: 'target', cards: [{ hash: 'wrong-lane', durationMs: 500 }] });
    h.add('v1.RecordingAdded', { recordingId: 'wrong-actor', unitId: 'passage', laneId: 'lane', kind: 'target', cards: [{ hash: 'wrong-actor', durationMs: 500 }] }, 'them');
    h.add('v1.TakeComposed', { takeId: 'take', unitId: 'passage', laneId: 'lane', parentTakeId: null, cardHashes: ['composed'] });
    expect(pendingPassageCards(h.state(), 'passage', 'lane', 'me').map((c) => c.hash)).toEqual(['keep']);
  });

  it('excludes cards in archived or discarded takes as already consumed', () => {
    const h = history();
    h.add('v1.RecordingAdded', { recordingId: 'archived', unitId: 'passage', laneId: 'lane', kind: 'target', cards: [{ hash: 'archived-card', durationMs: 500 }] });
    h.add('v1.TakeComposed', { takeId: 'archived-take', unitId: 'passage', laneId: 'lane', parentTakeId: null, cardHashes: ['archived-card'] });
    h.add('v1.TakeArchived', { takeId: 'archived-take' });
    h.add('v1.RecordingAdded', { recordingId: 'discarded', unitId: 'passage', laneId: 'lane', kind: 'target', cards: [{ hash: 'discarded-card', durationMs: 500 }] });
    h.add('v1.TakeComposed', { takeId: 'discarded-take', unitId: 'passage', laneId: 'lane', parentTakeId: null, cardHashes: ['discarded-card'] });
    expect(pendingPassageCards(h.state(), 'passage', 'lane', 'me')).toEqual([]);
  });
});
