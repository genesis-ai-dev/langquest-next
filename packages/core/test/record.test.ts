import { describe, expect, it } from 'vitest';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { fold } from '../src/reducer';
import { deriveInbox } from '../src/inbox';
import { emptyState } from '../src/state';
import {
  derivePassageRecord, highlightsFor, languageProgress, recentlyDone, recordHeadline, recordNextAction, waitingOn,
  type RecordAbilities
} from '../src/record';

/**
 * A tiny log builder: every event gets the next wall-clock tick, so the
 * order written here is the causal order, and permuting the array tests
 * that the derivations do not care about arrival order.
 */
function log() {
  const events: AnyEvent[] = [];
  let tick = 0;
  const add = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T]) => {
    tick++;
    events.push({
      id: `e${String(tick).padStart(3, '0')}`, type, orgId: 'o', projectId: 'p', actorId, deviceId: `d-${actorId}`,
      hlc: encodeHlc(1_700_000_000_000 + tick * 1000, 0, `d-${actorId}`), payload
    } as AnyEvent);
  };
  add('lead', 'v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
  for (const [id, role] of [['lead', 'owner'], ['t1', 'translator'], ['t2', 'translator'], ['r1', 'reviewer'], ['r2', 'reviewer'], ['c1', 'coordinator'], ['v1', 'viewer']] as const) {
    add('lead', 'v1.MemberAdded', { profileId: id, role });
  }
  add('lead', 'v1.LaneAdded', { laneId: 'L', languoidId: 'xyz' });
  add('lead', 'v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a0' });
  add('lead', 'v1.UnitAdded', { unitId: 'p1', parentUnitId: 'luke', kind: 'passage', label: 'Luke 1:1-4', order: 'a1' });
  add('lead', 'v1.UnitAdded', { unitId: 'p2', parentUnitId: 'luke', kind: 'passage', label: 'Luke 1:5-7', order: 'a2' });
  // Peer (any reviewer) then approval (coordinator), one step each.
  add('lead', 'v1.WorkflowStepSet', { stepId: 'peer', laneId: 'L', order: 'a', label: 'Peer Review', role: 'reviewer', required: true, rule: 'any' });
  add('lead', 'v1.WorkflowStepSet', { stepId: 'approval', laneId: 'L', order: 'b', label: 'Approval', role: 'coordinator', required: true, rule: 'any' });

  let n = 0;
  const version = (by: string, unitId = 'p1', parentTakeId: string | null = null, note?: string) => {
    const takeId = `take${++n}`;
    add(by, 'v1.TakeComposed', { takeId, unitId, laneId: 'L', cardHashes: [`h${n}`], parentTakeId });
    if (note && parentTakeId) add(by, 'v1.ResponseRecorded', { takeId, respondsToTakeId: parentTakeId, note });
    add(by, 'v1.TakeSubmitted', { takeId });
    return takeId;
  };
  const review = (by: string, takeId: string, stepId: string, decision: 'approve' | 'suggest_changes', comment?: string) =>
    add(by, 'v1.ReviewSubmitted', { takeId, stepId, decision, ...(comment ? { comment } : {}) });
  return { events, add, version, review };
}

const state = (events: AnyEvent[]) => fold(events, emptyState());
const name = (id: string) => ({ t1: 'Achol', t2: 'Deng', r1: 'Garang', r2: 'Nyandeng', c1: 'Okello' }[id] ?? id);
const translator: RecordAbilities = { record: true, review: false, ask: false };
const reviewer: RecordAbilities = { record: false, review: true, ask: false };

describe('passage record: versions and per-version approvals', () => {
  it('a new version resets every approval, so done means the latest audio was checked', () => {
    // Why: Ryder decided approvals do not carry across versions; a checkpoint
    // must certify the audio that ships, not an earlier take.
    const l = log();
    const v1 = l.version('t1');
    l.review('r1', v1, 'peer', 'approve');
    l.review('c1', v1, 'approval', 'approve');
    const done = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(done.done).toBe(true);
    expect(recordHeadline(done, name)).toBe('Done');
    expect(done.steps.map((s) => s.state)).toEqual(['complete', 'complete']);

    const v2 = l.version('t1', 'p1', v1);
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.versions.map((v) => [v.takeId, v.n])).toEqual([[v1, 1], [v2, 2]]);
    expect(rec.latest?.takeId).toBe(v2);
    expect(rec.done).toBe(false);
    expect(rec.steps.map((s) => s.state)).toEqual(['current', 'todo']);
    expect(rec.cleared).toBe(0);
    expect(recordHeadline(rec, name)).toBe('Next: Peer Review');
    // The old approval stays on the record, attached to Version 1.
    expect(rec.versions[0]!.reviews.map((r) => r.decision)).toEqual(['approve', 'approve']);
  });

  it('nothing recorded: steps are locked and the draft author is the one recording', () => {
    const l = log();
    expect(recordHeadline(derivePassageRecord(state(l.events), 'p1', 'L', 't1'), name)).toBe('Not recorded yet');
    l.add('t1', 'v1.TakeComposed', { takeId: 'd1', unitId: 'p1', laneId: 'L', cardHashes: ['x'], parentTakeId: null });
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.recorded).toBe(false);
    expect(rec.draft).toMatchObject({ takeId: 'd1', authorId: 't1', cards: 1 });
    expect(rec.steps.every((s) => s.state === 'locked')).toBe(true);
    expect(recordHeadline(rec, name)).toBe('Recording in progress');
    expect(recordNextAction(rec, 't1', translator)).toEqual({ kind: 'record' });
  });
});

