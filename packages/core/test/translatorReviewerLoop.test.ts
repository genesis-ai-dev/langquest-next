import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { derivePieces, nextAction } from '../src/status';
import { deriveProgress, deriveTasks } from '../src/tasks';
import { deriveTakeStatus } from '../src/workflow';

/**
 * The whole loop the UX journeys 4 and 5 walk, folded end to end: assign ->
 * record -> submit -> peer review -> consultant review -> approved, plus the
 * suggest-changes detour. The unit tests prove each derivation alone; this
 * proves the hand-offs between them line up, so a translator's "Done" is a
 * reviewer's "To do" and an approval moves the piece to the next stage.
 */
function loop() {
  const events: AnyEvent[] = [];
  const marks: Record<string, number> = {};
  let seq = 0;
  const emit = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T]) => {
    seq += 1;
    events.push({
      id: `loop${seq}`, type, orgId: 'org1', projectId: 'p1', actorId, deviceId: 'dA',
      hlc: encodeHlc(1_700_000_000_000 + seq * 1000, 0, 'dA'), payload, serverSeq: seq
    } as AnyEvent);
  };
  const mark = (name: string) => { marks[name] = events.length; };

  emit('lead', 'v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
  emit('lead', 'v1.ProjectConfigChanged', {
    config: {
      unitKinds: [
        { id: 'book', label: 'Book', childKinds: ['passage'] },
        { id: 'passage', label: 'Passage', childKinds: [] }
      ],
      workflow: [
        { id: 'peer', role: 'reviewer', required: true, rule: 'unanimous' },
        { id: 'consultant', role: 'coordinator', required: true, rule: 'any' }
      ]
    }
  });
  emit('lead', 'v1.MemberAdded', { profileId: 'lead', role: 'owner' });
  emit('lead', 'v1.MemberAdded', { profileId: 't1', role: 'translator' });
  emit('lead', 'v1.MemberAdded', { profileId: 'r1', role: 'reviewer' });
  emit('lead', 'v1.MemberAdded', { profileId: 'c1', role: 'coordinator' });
  emit('lead', 'v1.LaneAdded', { laneId: 'L1', languoidId: 'din' });
  emit('lead', 'v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a0' });
  emit('lead', 'v1.UnitAdded', { unitId: 'luke1', parentUnitId: 'luke', kind: 'passage', label: 'Luke 1:1-4', order: 'a0' });
  mark('unassigned');

  emit('lead', 'v1.AssignmentMade', { unitId: 'luke1', laneId: 'L1', profileId: 't1', role: 'translator', dueDate: 'Sep 30' });
  emit('lead', 'v1.AssignmentMade', { unitId: 'luke1', laneId: 'L1', profileId: 'r1', role: 'reviewer' });
  mark('assigned');

  emit('t1', 'v1.RecordingAdded', { recordingId: 'rec1', unitId: 'luke1', laneId: 'L1', kind: 'target', cards: [{ hash: 'c1', durationMs: 1200 }] });
  emit('t1', 'v1.TakeComposed', { takeId: 'take1', unitId: 'luke1', laneId: 'L1', cardHashes: ['c1'], parentTakeId: null });
  mark('draft');

  emit('t1', 'v1.TakeSubmitted', { takeId: 'take1' });
  mark('submitted');

  emit('r1', 'v1.ReviewSubmitted', { takeId: 'take1', stepId: 'peer', decision: 'suggest_changes', comment: 'too fast' });
  mark('changes_requested');

  emit('t1', 'v1.ResponseRecorded', { takeId: 'take2', respondsToTakeId: 'take1', note: 'Slowed down.' });
  emit('t1', 'v1.RecordingAdded', { recordingId: 'rec2', unitId: 'luke1', laneId: 'L1', kind: 'target', cards: [{ hash: 'c2', durationMs: 1500 }] });
  emit('t1', 'v1.TakeComposed', { takeId: 'take2', unitId: 'luke1', laneId: 'L1', cardHashes: ['c2'], parentTakeId: 'take1' });
  emit('t1', 'v1.TakeArchived', { takeId: 'take1' });
  mark('responded');

  emit('t1', 'v1.TakeSubmitted', { takeId: 'take2' });
  emit('r1', 'v1.ReviewSubmitted', { takeId: 'take2', stepId: 'peer', decision: 'approve' });
  mark('peer_passed');

  emit('c1', 'v1.ReviewSubmitted', { takeId: 'take2', stepId: 'consultant', decision: 'approve' });
  mark('approved');

  const at = (name: string) => fold(events.slice(0, marks[name]), emptyState());
  return { at, events };
}

