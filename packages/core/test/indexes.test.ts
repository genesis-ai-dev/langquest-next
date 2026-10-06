import { encodeHlc } from '../src/hlc';
import { buildIndexes } from '../src/indexes';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { derivePieces, deriveBooks } from '../src/status';
import { deriveProgress, deriveTasks } from '../src/tasks';
import { currentTake, deriveTakeStatus, eligibleReviewers, takesFor } from '../src/workflow';
import type { AnyEvent } from '../src/events';
import { buildFixture } from './fixtures';

/**
 * A larger, messier partition than the fixture: several lanes, assignments
 * that override role membership, archived and superseded takes, removed
 * members. Deterministic so the two derivation paths can be compared.
 */
function bigPartition(): AnyEvent[] {
  const out: AnyEvent[] = [];
  let seq = 0;
  const emit = (type: string, payload: unknown, actorId = 'lead', deviceId = 'dA') => {
    seq += 1;
    out.push({
      id: `e${seq}`, type, orgId: 'o', partitionId: 'p', actorId, deviceId,
      hlc: encodeHlc(1_700_000_000_000 + seq, 0, deviceId), payload, serverSeq: seq
    } as AnyEvent);
  };
  emit('v1.PartitionCreated', { name: 'B', sourceLanguoidId: 'eng' });
  emit('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
  for (let i = 0; i < 5; i++) emit('v1.MemberAdded', { profileId: `t${i}`, role: 'translator' });
  for (let i = 0; i < 3; i++) emit('v1.MemberAdded', { profileId: `r${i}`, role: 'reviewer' });
  emit('v1.MemberRemoved', { profileId: 't4' });
  emit('v1.MemberRemoved', { profileId: 'r2' });
  for (let l = 0; l < 2; l++) emit('v1.LaneAdded', { laneId: `L${l}`, languoidId: `x${l}` });
  for (let b = 0; b < 3; b++) emit('v1.UnitAdded', { unitId: `b${b}`, parentUnitId: null, kind: 'book', label: `B${b}`, order: `a${b}` });
  const U = 24;
  for (let u = 0; u < U; u++) emit('v1.UnitAdded', { unitId: `u${u}`, parentUnitId: `b${u % 3}`, kind: 'passage', label: `P${u}`, order: `a${String(u).padStart(3, '0')}` });
  for (let l = 0; l < 2; l++) {
    for (let u = 0; u < U; u++) {
      const who = `t${u % 5}`;
      if (u % 3 !== 2) emit('v1.AssignmentMade', { unitId: `u${u}`, laneId: `L${l}`, profileId: who, role: 'translator' });
      if (u % 4 === 0) emit('v1.AssignmentMade', { unitId: `u${u}`, laneId: `L${l}`, profileId: `r${u % 3}`, role: 'reviewer' });
      if (u % 5 === 4) continue; // nothing recorded
      const t = `t${l}-${u}`;
      emit('v1.RecordingAdded', { recordingId: `r${t}`, unitId: `u${u}`, laneId: `L${l}`, kind: 'target', cards: [{ hash: `h${t}`, durationMs: 1000 }] }, who, 'dB');
      emit('v1.TakeComposed', { takeId: t, unitId: `u${u}`, laneId: `L${l}`, cardHashes: [`h${t}`], parentTakeId: null }, who, 'dB');
      if (u % 2 === 0) emit('v1.TakeSubmitted', { takeId: t }, who, 'dB');
      if (u % 6 === 0) emit('v1.ReviewSubmitted', { takeId: t, stepId: 'community', decision: 'approve' }, 'r0', 'dC');
      if (u % 7 === 0) emit('v1.ReviewSubmitted', { takeId: t, stepId: 'community', decision: 'suggest_changes' }, 'r1', 'dC');
      if (u % 8 === 0) {
        emit('v1.TakeComposed', { takeId: `${t}b`, unitId: `u${u}`, laneId: `L${l}`, cardHashes: [`h${t}`], parentTakeId: t }, who, 'dB');
        emit('v1.TakeArchived', { takeId: t }, who, 'dB');
      }
      if (u % 9 === 0) emit('v1.TakeSelected', { unitId: `u${u}`, laneId: `L${l}`, takeId: t });
    }
  }
  return out;
}

describe('read indexes', () => {
  const cases = { fixture: buildFixture(), big: bigPartition() };

  for (const [name, events] of Object.entries(cases)) {
    it(`${name}: every derivation gives the same answer with a prebuilt index as with none`, () => {
      // Why: the index is a pure view of the fold. If a derivation ever
      // read something the index does not carry, the two paths would
      // diverge and the status screen would disagree with My Work.
      const state = fold(events, emptyState());
      const idx = buildIndexes(state);
      const workflow = (state.config?.value ?? { workflow: [] }).workflow;

      for (const actorId of Object.keys(state.members)) {
        expect(deriveTasks(state, actorId, idx)).toEqual(deriveTasks(state, actorId));
      }
      for (const laneId of Object.keys(state.lanes)) {
        expect(derivePieces(state, laneId, idx)).toEqual(derivePieces(state, laneId));
        expect(deriveProgress(state, laneId, idx)).toEqual(deriveProgress(state, laneId));
        for (const unitId of Object.keys(state.units)) {
          expect(currentTake(state, unitId, laneId, idx)).toBe(currentTake(state, unitId, laneId));
          expect(takesFor(state, unitId, laneId, idx)).toEqual(takesFor(state, unitId, laneId));
          for (const step of workflow) {
            expect(eligibleReviewers(state, unitId, laneId, step, idx)).toEqual(eligibleReviewers(state, unitId, laneId, step));
          }
        }
      }
      for (const takeId of Object.keys(state.takes)) {
        if (!state.takes[takeId]!.unitId) continue;
        expect(deriveTakeStatus(state, takeId, idx)).toEqual(deriveTakeStatus(state, takeId));
      }
      expect(deriveBooks(state, idx)).toEqual(deriveBooks(state));
    });
  }

  it('leaves out archived takes and removed members, in display order', () => {
    const state = fold(bigPartition(), emptyState());
    const idx = buildIndexes(state);
    for (const ids of idx.takesByUnitLane.values()) {
      for (const id of ids) expect(state.takes[id]!.archived).toBe(false);
      const hlcs = ids.map((id) => state.takes[id]!.hlc);
      expect([...hlcs].sort().reverse()).toEqual(hlcs);
    }
    expect(idx.activeMembersByRole.get('translator')).toEqual(['t0', 't1', 't2', 't3']);
    expect(idx.activeMembersByRole.get('reviewer')).toEqual(['r0', 'r1']);
    expect(idx.leafUnits.slice(0, 3)).toEqual(['u0', 'u1', 'u2']);
    expect(idx.containerUnits).toEqual(['b0', 'b1', 'b2']);
  });

  it('makes task derivation linear in passages, not passages times assignments', () => {
    // Why: at Bible scale (1,200 pericopes, 3 lanes, 40 translators) the
    // unindexed path took 27 s on a laptop. This is a coarse guard, not a
    // benchmark: the indexed path must stay well under a second here.
    const events = bigPartition();
    const state = fold(events, emptyState());
    const t0 = performance.now();
    const idx = buildIndexes(state);
    for (const actorId of Object.keys(state.members)) deriveTasks(state, actorId, idx);
    for (const laneId of Object.keys(state.lanes)) derivePieces(state, laneId, idx);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