describe('passage record: feedback belongs to the author of the latest version', () => {
  const l = log();
  const v1 = l.version('t1');
  l.review('r1', v1, 'peer', 'suggest_changes', 'Say "shepherd" more slowly');
  l.add('r1', 'v1.ReviewCommentRecorded', { takeId: v1, stepId: 'peer', blobHash: 'voice1' });
  const s = state(l.events);

  it("only the author is told 'Your turn: answer the feedback'; everyone else waits on them", () => {
    // Why (ADR-012): only whoever recorded the latest version can answer it;
    // a second translator re-recording would answer feedback that is not theirs.
    const mine = derivePassageRecord(s, 'p1', 'L', 't1');
    expect(mine.feedbackIsMine).toBe(true);
    expect(recordHeadline(mine, name)).toBe('Your turn: answer the feedback');
    expect(recordNextAction(mine, 't1', translator)).toEqual({ kind: 'record_fix', respondsTo: v1 });

    const other = derivePassageRecord(s, 'p1', 'L', 't2');
    expect(other.feedbackIsMine).toBe(false);
    expect(recordHeadline(other, name)).toBe('Waiting on Achol');
    expect(recordNextAction(other, 't2', translator)).toEqual({ kind: 'none' });
  });

  it('one suggestion is enough to open feedback, with the voice comment first-class', () => {
    const rec = derivePassageRecord(s, 'p1', 'L', 't1');
    expect(rec.openFeedback).toHaveLength(1);
    expect(rec.openFeedback[0]).toMatchObject({ reviewerId: 'r1', stepId: 'peer', comment: 'Say "shepherd" more slowly', voiceHash: 'voice1', answered: false });
    expect(rec.steps.find((x) => x.stepId === 'peer')!.state).toBe('attention');
  });

  it('a new version answers the feedback and restarts the step on the new audio', () => {
    const l2 = log();
    const a = l2.version('t1');
    l2.review('r1', a, 'peer', 'suggest_changes');
    const b = l2.version('t1', 'p1', a, 'Slowed it down');
    const rec = derivePassageRecord(state(l2.events), 'p1', 'L', 't1');
    expect(rec.openFeedback).toEqual([]);
    expect(rec.versions[1]).toMatchObject({ takeId: b, respondsToTakeId: a, responseNote: 'Slowed it down' });
    expect(highlightsFor(state(l2.events), 't1').filter((h) => h.kind === 'respond')).toEqual([]);
  });
});

describe('passage record: asks come from AssignmentMade and keep who asked', () => {
  it('the asker is kept, so the assignee sees who asked and the asker sees who they wait on', () => {
    const l = log();
    const v1 = l.version('t1');
    l.add('c1', 'v1.AssignmentMade', { unitId: 'p1', laneId: 'L', profileId: 'r2', role: 'reviewer', dueDate: '2026-10-01', instructions: 'Listen for names' });
    const s = state(l.events);
    expect(Object.values(s.assignments)[0]!.assignedBy).toBe('c1');

    const rec = derivePassageRecord(s, 'p1', 'L', 'r2');
    expect(rec.asks).toMatchObject([{ profileId: 'r2', askedBy: 'c1', kind: 'review', stepIds: ['peer'], satisfied: false }]);
    expect(rec.steps.find((x) => x.stepId === 'peer')!.state).toBe('waiting');
    expect(recordHeadline(rec, name)).toBe('Your turn: Peer Review');
    expect(recordHeadline(derivePassageRecord(s, 'p1', 'L', 't1'), name)).toBe('Waiting on Nyandeng');
    // The assignment makes r2 the peer reviewer set, so r2 is the one to review.
    expect(recordNextAction(rec, 'r2', reviewer)).toEqual({ kind: 'review', stepId: 'peer', takeId: v1 });

    expect(highlightsFor(s, 'r2')).toMatchObject([{ kind: 'review', unitId: 'p1', stepId: 'peer', askedBy: 'c1', dueDate: '2026-10-01', takeId: v1 }]);
    expect(waitingOn(s, 'c1')).toMatchObject([{ profileId: 'r2', unitId: 'p1' }]);
  });

  it('a review ask is satisfied by a decision on the latest version and reopened by a new version', () => {
    // Why: approvals reset per version, so an ask to review is about the
    // audio as it is now, not the audio the reviewer heard last week.
    const l = log();
    const v1 = l.version('t1');
    l.add('c1', 'v1.AssignmentMade', { unitId: 'p1', laneId: 'L', profileId: 'r2', role: 'reviewer' });
    l.review('r2', v1, 'peer', 'approve');
    expect(waitingOn(state(l.events), 'c1')).toEqual([]);
    expect(highlightsFor(state(l.events), 'r2')).toEqual([]);
    l.version('t1', 'p1', v1);
    expect(waitingOn(state(l.events), 'c1')).toHaveLength(1);
    expect(highlightsFor(state(l.events), 'r2').map((h) => h.kind)).toEqual(['review']);
  });

  it('a record ask is satisfied by the next saved version, and waiting sorts by ISO due date', () => {
    const l = log();
    l.add('c1', 'v1.AssignmentMade', { unitId: 'p1', laneId: 'L', profileId: 't1', role: 'translator', dueDate: '2026-11-01' });
    l.add('c1', 'v1.AssignmentMade', { unitId: 'p2', laneId: 'L', profileId: 't2', role: 'translator', dueDate: '2026-10-01' });
    const before = state(l.events);
    expect(highlightsFor(before, 't1')).toMatchObject([{ kind: 'record', unitId: 'p1', askedBy: 'c1' }]);
    expect(waitingOn(before, 'c1').map((a) => a.unitId)).toEqual(['p2', 'p1']);
    l.version('t1', 'p1');
    expect(highlightsFor(state(l.events), 't1')).toEqual([]);
    expect(waitingOn(state(l.events), 'c1').map((a) => a.unitId)).toEqual(['p2']);
  });

  it('the author is offered Ask someone only when nobody was asked for the next step', () => {
    const l = log();
    l.version('c1');
    const s = state(l.events);
    // c1 authored and may assign: asking is the next move, not reviewing their own work first.
    expect(recordNextAction(derivePassageRecord(s, 'p1', 'L', 'c1'), 'c1', { record: true, review: false, ask: true })).toEqual({ kind: 'ask', stepId: 'peer' });
    // A viewer never gets a yellow action.
    expect(recordNextAction(derivePassageRecord(s, 'p1', 'L', 'v1'), 'v1', { record: false, review: false, ask: false })).toEqual({ kind: 'none' });
    // A coordinator who is not the author is not nudged to ask.
    expect(recordNextAction(derivePassageRecord(s, 'p1', 'L', 'lead'), 'lead', { record: false, review: false, ask: true })).toEqual({ kind: 'none' });
  });
});

