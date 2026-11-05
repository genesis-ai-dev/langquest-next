import { emptyLanguageState, foldLanguage, HlcClock, ORG_STREAM, PERSON_ORG, type AnyEvent, type PassageLine } from '@langquest-next/core';
import { compareFold, pickCanaryLanguages } from '../../../server/foldCanaryModel';

/** A language with two passages, folded from its events. */
function fold() {
  const clock = new HlcClock('d1', (() => { let t = 1000; return () => (t += 1); })());
  const events = [0, 1].map((i, k): AnyEvent => ({
    id: `e${i}`, orgId: 'o', streamId: 'l', type: 'v1.UnitAdded', actorId: 'a', deviceId: 'd1', hlc: clock.next(), serverSeq: k + 1,
    payload: { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a000${i}` }
  } as AnyEvent));
  return foldLanguage(events, emptyLanguageState());
}
const who = { orgId: 'o', streamId: 'l' };
const line = (unitId: string) => ({ unitId, takes: 0 }) as unknown as PassageLine;

describe('compareFold (the fold canary)', () => {
  it('passes a stored snapshot and lines equal to the fresh fold, whatever the key order or applied ids', () => {
    const fresh = fold();
    const stored = JSON.parse(JSON.stringify(fresh));
    stored.appliedEventIds = { e0: true };
    const lines = new Map<string, unknown>([['u0', { takes: 0, unitId: 'u0' }], ['u1', { unitId: 'u1', takes: 0 }]]);
    expect(compareFold(who, stored, fresh, lines, [line('u0'), line('u1')])).toEqual({ ...who, stateMatches: true, linesDiffering: 0, ok: true });
    expect(compareFold(who, stored, fresh, null, [])).toMatchObject({ linesDiffering: null, ok: true });
  });

  it('names a language whose stored snapshot was tampered with', () => {
    const fresh = fold();
    const stored = JSON.parse(JSON.stringify(fresh));
    Object.values<{ label: string }>(stored.units)[0]!.label = 'Changed';
    expect(compareFold(who, stored, fresh, null, [])).toEqual({ ...who, stateMatches: false, linesDiffering: null, ok: false });
  });

  it('counts the passages whose line differs or is on one side only', () => {
    const fresh = fold();
    const lines = new Map<string, unknown>([['u0', { unitId: 'u0', takes: 9 }], ['gone', { unitId: 'gone' }]]);
    expect(compareFold(who, fresh, fresh, lines, [line('u0'), line('u1')])).toMatchObject({ stateMatches: true, linesDiffering: 3, ok: false });
  });
});

describe('pickCanaryLanguages', () => {
  const streams = [
    { orgId: 'o', streamId: ORG_STREAM, events: 99 }, { orgId: PERSON_ORG, streamId: 'p', events: 99 },
    ...['a', 'b', 'c', 'd', 'e'].map((streamId, i) => ({ orgId: 'o', streamId, events: (i + 1) * 10 })),
    { orgId: 'o', streamId: 'empty', events: 0 }
  ];

  it('takes three languages, never the organization, person or empty streams', () => {
    const picked = pickCanaryLanguages(streams, { sunday: false, random: () => 0.5 });
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((s) => s.streamId)).size).toBe(3);
    for (const s of picked) expect(['a', 'b', 'c', 'd', 'e']).toContain(s.streamId);
  });

  it('adds the largest on Sundays, once', () => {
    const picked = pickCanaryLanguages(streams, { sunday: true, random: () => 0 });
    expect(picked.map((s) => s.streamId)).toContain('e');
    expect(new Set(picked.map((s) => s.streamId)).size).toBe(picked.length);
    expect(pickCanaryLanguages(streams.slice(0, 3), { sunday: true })).toHaveLength(1);
  });
});
