import { describe, expect, it } from 'vitest';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { fold } from '../src/reducer';
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