describe('passage record: parallel steps and next suggestion', () => {
  it('steps with the same order key form one group; both are the next step, in either order', () => {
    const l = log();
    l.add('lead', 'v1.WorkflowStepSet', { stepId: 'retell', laneId: 'L', order: 'a', label: 'Retell', role: 'reviewer', required: true, rule: 'any' });
    const v1 = l.version('t1');
    let rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.steps.map((s) => [s.stepId, s.group])).toEqual([['peer', 0], ['retell', 0], ['approval', 1]]);
    expect(rec.next).toEqual({ group: 0, stepIds: ['peer', 'retell'] });
    expect(recordHeadline(rec, name)).toBe('Next: Peer Review and Retell');
    // One of the pair done: the other is still next, approval still waits its turn.
    l.review('r1', v1, 'peer', 'approve');
    rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.next).toEqual({ group: 0, stepIds: ['retell'] });
    expect(rec.steps.map((s) => s.state)).toEqual(['complete', 'current', 'todo']);
  });
});

describe('passage record: history and determinism', () => {
  it('history lists versions, reviews, responses and asks, newest first', () => {
    const l = log();
    const v1 = l.version('t1');
    l.review('r1', v1, 'peer', 'suggest_changes');
    l.version('t1', 'p1', v1, 'fixed');
    l.add('c1', 'v1.AssignmentMade', { unitId: 'p1', laneId: 'L', profileId: 'r2', role: 'reviewer' });
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.history.map((h) => h.kind)).toEqual(['ask', 'version', 'response', 'review', 'version']);
  });

  it('any arrival order derives the same record', () => {
    // Why (invariant 2): two devices syncing in different orders must agree
    // on whose turn it is, or the yellow button would differ between phones.
    const l = log();
    const v1 = l.version('t1');
    l.review('r1', v1, 'peer', 'suggest_changes');
    l.add('c1', 'v1.AssignmentMade', { unitId: 'p1', laneId: 'L', profileId: 'r2', role: 'reviewer' });
    l.add('lead', 'v1.AssignmentMade', { unitId: 'p1', laneId: 'L', profileId: 'r2', role: 'reviewer', dueDate: '2026-12-01' });
    l.version('t1', 'p1', v1);
    const expected = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    // The later re-ask wins, asker included.
    expect(expected.asks).toMatchObject([{ askedBy: 'lead', dueDate: '2026-12-01' }]);
    for (const seed of [1, 2, 3, 4, 5]) {
      const shuffled = [...l.events].sort((a, b) => ((a.id.charCodeAt(3) * seed) % 7) - ((b.id.charCodeAt(3) * seed) % 7) || (a.id < b.id ? 1 : -1));
      expect(derivePassageRecord(state(shuffled), 'p1', 'L', 't1')).toEqual(expected);
    }
  });
});

describe('My Work and Map derivations', () => {
  it('a draft is For you only for its author, and only once per passage', () => {
    const l = log();
    l.add('t1', 'v1.TakeComposed', { takeId: 'd1', unitId: 'p2', laneId: 'L', cardHashes: ['x'], parentTakeId: null });
    const s = state(l.events);
    expect(highlightsFor(s, 't1')).toMatchObject([{ kind: 'draft', unitId: 'p2', takeId: 'd1' }]);
    expect(highlightsFor(s, 't2')).toEqual([]);
  });

  it('feedback cards rank after asks, one card per reviewer', () => {
    const l = log();
    const v1 = l.version('t1');
    l.review('r1', v1, 'peer', 'suggest_changes');
    l.review('r2', v1, 'peer', 'suggest_changes');
    l.add('c1', 'v1.AssignmentMade', { unitId: 'p2', laneId: 'L', profileId: 't1', role: 'translator' });
    expect(highlightsFor(state(l.events), 't1').map((h) => [h.kind, h.reviewerId ?? null])).toEqual([
      ['record', null], ['respond', 'r2'], ['respond', 'r1']
    ]);
  });

  it('recently done lists my last finished acts, one per passage', () => {
    const l = log();
    const v1 = l.version('t1', 'p1');
    const v2 = l.version('t1', 'p2');
    l.review('r1', v1, 'peer', 'approve');
    expect(recentlyDone(state(l.events), 't1').map((d) => [d.kind, d.takeId])).toEqual([['version', v2], ['version', v1]]);
    expect(recentlyDone(state(l.events), 'r1')).toMatchObject([{ kind: 'review', takeId: v1, stepId: 'peer', decision: 'approve' }]);
    expect(recentlyDone(state(l.events), 't1', 1)).toHaveLength(1);
  });

  it('language progress gives several counts, not one percent', () => {
    // Why (ADR-004): one percent hides where passages are stuck; per-step
    // counts on the latest version show it.
    const l = log();
    const v1 = l.version('t1', 'p1');
    l.review('r1', v1, 'peer', 'approve');
    l.add('t1', 'v1.TakeComposed', { takeId: 'd1', unitId: 'p2', laneId: 'L', cardHashes: ['x'], parentTakeId: null });
    expect(languageProgress(state(l.events), 'L')).toEqual({
      laneId: 'L', total: 2, recorded: 1, done: 0, waiting: 0,
      steps: [{ stepId: 'peer', label: 'Peer Review', cleared: 1 }, { stepId: 'approval', label: 'Approval', cleared: 0 }]
    });
  });
});