describe('translator -> reviewer round trip', () => {
  const { at, events } = loop();
  const piece = (name: string) => derivePieces(at(name), 'L1')[0]!;
  const tasksOf = (name: string, actor: string) => deriveTasks(at(name), actor).map((t) => [t.type, t.status]);

  it('before any assignment the piece is open work and the translator has nothing to do', () => {
    // Why: Pickup Home lists exactly these, and the dashboard must not invent
    // work for a translator nobody assigned.
    expect(piece('unassigned')).toMatchObject({ stage: 'Not started', status: 'unassigned', assignee: null });
    expect(nextAction(piece('unassigned'), at('unassigned')).kind).toBe('translation');
    expect(tasksOf('unassigned', 't1')).toEqual([['translate', 'todo']]);
  });

  it('an assignment gives the translator a dated task; the reviewer waits for a submission', () => {
    expect(deriveTasks(at('assigned'), 't1')).toMatchObject([{ type: 'translate', status: 'todo', dueDate: 'Sep 30' }]);
    expect(tasksOf('assigned', 'r1')).toEqual([]);
    expect(piece('assigned')).toMatchObject({ status: 'doing', assignee: 't1' });
  });

  it('a recorded but unsubmitted take is Doing for the translator and invisible to reviewers', () => {
    // Why: recordings save immediately (UX spec A30); review starts on the hand-off.
    expect(tasksOf('draft', 't1')).toEqual([['translate', 'doing']]);
    expect(tasksOf('draft', 'r1')).toEqual([]);
    expect(piece('draft')).toMatchObject({ stage: 'Draft', status: 'doing' });
  });

  it("submitting turns the translator's Done into the reviewer's To do at the first stage", () => {
    expect(tasksOf('submitted', 't1')).toEqual([['translate', 'done']]);
    expect(tasksOf('submitted', 'r1')).toEqual([['review', 'todo']]);
    expect(piece('submitted')).toMatchObject({ stage: 'peer', status: 'waiting' });
    expect(nextAction(piece('submitted'), at('submitted'))).toMatchObject({ kind: 'review', stepId: 'peer' });
    expect(deriveProgress(at('submitted'), 'L1')).toEqual({ translatedPct: 100, approvedPct: 0, passages: 1 });
  });

  it('suggest changes hands the passage back as a Respond task, and the reviewer is done for now', () => {
    // Why: suggestions are advisory (UX spec A11), not a rejection. The
    // translator gets work back; the reviewer has nothing pending until a
    // new take arrives.
    expect(deriveTakeStatus(at('changes_requested'), 'take1').outcome).toBe('changes_requested');
    expect(tasksOf('changes_requested', 't1')).toEqual([['respond', 'todo']]);
    expect(tasksOf('changes_requested', 'r1')).toEqual([['review', 'done']]);
    expect(piece('changes_requested')).toMatchObject({ stage: 'peer', status: 'doing' });
  });

  it('a new take answering the suggestion restarts the loop as a draft with the response on record', () => {
    const s = at('responded');
    expect(s.responses['take2']).toMatchObject({ respondsToTakeId: 'take1', note: 'Slowed down.' });
    expect(tasksOf('responded', 't1')).toEqual([['translate', 'doing']]);
    expect(tasksOf('responded', 'r1')).toEqual([]);
    expect(deriveTakeStatus(s, 'take1').outcome).toBe('archived');
  });

  it('passing the first stage moves the piece to the next stage, not to done', () => {
    // Why: Status drill-down shows "1 in consultant" here; a two-step
    // workflow that reports done after one approval would hide the second gate.
    const st = deriveTakeStatus(at('peer_passed'), 'take2');
    expect(st.outcome).toBe('in_review');
    expect(st.steps.map((s) => [s.stepId, s.outcome])).toEqual([['peer', 'passed'], ['consultant', 'pending']]);
    expect(piece('peer_passed')).toMatchObject({ stage: 'consultant', status: 'waiting' });
    expect(nextAction(piece('peer_passed'), at('peer_passed'))).toMatchObject({ kind: 'review', stepId: 'consultant' });
    expect(tasksOf('peer_passed', 'r1')).toEqual([['review', 'done']]);
    expect(tasksOf('peer_passed', 'c1')).toEqual([['translate', 'done'], ['review', 'todo']]);
  });

  it('the last approval completes the piece for everyone', () => {
    expect(deriveTakeStatus(at('approved'), 'take2').outcome).toBe('approved');
    expect(piece('approved')).toMatchObject({ stage: 'consultant', status: 'done' });
    expect(nextAction(piece('approved'), at('approved'))).toEqual({ kind: 'none', label: 'Complete' });
    expect(deriveProgress(at('approved'), 'L1')).toEqual({ translatedPct: 100, approvedPct: 100, passages: 1 });
    for (const actor of ['t1', 'r1', 'c1']) {
      expect(deriveTasks(at('approved'), actor).every((t) => t.done), actor).toBe(true);
    }
    // Sanity: every event in the loop was folded, none dropped as invalid.
    expect(events.length).toBe(22);
  });
});
