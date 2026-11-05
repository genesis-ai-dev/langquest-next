import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { CommandError, commands } from '../src/commands';
import { foldLanguage as fold } from '../src/reducer';
import { emptyLanguageState as emptyState } from '../src/state';
import { canDeleteVersion, derivePassage, recordTimeline } from '../src/passage';
import { flowTemplate, instantiateFlow } from '../src/record';

/**
 * Deleting a published version (LAN-83, Caleb 2026-10-16): a tombstone.
 * A reviewer may hold the version offline and check it a month later, so
 * the version keeps its number and its checks stay on the record to read,
 * but nothing it had or gets counts for the passage any more.
 */

function language() {
  const events: AnyEvent[] = [];
  let wall = 1_700_000_000_000;
  let seq = 0;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T]) => {
    const clock = clocks.get(actorId) ?? new HlcClock(actorId, () => wall);
    clocks.set(actorId, clock);
    wall += 1000;
    seq += 1;
    events.push({ id: `x${seq}`, type, orgId: 'o', streamId: 'din', actorId, deviceId: actorId, hlc: clock.next(), payload } as AnyEvent);
  };
  const state = () => fold(events, emptyState());
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'a' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'a1' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  const passage = () => derivePassage(state(), 'john3');
  const publish = (cards: string[]) => run('akol', (c) => c.publishVersion({ commandId: `v${cards.join('')}`, unitId: 'john3', cardHashes: cards, actorId: 'akol', note: 'Said again.' }));
  return { events, run, state, passage, publish };
}

describe('deleting a published version', () => {
  it('leaves a tombstone: gone from the versions, its number never reused', () => {
    const l = language();
    l.publish(['a1']);
    l.publish(['a1', 'a2']);
    const v2 = l.passage().latest!.takeId;
    l.run('akol', (c) => c.deleteVersion({ commandId: 'del', unitId: 'john3', takeId: v2, actorId: 'akol' }));
    const p = l.passage();
    expect(p.versions.map((v) => v.n)).toEqual([1]);
    expect(p.latest!.n).toBe(1);
    expect(p.deletedVersions.map((v) => [v.n, v.deleted.by])).toEqual([[2, 'akol']]);
    // Why: a reviewer who checked "Version 2" offline must never meet a different Version 2.
    expect(p.nextVersionN).toBe(3);
    l.publish(['b1']);
    expect(l.passage().latest!.n).toBe(3);
  });

  it('keeps a check of a deleted version to read, and counts it for nothing', () => {
    // Why: the reviewer went offline with Version 2, approved it, and came back after it was deleted.
    const l = language();
    l.publish(['a1']);
    l.publish(['a1', 'a2']);
    const v2 = l.passage().latest!.takeId;
    l.run('akol', (c) => c.deleteVersion({ commandId: 'del', unitId: 'john3', takeId: v2, actorId: 'akol' }));
    l.run('ayen', (c) => c.recordReview({ commandId: 'late', takeIds: [v2], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    const p = l.passage();
    expect(p.reviews).toEqual([]);
    expect(p.reviewsOfDeleted.map((r) => [r.by, r.versionN])).toEqual([['ayen', 2]]);
    expect(p.steps.flatMap((s) => s.kinds).find((k) => k.kindId === 'peer')!.state).not.toBe('approved');
    // The record shows the version, its deletion and the late check.
    const types = recordTimeline(l.state(), p).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['deleted', 'review']));
  });

  it('names whoever deleted it first, whatever order the deletes arrive in', () => {
    const l = language();
    l.publish(['a1']);
    const v1 = l.passage().latest!.takeId;
    l.run('akol', (c) => c.deleteVersion({ commandId: 'del1', unitId: 'john3', takeId: v1, actorId: 'akol' }));
    const forward = derivePassage(fold(l.events, emptyState()), 'john3').deletedVersions[0]!.deleted;
    const tail = l.events.at(-1)!;
    const again = { ...tail, id: 'later', hlc: `${tail.hlc}z`, actorId: 'lead' } as AnyEvent;
    const backward = derivePassage(fold([...l.events.slice(0, -1), again, tail], emptyState()), 'john3').deletedVersions[0]!.deleted;
    expect(backward).toEqual(forward);
  });

  it('lets only whoever published a version delete it', () => {
    const l = language();
    l.publish(['a1']);
    const v1 = l.passage().latest!.takeId;
    expect(canDeleteVersion(l.passage(), v1, 'ayen')).toBe(false);
    expect(() => commands(l.state()).deleteVersion({ commandId: 'x', unitId: 'john3', takeId: v1, actorId: 'ayen' })).toThrow(CommandError);
  });
});