import { mapPassages } from '../src/record';

describe('map passages', () => {
  it('gives each passage the facts the Map filters and colours by, in unit order', () => {
    // Why: the Map counts and filters a whole Bible from one derivation; a
    // passage with open feedback must read as "feedback", a passage asked of
    // a reviewer as "with reviewers", and an unsaved take as drafting, or the
    // chapter grid tells the team the wrong thing about where work stands.
    const l = log();
    const v1 = l.version('t1');
    l.review('r1', v1, 'peer', 'suggest_changes', 'Too fast');
    l.add('t1', 'v1.TakeComposed', { takeId: 'd1', unitId: 'p2', laneId: 'L', cardHashes: ['x'], parentTakeId: null });
    const [p1, p2] = mapPassages(state(l.events), 'L');
    expect(p1).toMatchObject({ unitId: 'p1', label: 'Luke 1:1-4', recorded: true, drafting: false, done: false, feedback: 1, steps: 2, cleared: 0 });
    expect(p2).toMatchObject({ unitId: 'p2', recorded: false, drafting: true, done: false, feedback: 0, waiting: false });

    const v2 = l.version('t1', 'p1', v1);
    l.add('t1', 'v1.AssignmentMade', { unitId: 'p1', laneId: 'L', profileId: 'r2', role: 'reviewer' });
    expect(mapPassages(state(l.events), 'L')[0]).toMatchObject({ feedback: 0, waiting: true });
    l.review('r2', v2, 'peer', 'approve');
    l.review('c1', v2, 'approval', 'approve');
    expect(mapPassages(state(l.events), 'L')[0]).toMatchObject({ done: true, waiting: false, cleared: 2 });
  });
});

