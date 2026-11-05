// A language stream built event by event, for the config screens' models
// (rolesModel, keyTermsModel, flowsModel, materialModel tests).
import {
  foldLanguage, HlcClock, type AnyEvent, type EventPayloads, type EventSpec, type EventType
} from '@langquest-next/core';

/** One language's stream, with a book and a passage. */
export function language() {
  const log: AnyEvent[] = [];
  let wall = 1_700_000_000_000;
  let seq = 0;
  const clock = new HlcClock('d', () => wall);
  const add = <T extends EventType>(type: T, payload: EventPayloads[T], id = `e${++seq}`, actorId = 'admin') => {
    wall += 1000;
    log.push({ id, type, orgId: 'o', streamId: 'L1', actorId, deviceId: 'd', hlc: clock.next(), payload, serverSeq: log.length + 1 } as AnyEvent);
  };
  add('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' });
  add('v1.UnitAdded', { unitId: 'luke15', parentUnitId: 'luke', kind: 'passage', label: 'Luke 15:11-32', order: 'a' });
  const run = (specs: EventSpec[]) => { for (const s of specs) add(s.type, s.payload as never, s.id); };
  return { add, run, state: () => foldLanguage(log) };
}
