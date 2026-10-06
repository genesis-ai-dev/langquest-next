import { emptyLanguageState, foldLanguage, type AnyEvent, type EventPayloads, type EventType } from '@langquest-next/core';
import { pendingPassageCards } from '../src/recordingFlow';

function history() {
  const events: AnyEvent[] = [];
  const add = <T extends EventType>(type: T, payload: EventPayloads[T], actorId = 'me') => {
    events.push({ type, payload, id: `event-${events.length}`, actorId,
      orgId: 'org', streamId: 'lang', deviceId: 'device',
      hlc: `${String(events.length + 1).padStart(15, '0')}:000000:device`
    } as AnyEvent);
  };
  add('v1.UnitAdded', { unitId: 'passage', parentUnitId: null, kind: 'passage', label: '1:1', order: 'a' });
  add('v1.UnitAdded', { unitId: 'other', parentUnitId: null, kind: 'passage', label: '1:2', order: 'b' });
  return { add, state: () => foldLanguage(events, emptyLanguageState()) };
}

describe('pendingPassageCards', () => {
  it('recovers successive parts in recording order and composes one take', () => {
    const h = history();
    for (const id of ['part-1', 'part-2', 'part-3']) {
      h.add('v1.RecordingAdded', { recordingId: id, unitId: 'passage', kind: 'target',
        cards: [{ hash: id, durationMs: 800 }] });
    }
    const hashes = pendingPassageCards(h.state(), 'passage', 'me')
      .map((card) => card.hash);
    expect(hashes).toEqual(['part-1', 'part-2', 'part-3']);
    h.add('v1.TakeComposed', { takeId: 'complete', unitId: 'passage', parentTakeId: null, cardHashes: hashes });
    expect(h.state().takes.complete?.cardHashes).toEqual(hashes);
    expect(pendingPassageCards(h.state(), 'passage', 'me'))
      .toEqual([]);
  });
  it('recovers only uncomposed target cards for this passage and actor', () => {
    const h = history();
    h.add('v1.RecordingAdded', { recordingId: 'own', unitId: 'passage', kind: 'target', cards: [
      { hash: 'keep', durationMs: 500 }, { hash: 'composed', durationMs: 500 }
    ] });
    h.add('v1.RecordingAdded', { recordingId: 'source', unitId: 'passage', kind: 'source', cards: [{ hash: 'source', durationMs: 500 }] });
    h.add('v1.RecordingAdded', { recordingId: 'wrong-passage', unitId: 'other', kind: 'target', cards: [{ hash: 'wrong-passage', durationMs: 500 }] });
    h.add('v1.RecordingAdded', { recordingId: 'wrong-actor', unitId: 'passage', kind: 'target', cards: [{ hash: 'wrong-actor', durationMs: 500 }] }, 'them');
    h.add('v1.TakeComposed', { takeId: 'take', unitId: 'passage', parentTakeId: null, cardHashes: ['composed'] });
    expect(pendingPassageCards(h.state(), 'passage', 'me').map((c) => c.hash)).toEqual(['keep']);
  });

  it('excludes cards in archived or discarded takes as already consumed', () => {
    const h = history();
    h.add('v1.RecordingAdded', { recordingId: 'archived', unitId: 'passage', kind: 'target', cards: [{ hash: 'archived-card', durationMs: 500 }] });
    h.add('v1.TakeComposed', { takeId: 'archived-take', unitId: 'passage', parentTakeId: null, cardHashes: ['archived-card'] });
    h.add('v1.TakeArchived', { takeId: 'archived-take' });
    h.add('v1.RecordingAdded', { recordingId: 'discarded', unitId: 'passage', kind: 'target', cards: [{ hash: 'discarded-card', durationMs: 500 }] });
    h.add('v1.TakeComposed', { takeId: 'discarded-take', unitId: 'passage', parentTakeId: null, cardHashes: ['discarded-card'] });
    expect(pendingPassageCards(h.state(), 'passage', 'me')).toEqual([]);
  });
});