describe('passage record: v2 flows with kinds and checkpoints', () => {
  /** Replace the v1 steps of lane L with a v2 flow: peer + back translation together, a consultant checkpoint, then a local check. */
  function v2Log() {
    const l = log();
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'peer' });
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'approval' });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's1', laneId: 'L', order: 's00', kindIds: ['kind@1/peer', 'kind@1/back_translation'], checkpoint: false });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's2', laneId: 'L', order: 's01', kindIds: ['kind@1/consultant'], checkpoint: true });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's3', laneId: 'L', order: 's02', kindIds: ['kind@1/local'], checkpoint: false });
    return l;
  }

  it('a step lists its kinds by catalog name, and an unknown kind reads as its id', () => {
    // Why (analysis R6): a kind defined elsewhere, or not yet synced, must
    // render and never throw, or one missing fact blanks the whole record.
    const l = v2Log();
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's4', laneId: 'L', order: 's03', kindIds: ['not-synced-yet'], checkpoint: false });
    l.version('t1');
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.steps.map((s) => [s.stepId, s.kinds.map((k) => k.name), s.checkpoint])).toEqual([
      ['s1', ['Peer Review', 'Back Translation'], false],
      ['s2', ['Consultant Check'], true],
      ['s3', ['Local Check'], false],
      ['s4', ['not-synced-yet'], false]
    ]);
    expect(rec.steps[0]!.kinds[1]!.produces).toMatchObject({ checkedByKindId: 'kind@1/consultant' });
    expect(rec.steps[0]!.label).toBe('Peer Review + Back Translation');
  });

  it('an uncleared checkpoint locks every later step; clearing it unlocks them', () => {
    // Why (PLAN 16): the checkpoint is the only hard stop. Later steps wait
    // for it, so the record must not suggest the local check before the consultant.
    const l = v2Log();
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's1', laneId: 'L', order: 's00', kindIds: ['kind@1/peer'], checkpoint: false });
    const v1 = l.version('t1');
    l.review('r1', v1, 's1', 'approve');
    let rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.steps.map((s) => [s.state, s.lockedBy])).toEqual([['complete', null], ['current', null], ['locked', 's2']]);
    expect(rec.next).toEqual({ group: 1, stepIds: ['s2'] });
    expect(rec.done).toBe(false);

    l.review('c1', v1, 's2', 'approve');
    rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.steps.map((s) => s.state)).toEqual(['complete', 'complete', 'current']);
    l.review('r2', v1, 's3', 'approve');
    rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.done).toBe(true);
    expect(rec.steps.every((s) => s.kinds.every((k) => !k.outOfOrder))).toBe(true);
  });

  it('a check past an uncleared checkpoint is kept and counts, flagged out of order', () => {
    // Why (PLAN 16.1 rule 6): checkpoints are enforced by derivation, never
    // refusal. An older client may check a later step; the record stays honest.
    const l = v2Log();
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's1', laneId: 'L', order: 's00', kindIds: ['kind@1/peer'], checkpoint: false });
    const v1 = l.version('t1');
    l.review('r1', v1, 's1', 'approve');
    l.review('r2', v1, 's3', 'approve');
    let rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.steps[2]).toMatchObject({ state: 'complete', lockedBy: null });
    expect(rec.steps[2]!.kinds[0]).toMatchObject({ state: 'approved', outOfOrder: true });
    expect(rec.done).toBe(false);
    // The consultant clears it later: the early local check stays flagged,
    // because it was made before the checkpoint cleared.
    l.review('c1', v1, 's2', 'approve');
    rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.done).toBe(true);
    expect(rec.steps[2]!.kinds[0]!.outOfOrder).toBe(true);
  });

  it('a new version resets every kind, checkpoint included', () => {
    // Why (Ryder, 2026-09-25): a checkpoint certifies the audio that ships.
    const l = v2Log();
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's1', laneId: 'L', order: 's00', kindIds: ['kind@1/peer'], checkpoint: false });
    const v1 = l.version('t1');
    for (const [who, step] of [['r1', 's1'], ['c1', 's2'], ['r2', 's3']] as const) l.review(who, v1, step, 'approve');
    expect(derivePassageRecord(state(l.events), 'p1', 'L', 't1').done).toBe(true);
    l.version('t1', 'p1', v1);
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.done).toBe(false);
    expect(rec.steps.map((s) => s.state)).toEqual(['current', 'todo', 'locked']);
  });

  it('language progress counts cleared steps per v2 step, labelled by kind', () => {
    const l = v2Log();
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's1', laneId: 'L', order: 's00', kindIds: ['kind@1/peer'], checkpoint: false });
    const v1 = l.version('t1');
    l.review('r1', v1, 's1', 'approve');
    expect(languageProgress(state(l.events), 'L').steps).toEqual([
      { stepId: 's1', label: 'Peer Review', cleared: 1 },
      { stepId: 's2', label: 'Consultant Check', cleared: 0 },
      { stepId: 's3', label: 'Local Check', cleared: 0 }
    ]);
  });

  it('"Collect only" has no steps: a passage is done once recorded, without inheriting project steps', () => {
    // Why (ADR-004): a lane that chose no reviews must not fall back to the
    // project's or the default config's steps and wait on a review forever.
    const l = log();
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'peer' });
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'approval' });
    l.add('lead', 'v1.LaneFlowSelected', { laneId: 'L', flowId: 'collect_only', catalogVersion: 1 });
    expect(derivePassageRecord(state(l.events), 'p1', 'L', 't1').done).toBe(false);
    l.version('t1');
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.steps).toEqual([]);
    expect(rec.done).toBe(true);
  });

  it('a v1 step reads as one kind with its quorum kept, and optional steps do not hold up done', () => {
    // Why (D1): existing lanes keep their meaning; required: false stays optional.
    const l = log();
    l.add('lead', 'v1.WorkflowStepSet', { stepId: 'approval', laneId: 'L', order: 'b', label: 'Approval', role: 'coordinator', required: false, rule: 'any' });
    const v1 = l.version('t1');
    l.review('r1', v1, 'peer', 'approve');
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.steps.map((s) => [s.kinds.map((k) => [k.kindId, k.name, k.state]), s.legacy, s.required])).toEqual([
      [[['peer', 'Peer Review', 'approved']], true, true],
      [[['approval', 'Approval', 'todo']], true, false]
    ]);
    expect(rec.done).toBe(true);
  });

  it('any arrival order derives the same v2 record', () => {
    const l = v2Log();
    const v1 = l.version('t1');
    l.review('r2', v1, 's3', 'approve');
    l.add('lead', 'v1.ReviewKindDefined', { kindId: 'kind@1/local', name: 'Village listening' });
    const expected = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(expected.steps[2]!.kinds[0]!.name).toBe('Village listening');
    for (const seed of [1, 2, 3, 4, 5]) {
      const shuffled = [...l.events].sort((a, b) => ((a.id.charCodeAt(3) * seed) % 7) - ((b.id.charCodeAt(3) * seed) % 7) || (a.id < b.id ? 1 : -1));
      expect(derivePassageRecord(state(shuffled), 'p1', 'L', 't1')).toEqual(expected);
    }
  });
});

