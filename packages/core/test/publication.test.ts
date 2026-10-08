import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { derivePassage, publicationOf } from '../src/passage';
import { foldLanguage } from '../src/reducer';
import { PUBLICATION_KIND } from '../src/record';

/**
 * Ready for publication (decisions.md 70) is a partner's decision about one
 * approved version. It must never outlive that version or the approval: a
 * listening app publishing whatever was once marked would ship audio nobody
 * approved.
 */

function passage(...extra: [EventType, unknown, number?][]) {
  let n = 0;
  const ev = <T extends EventType>(type: T, payload: EventPayloads[T], at?: number): AnyEvent => {
    n += 1;
    return { id: `e${n}`, type, orgId: 'o', streamId: 'L', actorId: 'p', deviceId: 'd', hlc: encodeHlc(at ?? 1_700_000_000_000 + n * 1000, 0, 'd'), payload } as AnyEvent;
  };
  const events = [
    ev('v1.FlowSelected', { flowId: 'f', name: 'F' }),
    ev('v1.FlowStepSet', { stepId: 'f/s1', order: 's00', kindIds: ['peer'], checkpoint: false }),
    ev('v1.UnitAdded', { unitId: 'u', parentUnitId: null, kind: 'passage', label: 'U', order: 'a' }),
    ev('v1.TakeComposed', { takeId: 't1', unitId: 'u', cardHashes: ['a'.repeat(64)], parentTakeId: null }),
    ev('v1.TakeSubmitted', { takeId: 't1' }),
    ev('v1.ReviewRecorded', { reviewId: 'peer1', takeId: 't1', kindId: 'peer', outcome: 'looks_good', via: 'app' }),
    ...extra.map(([type, payload, at]) => ev(type, payload as never, at))
  ];
  return derivePassage(foldLanguage(events), 'u');
}

const mark = (reviewId: string, takeId: string, outcome: 'looks_good' | 'needs_changes', comment?: string) =>
  ['v1.ReviewRecorded', { reviewId, takeId, kindId: PUBLICATION_KIND, outcome, via: 'link', ...(comment ? { comment } : {}) }] as [EventType, unknown];

describe('publicationOf', () => {
  it('is null until someone decides', () => {
    expect(publicationOf(passage())).toBeNull();
  });

  it('follows the latest decision, whatever order the events arrive in', () => {
    const later = 1_800_000_000_000;
    const s = passage([...mark('p2', 't1', 'needs_changes', 'Wrong name in verse 2'), later], [...mark('p1', 't1', 'looks_good'), later - 1]);
    expect(publicationOf(s)).toMatchObject({ ready: false, note: 'Wrong name in verse 2', versionN: 1 });
    expect(publicationOf(passage(mark('p1', 't1', 'looks_good')))).toMatchObject({ ready: true, takeId: 't1' });
  });

  it('does not carry over to a new version', () => {
    const s = passage(
      mark('p1', 't1', 'looks_good'),
      ['v1.TakeComposed', { takeId: 't2', unitId: 'u', cardHashes: ['b'.repeat(64)], parentTakeId: 't1' }],
      ['v1.TakeSubmitted', { takeId: 't2' }]
    );
    expect(s.latest?.takeId).toBe('t2');
    expect(publicationOf(s)).toBeNull();
  });

  it('is never ready on a passage that is not approved', () => {
    const s = passage(['v1.ReviewRecorded', { reviewId: 'peer2', takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app' }], mark('p1', 't1', 'looks_good'));
    expect(s.done).toBe(false);
    expect(publicationOf(s)?.ready).toBe(false);
  });
});