describe('passage record: CheckRecorded on v2 kinds', () => {
  function flow() {
    const l = log();
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'peer' });
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'approval' });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's1', laneId: 'L', order: 's00', kindIds: ['kind@1/peer', 'kind@1/community'], checkpoint: false });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's2', laneId: 'L', order: 's01', kindIds: ['kind@1/consultant'], checkpoint: true });
    let n = 0;
    const check = (by: string, takeId: string, kindId: string, outcome: 'looks_good' | 'needs_changes', extra: Partial<EventPayloads['v1.CheckRecorded']> = {}) =>
      l.add(by, 'v1.CheckRecorded', { checkId: `c${++n}`, unitId: 'p1', laneId: 'L', takeId, kindId: `kind@1/${kindId}`, outcome, ...(outcome === 'needs_changes' ? { comment: 'Slower' } : {}), ...extra });
    return { ...l, check };
  }

  it('kinds in one step are done in either order; the step completes when both look good', () => {
    // Why (ADR-005/016): "Together" means no order inside a step, so either
    // kind first must leave the other as the suggestion, and only both clear it.
    for (const order of [['peer', 'community'], ['community', 'peer']] as const) {
      const l = flow();
      const v1 = l.version('t1');
      l.check('r1', v1, order[0], 'looks_good');
      let rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
      expect(rec.steps[0]!.state).toBe('current');
      expect(rec.steps[0]!.kinds.find((k) => k.kindId === `kind@1/${order[0]}`)!.state).toBe('approved');
      expect(rec.steps[0]!.kinds.find((k) => k.kindId === `kind@1/${order[1]}`)!.state).toBe('todo');
      expect(rec.steps[1]!.state).toBe('todo');
      l.check('r2', v1, order[1], 'looks_good', { stepId: 's1' });
      rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
      expect(rec.steps.map((s) => s.state)).toEqual(['complete', 'current']);
      expect(rec.cleared).toBe(1);
    }
  });

  it('needs changes opens feedback for the author; a new version answers it and resets the kind', () => {
    // Why (D5 + approvals reset per version): the translator answers by
    // recording; the new version needs a fresh check of every kind.
    const l = flow();
    const v1 = l.version('t1');
    l.check('r1', v1, 'peer', 'needs_changes', { commentBlobHash: 'voiceC' });
    let rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.openFeedback).toMatchObject([{ kindId: 'kind@1/peer', stepId: 's1', via: 'app', comment: 'Slower', voiceHash: 'voiceC', answered: false }]);
    expect(rec.steps[0]!.state).toBe('attention');
    expect(rec.feedbackIsMine).toBe(true);
    expect(highlightsFor(state(l.events), 't1').map((h) => h.kind)).toEqual(['respond']);
    l.version('t1', 'p1', v1, 'Slowed down');
    rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.openFeedback).toEqual([]);
    expect(rec.steps[0]!.kinds.map((k) => k.state)).toEqual(['todo', 'todo']);
    expect(rec.versions[0]!.reviews.map((r) => r.kindId)).toEqual(['kind@1/peer']);
  });

  it('the same reviewer may record several checks; the latest of each kind decides', () => {
    // Why (analysis row 8): ReviewSubmitted kept one verdict per person and
    // step; checks are set by id, so a second session is a new check.
    const l = flow();
    const v1 = l.version('t1');
    l.check('c1', v1, 'consultant', 'needs_changes');
    l.check('c1', v1, 'consultant', 'looks_good');
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    expect(rec.steps[1]!.kinds[0]).toMatchObject({ state: 'approved', outOfOrder: false });
    expect(rec.steps[1]!.kinds[0]!.checks).toHaveLength(2);
  });

  it('a check naming no step, or a step no longer in the flow, belongs to the first step with its kind', () => {
    const l = flow();
    const v1 = l.version('t1');
    l.check('c1', v1, 'consultant', 'looks_good', { stepId: 'retired-step' });
    expect(derivePassageRecord(state(l.events), 'p1', 'L', 't1').steps[1]!.kinds[0]!.state).toBe('approved');
  });

  it('the next action for a reviewer names the kind still to check', () => {
    const l = flow();
    const v1 = l.version('t1');
    l.check('r2', v1, 'peer', 'looks_good');
    const rec = derivePassageRecord(state(l.events), 'p1', 'L', 'r1');
    expect(recordNextAction(rec, 'r1', reviewer)).toEqual({ kind: 'review', stepId: 's1', takeId: v1, kindId: 'kind@1/community' });
    expect(recentlyDone(state(l.events), 'r2')).toMatchObject([{ kind: 'review', kindId: 'kind@1/peer', decision: 'approve' }]);
  });

  it('check before step definition and in any arrival order derives the same record', () => {
    // Why (analysis R12): a check can sync in before the step that holds its kind.
    const l = flow();
    const v1 = l.version('t1');
    l.check('r1', v1, 'peer', 'looks_good');
    l.check('r2', v1, 'community', 'needs_changes');
    const expected = derivePassageRecord(state(l.events), 'p1', 'L', 't1');
    const checksFirst = [...l.events.filter((e) => e.type === 'v1.CheckRecorded'), ...l.events.filter((e) => e.type !== 'v1.CheckRecorded')];
    expect(derivePassageRecord(state(checksFirst), 'p1', 'L', 't1')).toEqual(expected);
    for (const seed of [1, 2, 3]) {
      const shuffled = [...l.events].sort((a, b) => ((a.id.charCodeAt(3) * seed) % 5) - ((b.id.charCodeAt(3) * seed) % 5) || (a.id < b.id ? 1 : -1));
      expect(derivePassageRecord(state(shuffled), 'p1', 'L', 't1')).toEqual(expected);
    }
  });
});

describe('passage record: departures (set aside, override, undo)', () => {
  /** Peer + community together, a consultant checkpoint, then a local check. */
  function flow() {
    const l = log();
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'peer' });
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'approval' });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's1', laneId: 'L', order: 's00', kindIds: ['kind@1/peer', 'kind@1/community'], checkpoint: false });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's2', laneId: 'L', order: 's01', kindIds: ['kind@1/consultant'], checkpoint: true });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's3', laneId: 'L', order: 's02', kindIds: ['kind@1/local'], checkpoint: false });
    let n = 0;
    const check = (by: string, takeId: string, kindId: string, stepId: string) =>
      l.add(by, 'v1.CheckRecorded', { checkId: `c${++n}`, unitId: 'p1', laneId: 'L', takeId, kindId: `kind@1/${kindId}`, stepId, outcome: 'looks_good' });
    const aside = (by: string, departureId: string, stepId: string, kindId?: string, reason = 'No one available for this right now') =>
      l.add(by, 'v1.StepSetAside', { departureId, unitId: 'p1', laneId: 'L', stepId, reason, ...(kindId ? { kindId: `kind@1/${kindId}` } : {}) });
    const override = (by: string, departureId: string, stepId = 's2') =>
      l.add(by, 'v1.CheckpointOverridden', { departureId, unitId: 'p1', laneId: 'L', stepId, reason: 'Consultant visit is months away' });
    const undo = (by: string, undoId: string, departureId: string, departureKind: 'set_aside' | 'override') =>
      l.add(by, 'v1.DepartureUndone', { undoId, departureId, departureKind });
    return { ...l, check, aside, override, undo };
  }
  const rec = (events: AnyEvent[]) => derivePassageRecord(state(events), 'p1', 'L', 't1');

  it('a set-aside kind is skipped with its reason and completes a non-checkpoint step', () => {
    // Why (ADR-004, comply or explain): a suggested step may be skipped when
    // someone says why, and the passage moves on instead of waiting forever.
    const l = flow();
    const v1 = l.version('t1');
    l.check('r1', v1, 'peer', 's1');
    l.aside('t1', 'd1', 's1', 'community');
    const r = rec(l.events);
    expect(r.steps[0]!.kinds.map((k) => k.state)).toEqual(['approved', 'skipped']);
    expect(r.steps[0]!.kinds[1]!.setAside).toMatchObject({ departureId: 'd1', reason: 'No one available for this right now', by: 't1', undone: null });
    expect(r.steps[0]!.state).toBe('complete');
    expect(r.next?.stepIds).toEqual(['s2']);
    expect(r.history[0]).toMatchObject({ kind: 'departure', by: 't1', departure: { departureId: 'd1', kind: 'set_aside' } });
  });

  it('a set-aside survives a new version, but never completes a checkpoint', () => {
    // Why (Ryder: a departure is per passage and survives new versions; ADR-012:
    // a checkpoint certifies the audio, so only its own approval clears it).
    const l = flow();
    const v1 = l.version('t1');
    l.aside('t1', 'd1', 's1');
    l.aside('t1', 'd2', 's2');
    l.version('t1', 'p1', v1);
    const r = rec(l.events);
    expect(r.steps[0]).toMatchObject({ state: 'complete' });
    expect(r.steps[1]!.kinds[0]!.state).toBe('skipped');
    expect(r.steps[1]!.state).not.toBe('complete');
    expect(r.steps[2]!.state).toBe('locked');
    expect(r.done).toBe(false);
  });

  it('an override moves past the checkpoint: later steps unlock and it counts toward done', () => {
    // Why (PLAN 16 / D9, Ryder): "clears … or on an override". Without it a
    // church waiting months for a consultant could never finish a passage.
    const l = flow();
    const v1 = l.version('t1');
    l.aside('t1', 'd1', 's1');
    let r = rec(l.events);
    expect(r.steps[2]!.state).toBe('locked');
    l.override('lead', 'o1');
    r = rec(l.events);
    expect(r.steps[1]).toMatchObject({ state: 'todo', override: { departureId: 'o1', kind: 'override' } });
    expect(r.steps[2]!.state).toBe('current');
    expect(r.next?.stepIds).toEqual(['s3']);
    l.check('r2', v1, 'local', 's3');
    r = rec(l.events);
    expect(r.done).toBe(true);
    // The local check came after the override, so it is not out of order.
    expect(r.steps[2]!.kinds[0]!.outOfOrder).toBe(false);
    expect(languageProgress(state(l.events), 'L').steps.map((s) => s.cleared)).toEqual([1, 1, 1]);
  });

  it('an undo brings a departure back; the record keeps both, and a new departure is needed to depart again', () => {
    // Why (J-REC-6): undo is a compensating fact, never deletion, so the
    // history shows "set aside" and "brought back" and nobody loses the reason.
    const l = flow();
    l.version('t1');
    l.aside('t1', 'd1', 's1');
    l.undo('t1', 'u1', 'd1', 'set_aside');
    let r = rec(l.events);
    expect(r.steps[0]!.state).not.toBe('complete');
    expect(r.departures).toMatchObject([{ departureId: 'd1', undone: { by: 't1' } }]);
    expect(r.history[0]).toMatchObject({ kind: 'departure', departure: { departureId: 'd1', undone: { by: 't1' } } });
    l.aside('t1', 'd2', 's1');
    r = rec(l.events);
    expect(r.steps[0]!.state).toBe('complete');
  });

  it('an undo that names the wrong kind leaves the departure active', () => {
    // Why (R11): undoing an override needs manage_flows. A translator may
    // send an undo for a set-aside; it must not bring back an override.
    const l = flow();
    l.version('t1');
    l.override('lead', 'o1');
    l.undo('t1', 'u1', 'o1', 'set_aside');
    expect(rec(l.events).steps[1]!.override).toMatchObject({ departureId: 'o1', undone: null });
  });

  it('a set-aside past an uncleared checkpoint counts, flagged out of order', () => {
    // Why (PLAN 16.1 rule 6): checkpoints are enforced by derivation, never refusal.
    const l = flow();
    l.version('t1');
    l.aside('t1', 'd1', 's1');
    l.aside('t1', 'd2', 's3');
    const r = rec(l.events);
    expect(r.steps[2]!.kinds[0]).toMatchObject({ state: 'skipped', outOfOrder: true });
    expect(r.steps[2]!.state).toBe('complete');
  });

  it('undo before its departure and any arrival order derive the same record', () => {
    // Why (analysis R12): an undo can sync in before the departure it names.
    const l = flow();
    const v1 = l.version('t1');
    l.check('r1', v1, 'peer', 's1');
    l.aside('t1', 'd1', 's1', 'community');
    l.override('lead', 'o1');
    l.undo('lead', 'u1', 'o1', 'override');
    l.aside('t1', 'd2', 's3');
    const expected = rec(l.events);
    const undoFirst = [...l.events.filter((e) => e.type === 'v1.DepartureUndone'), ...l.events.filter((e) => e.type !== 'v1.DepartureUndone')];
    expect(rec(undoFirst)).toEqual(expected);
    for (const seed of [1, 2, 3]) {
      const shuffled = [...l.events].sort((a, b) => ((a.id.charCodeAt(3) * seed) % 5) - ((b.id.charCodeAt(3) * seed) % 5) || (a.id < b.id ? 1 : -1));
      expect(rec(shuffled)).toEqual(expected);
    }
  });
});

describe('passage record: Keep it, say why (FeedbackKept)', () => {
  function flow() {
    const l = log();
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'approval' });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's1', laneId: 'L', order: 's00', kindIds: ['kind@1/community'], checkpoint: false });
    l.add('lead', 'v2.WorkflowStepSet', { stepId: 's2', laneId: 'L', order: 's01', kindIds: ['kind@1/consultant'], checkpoint: true });
    const check = (checkId: string, by: string, takeId: string, kindId: string) =>
      l.add(by, 'v1.CheckRecorded', { checkId, unitId: 'p1', laneId: 'L', takeId, kindId: `kind@1/${kindId}`, outcome: 'needs_changes', comment: 'Slower' });
    const keep = (keptId: string, target: Partial<EventPayloads['v1.FeedbackKept']>) =>
      l.add('t1', 'v1.FeedbackKept', { keptId, reason: 'Listeners preferred the current wording', ...target });
    return { ...l, check, keep };
  }
  const rec = (events: AnyEvent[], actor = 't1') => derivePassageRecord(state(events), 'p1', 'L', actor);

  it('kept feedback is answered without a new version, and a non-checkpoint kind reads addressed', () => {
    // Why (J-REC-4, D5): the translator may keep the take and say why; the
    // feedback stops asking for a fix and the step moves on.
    const l = flow();
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'peer' });
    const v1 = l.version('t1');
    l.check('c1', 'r1', v1, 'community');
    expect(rec(l.events).feedbackIsMine).toBe(true);
    l.keep('k1', { checkId: 'c1' });
    const r = rec(l.events);
    expect(r.openFeedback).toEqual([]);
    expect(r.feedback[0]).toMatchObject({ checkId: 'c1', answered: true, kept: { keptId: 'k1', by: 't1', reason: 'Listeners preferred the current wording' } });
    expect(r.steps[0]).toMatchObject({ state: 'complete' });
    expect(r.steps[0]!.kinds[0]!.state).toBe('addressed');
    expect(r.turn.kind).not.toBe('answer_feedback');
    expect(highlightsFor(state(l.events), 't1').filter((h) => h.kind === 'respond')).toEqual([]);
    expect(r.history[0]).toMatchObject({ kind: 'kept', reviewerId: 'r1', kept: { keptId: 'k1' } });
  });

  it('keeping never clears a checkpoint: it still needs its own looks good', () => {
    // Why (ADR-012): a checkpoint certifies the audio. "Keep it" answers the
    // feedback, but only the checker can clear the stop.
    const l = flow();
    l.add('lead', 'v1.WorkflowStepRemoved', { stepId: 'peer' });
    const v1 = l.version('t1');
    l.add('lead', 'v1.StepSetAside', { departureId: 'd1', unitId: 'p1', laneId: 'L', stepId: 's1', reason: 'Not needed for this passage' });
    l.check('c1', 'c1', v1, 'consultant');
    l.keep('k1', { checkId: 'c1' });
    const r = rec(l.events);
    expect(r.steps[1]!.kinds[0]!.state).toBe('addressed');
    expect(r.steps[1]!.state).not.toBe('complete');
    expect(r.done).toBe(false);
  });

  it('a legacy review is kept by take, step and reviewer; another reviewer stays open', () => {
    // Why (analysis row 12): ReviewSubmitted has no id, so the target names it.
    const l = log();
    const v1 = l.version('t1');
    l.review('r1', v1, 'peer', 'suggest_changes', 'Too fast');
    l.review('r2', v1, 'peer', 'suggest_changes', 'Unclear');
    l.add('t1', 'v1.FeedbackKept', { keptId: 'k1', legacyTarget: { takeId: v1, stepId: 'peer', reviewerId: 'r1' }, reason: 'Matches our key terms decision' });
    let r = rec(l.events);
    expect(r.openFeedback.map((f) => f.reviewerId)).toEqual(['r2']);
    expect(r.steps[0]!.kinds[0]!.state).toBe('suggestions');
    l.add('t1', 'v1.FeedbackKept', { keptId: 'k2', legacyTarget: { takeId: v1, stepId: 'peer', reviewerId: 'r2' }, reasonBlobHash: 'why' });
    r = rec(l.events);
    expect(r.openFeedback).toEqual([]);
    expect(r.steps[0]!.kinds[0]!.state).toBe('addressed');
  });

  it('the reviewer hears their feedback was kept as is', () => {
    const l = flow();
    const v1 = l.version('t1');
    l.check('c1', 'r1', v1, 'community');
    l.keep('k1', { checkId: 'c1' });
    const inbox = deriveInbox(state(l.events), 'r1');
    expect(inbox.find((i) => i.id === 'kept:k1')).toMatchObject({ kind: 'decision', unitId: 'p1', title: 'Luke 1:1-4 · Kept as is · Listeners preferred the current wording' });
    expect(deriveInbox(state(l.events), 'r2').some((i) => i.id === 'kept:k1')).toBe(false);
  });

  it('kept before its check and in any arrival order derives the same record', () => {
    const l = flow();
    const v1 = l.version('t1');
    l.check('c1', 'r1', v1, 'community');
    l.keep('k1', { checkId: 'c1' });
    const expected = rec(l.events);
    const keptFirst = [...l.events.filter((e) => e.type === 'v1.FeedbackKept'), ...l.events.filter((e) => e.type !== 'v1.FeedbackKept')];
    expect(rec(keptFirst)).toEqual(expected);
  });
});
