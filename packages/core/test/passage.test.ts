import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { commands } from '../src/commands';
import { applyLanguageEvent, foldLanguage as fold } from '../src/reducer';
import { referencedBlobs } from '../src/blobs';
import { emptyLanguageState as emptyState, type LanguageState } from '../src/state';
import {
  deriveFlow, deriveKinds, derivePassage, formatQuestionField, helpNotesFor, notePart, partNotesFor, passageSummary, questionsForKind, recordTimeline, repliesTo, replyOf,
  reviewGrid, studyMarksFor, termNotesFor, unitPlace, updatesFor
} from '../src/passage';
import { highlightsFor, languageProgress, unitsAskedOf, upNext, waitingOn } from '../src/passageLines';
import { flowTemplate, instantiateFlow } from '../src/record';
import { validateEvent } from '../src/validate';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

/**
 * The passage record, read against the language's flow (UX demo record.ts). The
 * scenarios are the demo's seed passages: a step set aside, feedback waiting
 * on its author, a checkpoint holding the steps after it, a back
 * translation that completes its step by being recorded.
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
  /** Run a command as someone against the fold so far. */
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'a' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'a1' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john4', parentUnitId: 'john', kind: 'passage', label: 'John 4:1-42', order: 'a2' });
  /** Choose a shipped flow: its steps, then the selection (what the library's flow picker appends). */
  const useFlow = (flowId: string) => {
    for (const step of instantiateFlow(flowId)) emit('lead', 'v1.FlowStepSet', step);
    emit('lead', 'v1.FlowSelected', { flowId, name: flowTemplate(flowId)!.name });
  };
  useFlow('standard_bible');
  return { emit, run, state, events, useFlow };
}

const record = (p: ReturnType<typeof language>, cards: string[], note?: string) =>
  p.run('akol', (c) => c.publishVersion({ commandId: `v${cards.join('')}`, unitId: 'john3', cardHashes: cards, ...(note ? { note } : {}) }));

describe('passage record', () => {
  it('reads every event in the record fixture as valid', () => {
    // Why: an event the validator rejects is silently skipped by the fold,
    // so a typo in a payload would look like the feature doing nothing.
    for (const e of buildRecordFixture()) expect(validateEvent(e), e.type).toBeNull();
  });

  it('a language that chose a flow reads its steps, kinds in parallel, the checkpoint marked', () => {
    const s = language().state();
    const flow = deriveFlow(s);
    expect(flow.name).toBe('Standard Bible Flow');
    expect(flow.steps.map((x) => [x.kindIds, x.checkpoint])).toEqual([
      [['peer', 'bt'], false], [['community'], false], [['consultant'], true], [['final'], false]
    ]);
  });

  it('Collect only means no steps, so recorded is done', () => {
    const p = language();
    p.useFlow('collect_only');
    expect(deriveFlow(p.state()).steps).toEqual([]);
    record(p, ['c1']);
    const s = derivePassage(p.state(), 'john3');
    expect(s.recorded).toBe(true);
    expect(s.done).toBe(true);
  });

  it('before a recording nothing is suggested; after one, the first step is', () => {
    const p = language();
    expect(derivePassage(p.state(), 'john3').next).toBeUndefined();
    record(p, ['c1', 'c2']);
    const s = derivePassage(p.state(), 'john3');
    expect(s.versions.map((v) => v.n)).toEqual([1]);
    expect(s.next?.step.kindIds).toEqual(['peer', 'bt']);
    expect(passageSummary(s, deriveKinds(p.state()), 'akol', (id) => id)).toBe('Next: Peer Review + Back Translation');
  });

  it('a version exists only when content changes, and later versions say what changed', () => {
    const p = language();
    record(p, ['c1']);
    const s = p.state();
    expect(() => commands(s).publishVersion({ commandId: 'same', unitId: 'john3', cardHashes: ['c1'], note: 'x' })).toThrow(/Nothing changed/);
    expect(() => commands(s).publishVersion({ commandId: 'mute', unitId: 'john3', cardHashes: ['c1', 'c2'] })).toThrow(/Say what changed/);
  });

  it('set aside with a reason completes the kind, and undo brings it back', () => {
    const p = language();
    record(p, ['c1']);
    p.run('akol', (c) => c.depart({ commandId: 'skip', unitId: 'john3', type: 'skip', kindId: 'peer', reason: 'No peer to ask.' }));
    let s = derivePassage(p.state(), 'john3');
    expect(s.steps[0]!.kinds.find((k) => k.kindId === 'peer')!.state).toBe('skipped');
    p.run('akol', (c) => c.undoDeparture({ commandId: 'undo', departureId: 'dep:skip' }));
    s = derivePassage(p.state(), 'john3');
    expect(s.steps[0]!.kinds.find((k) => k.kindId === 'peer')!.state).toBe('todo');
    expect(s.departures[0]!.undone?.by).toBe('akol');
  });

  it('a back translation is recorded, not judged, and is never a version', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cards: [{ hash: 'b1', durationMs: 4000, format: 'wav' }], note: 'Verse 5 was hard.' }));
    const s = derivePassage(p.state(), 'john3');
    expect(s.versions).toHaveLength(1);
    expect(s.drafting).toBe(false);
    const bt = s.steps[0]!.kinds.find((k) => k.kindId === 'bt')!;
    expect(bt.state).toBe('approved');
    expect(bt.review?.outcome).toBe('recorded');
    expect(bt.review?.artifacts?.map((c) => c.hash)).toEqual(['b1']);
  });

  it('each part of a back translation keeps the moment in the version it is about', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cards: [
      { hash: 'b1', durationMs: 4000, format: 'wav', atMs: 0 }, { hash: 'b2', durationMs: 3000, format: 'wav', atMs: 6200.4 }, { hash: 'b3', durationMs: 1000 }
    ] }));
    const bt = derivePassage(p.state(), 'john3').steps[0]!.kinds.find((k) => k.kindId === 'bt')!;
    expect(bt.review?.artifacts).toEqual([
      { hash: 'b1', durationMs: 4000, format: 'wav', atMs: 0 }, { hash: 'b2', durationMs: 3000, format: 'wav', atMs: 6200 }, { hash: 'b3', durationMs: 1000 }
    ]);
  });

  it('feedback waits on the latest version’s author; a new version answers all of it', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 5 is fast.' }));
    let s = derivePassage(p.state(), 'john3');
    expect(s.awaitingResponse).toHaveLength(1);
    expect(s.steps[0]!.kinds[0]!.state).toBe('suggestions');
    expect(passageSummary(s, deriveKinds(p.state()), 'akol', (id) => id)).toBe('Feedback for you to answer');
    expect(passageSummary(s, deriveKinds(p.state()), 'ayen', (id) => id)).toBe('Waiting on akol to answer feedback');
    expect(highlightsFor(p.state(), 'akol', { canRecord: true, canReview: false }).map((h) => h.kind)).toEqual(['respond']);

    record(p, ['c1b'], 'Slowed down verse 5.');
    s = derivePassage(p.state(), 'john3');
    expect(s.awaitingResponse).toEqual([]);
    const answered = s.reviews.find((r) => r.kindId === 'peer')!;
    expect(answered.response).toMatchObject({ decision: 'revised', note: 'Slowed down verse 5.' });
    expect(s.steps[0]!.kinds[0]!.state).toBe('addressed');
    // Answering is not a verdict: the check stays open until its reviewer says it looks good.
    expect(s.steps[0]!.complete).toBe(false);
    expect(s.done).toBe(false);
    const v2 = s.latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer2', takeIds: [v2], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    expect(derivePassage(p.state(), 'john3').steps[0]!.kinds[0]!.state).toBe('approved');
  });

  it('keeping a version despite feedback needs a reason and answers it', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 5 is fast.' }));
    const reviewId = derivePassage(p.state(), 'john3').awaitingResponse[0]!.id;
    expect(() => commands(p.state()).depart({ commandId: 'k0', unitId: 'john3', type: 'keep', reviewId, reason: ' ' })).toThrow(/Say why/);
    p.run('akol', (c) => c.depart({ commandId: 'keep', unitId: 'john3', type: 'keep', reviewId, reason: 'That pace is how it is told.' }));
    const s = derivePassage(p.state(), 'john3');
    expect(s.awaitingResponse).toEqual([]);
    expect(s.reviews[0]!.response).toMatchObject({ decision: 'kept', note: 'That pace is how it is told.' });
  });

  it('a checkpoint holds the steps after it until approved or overridden', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    for (const kindId of ['peer', 'community']) {
      p.run('ayen', (c) => c.recordReview({ commandId: kindId, takeIds: [v1], kindId, outcome: 'looks_good', via: 'app' }));
    }
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cards: [{ hash: 'b1', durationMs: 4000, format: 'wav' }] }));
    let s = derivePassage(p.state(), 'john3');
    expect(s.next?.step.kindIds).toEqual(['consultant']);
    expect(s.steps[3]!.lockedBy).toBe('Consultant Check');
    expect(s.steps[3]!.kinds[0]!.state).toBe('locked');

    // Answering the consultant's feedback does not clear a checkpoint.
    p.run('lead', (c) => c.recordReview({ commandId: 'cons', takeIds: [v1], kindId: 'consultant', outcome: 'needs_changes', via: 'app', comment: 'Verse 16.' }));
    const reviewId = derivePassage(p.state(), 'john3').awaitingResponse[0]!.id;
    p.run('akol', (c) => c.depart({ commandId: 'keep', unitId: 'john3', type: 'keep', reviewId, reason: 'Agreed with the elders.' }));
    s = derivePassage(p.state(), 'john3');
    expect(s.steps[2]!.complete).toBe(false);
    expect(s.steps[3]!.lockedBy).toBe('Consultant Check');

    p.run('lead', (c) => c.depart({ commandId: 'ovr', unitId: 'john3', type: 'override', stepId: s.steps[2]!.step.id, reason: 'Consultant visit is next year.' }));
    s = derivePassage(p.state(), 'john3');
    expect(s.steps[2]!.override?.reason).toBe('Consultant visit is next year.');
    expect(s.steps[3]!.lockedBy).toBeUndefined();
    expect(s.next?.step.kindIds).toEqual(['final']);
    expect(s.done).toBe(false);

    // The override cleared the checkpoint: once the last step passes, the passage is done (JRN-006).
    p.run('lead', (c) => c.recordReview({ commandId: 'fin', takeIds: [v1], kindId: 'final', outcome: 'looks_good', via: 'app' }));
    s = derivePassage(p.state(), 'john3');
    expect(s.steps[2]!.complete).toBe(false);
    expect(s.next).toBeUndefined();
    expect(s.done).toBe(true);
  });

  it('asking is a record: it shows as asked, on the other person’s list, and closes when done', () => {
    const p = language();
    record(p, ['c1']);
    p.run('akol', (c) => c.ask({ commandId: 'ask', unitId: 'john3', what: 'review', kindId: 'peer', profileId: 'ayen', dueDate: '2026-10-01' }));
    let s = derivePassage(p.state(), 'john3');
    expect(s.steps[0]!.kinds[0]!.state).toBe('asked');
    expect(highlightsFor(p.state(), 'ayen', { canRecord: false, canReview: true }).map((h) => [h.kind, h.request?.id])).toEqual([['review', 'req:ask']]);
    expect(waitingOn(p.state(), 'akol').map((w) => w.request.id)).toEqual(['req:ask']);
    expect(passageSummary(s, deriveKinds(p.state()), 'ayen', (id) => id)).toBe('Your turn: Peer Review');

    const v1 = s.latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app', requestId: 'req:ask' }));
    s = derivePassage(p.state(), 'john3');
    expect(s.requests[0]!.status).toBe('done');
    expect(s.steps[0]!.kinds[0]!.state).toBe('approved');
    expect(waitingOn(p.state(), 'akol')).toEqual([]);
  });

  it('taking back a review opens its check again, reopens the request it answered, and keeps it in the history', () => {
    // Why (LAN-84): a reviewer who approved by mistake had no way back, and the
    // passage moved on as if the check had passed.
    const p = language();
    record(p, ['c1']);
    p.run('akol', (c) => c.ask({ commandId: 'ask', unitId: 'john3', what: 'review', kindId: 'peer', profileId: 'ayen' }));
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app', requestId: 'req:ask' }));
    const reviewId = derivePassage(p.state(), 'john3').reviews[0]!.id;
    expect(updatesFor(p.state(), 'akol').map((u) => u.kind).sort()).toEqual(['request_done', 'review']);

    p.run('ayen', (c) => c.withdrawReviews({ commandId: 'undo', reviewIds: [reviewId] }));
    const s = derivePassage(p.state(), 'john3');
    expect(s.reviews).toEqual([]);
    expect(s.withdrawnReviews.map((r) => [r.id, r.withdrawn.by])).toEqual([[reviewId, 'ayen']]);
    expect(s.steps[0]!.kinds[0]!.state).toBe('asked');
    expect(s.requests[0]!.status).toBe('open');
    expect(highlightsFor(p.state(), 'ayen', { canRecord: false, canReview: true }).map((h) => h.request?.id)).toEqual(['req:ask']);
    expect(updatesFor(p.state(), 'akol')).toEqual([]);
  });

  it('only a review\'s own author can take it back, whenever the withdrawal arrives', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    // Someone else's withdrawal counts for nothing (the server refuses it too).
    p.run('lead', (c) => c.withdrawReviews({ commandId: 'w0', reviewIds: ['rev:early'] }));
    p.emit('ayen', 'v1.ReviewRecorded', { reviewId: 'rev:early', takeId: v1, kindId: 'peer', outcome: 'looks_good', via: 'app' });
    expect(derivePassage(p.state(), 'john3').steps[0]!.kinds[0]!.state).toBe('approved');
    // The author's own counts even when it reaches a phone before the review does.
    const late = language();
    record(late, ['c1']);
    late.run('ayen', (c) => c.withdrawReviews({ commandId: 'w1', reviewIds: ['rev:late'] }));
    late.emit('ayen', 'v1.ReviewRecorded', { reviewId: 'rev:late', takeId: v1, kindId: 'peer', outcome: 'looks_good', via: 'app' });
    expect(derivePassage(late.state(), 'john3').steps[0]!.kinds[0]!.state).toBe('todo');
  });

  it('taking back feedback stops it waiting on the translator, and taking back a checkpoint locks the steps after it again', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 3.' }));
    const feedback = derivePassage(p.state(), 'john3').awaitingResponse;
    expect(feedback).toHaveLength(1);
    p.run('ayen', (c) => c.withdrawReviews({ commandId: 'w', reviewIds: [feedback[0]!.id] }));
    expect(derivePassage(p.state(), 'john3').awaitingResponse).toEqual([]);

    for (const kindId of ['peer', 'community', 'consultant']) {
      p.run('ayen', (c) => c.recordReview({ commandId: `ok-${kindId}`, takeIds: [v1], kindId, outcome: 'looks_good', via: 'app' }));
    }
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cards: [{ hash: 'b1', durationMs: 4000, format: 'wav' }] }));
    expect(derivePassage(p.state(), 'john3').steps[3]!.lockedBy).toBeUndefined();
    const consultant = derivePassage(p.state(), 'john3').reviews.find((r) => r.kindId === 'consultant')!.id;
    p.run('ayen', (c) => c.withdrawReviews({ commandId: 'w2', reviewIds: [consultant] }));
    expect(derivePassage(p.state(), 'john3').steps[3]!.lockedBy).toBe('Consultant Check');
  });

  it('a note its author takes back shows nowhere; anyone else\'s withdrawal is ignored', () => {
    const p = language();
    record(p, ['c1']);
    p.run('akol', (c) => c.addNote({ commandId: 'n1', unitId: 'john3', anchor: { kind: 'passage' }, text: 'Say it slower.' }));
    p.run('akol', (c) => c.addNote({ commandId: 'n2', unitId: 'john3', anchor: { kind: 'verse', verse: '3:16' }, text: 'Loved, not liked.' }));
    p.run('lead', (c) => c.withdrawNote({ commandId: 'w0', noteId: 'note:n2' }));
    p.run('akol', (c) => c.withdrawNote({ commandId: 'w1', noteId: 'note:n1' }));
    expect(derivePassage(p.state(), 'john3').notes.map((n) => n.id)).toEqual(['note:n2']);
  });

  it('a withdrawn request is not waiting on anyone', () => {
    const p = language();
    p.run('lead', (c) => c.ask({ commandId: 'rec', unitId: 'john4', what: 'record', profileId: 'akol' }));
    expect(highlightsFor(p.state(), 'akol', { canRecord: true, canReview: false }).map((h) => h.kind)).toEqual(['record']);
    p.run('lead', (c) => c.withdrawRequest({ commandId: 'w', requestId: 'req:rec' }));
    expect(highlightsFor(p.state(), 'akol', { canRecord: true, canReview: false })).toEqual([]);
  });

  it('the passages asked of someone are those with an open request to them or their team', () => {
    // Why: what a person keeps offline by default, and their "Asked of you"
    // filter, follow the requests still open to them, not ones withdrawn or done.
    const p = language();
    record(p, ['c1']);
    p.emit('lead', 'v1.ReviewTeamDefined', { teamId: 'elders', name: 'Elders' });
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'elders', profileId: 'ayen', member: true });
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'elders', profileId: 'lead', member: true });
    p.run('lead', (c) => c.ask({ commandId: 'rec', unitId: 'john4', what: 'record', profileId: 'akol' }));
    p.run('lead', (c) => c.ask({ commandId: 'team', unitId: 'john3', what: 'review', kindId: 'community', teamId: 'elders' }));
    expect([...unitsAskedOf(p.state(), 'akol')]).toEqual(['john4']);
    expect([...unitsAskedOf(p.state(), 'ayen')]).toEqual(['john3']);
    // The asker is never asked by their own team request.
    expect([...unitsAskedOf(p.state(), 'lead')]).toEqual([]);
    p.run('lead', (c) => c.withdrawRequest({ commandId: 'w', requestId: 'req:rec' }));
    expect([...unitsAskedOf(p.state(), 'akol')]).toEqual([]);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'cc', takeIds: [v1], kindId: 'community', outcome: 'looks_good', via: 'app', requestId: 'req:team' }));
    expect([...unitsAskedOf(p.state(), 'ayen')]).toEqual([]);
  });

  it('logged feedback from a session covering several passages lands on each', () => {
    const p = language();
    record(p, ['c1']);
    p.run('akol', (c) => c.publishVersion({ commandId: 'j4', unitId: 'john4', cardHashes: ['d1'] }));
    const s = p.state();
    const takes = ['john3', 'john4'].map((u) => derivePassage(s, u).latest!.takeId);
    p.run('akol', (c) => c.recordReview({ commandId: 'sess', takeIds: takes, kindId: 'community', outcome: 'looks_good', via: 'logged', people: 14, place: 'Bor' }));
    for (const u of ['john3', 'john4']) {
      const r = derivePassage(p.state(), u).reviews.find((x) => x.kindId === 'community')!;
      expect(r).toMatchObject({ via: 'logged', people: 14, place: 'Bor', by: 'akol' });
    }
  });

  it('progress is several counts, not one number', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cards: [{ hash: 'b1', durationMs: 4000, format: 'wav' }] }));
    const progress = languageProgress(p.state());
    expect(progress).toMatchObject({ total: 2, recorded: 1, done: 0 });
    expect(progress.steps.map((x) => x.cleared)).toEqual([1, 0, 0, 0]);
    expect(progress.steps[2]!.checkpoint).toBe(true);
  });

  it('suggests something real when nothing is waiting', () => {
    const p = language();
    expect(upNext(p.state(), { canRecord: true, canReview: false })).toEqual({ kind: 'record', unitId: 'john3' });
    record(p, ['c1']);
    expect(upNext(p.state(), { canRecord: false, canReview: true })).toEqual({ kind: 'review', unitId: 'john3' });
  });

  it('the timeline and the reviews-by-version grid read the whole record', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'x' }));
    record(p, ['c2'], 'Fixed.');
    p.run('akol', (c) => c.addNote({ commandId: 'n', unitId: 'john3', anchor: { kind: 'passage' }, text: 'Check verse 16.' }));
    p.run('akol', (c) => c.markStudyStep({ commandId: 'st', unitId: 'john3', guideId: 'fia', stepId: 'hear', done: true }));
    const s = derivePassage(p.state(), 'john3');
    const types = recordTimeline(p.state(), s).map((e) => e.type);
    expect(types).toEqual(['study', 'note', 'response', 'version', 'review', 'version']);
    const grid = reviewGrid(s, ['peer', 'bt']);
    expect(grid.map((row) => row.version.n)).toEqual([2, 1]);
    expect(grid[1]!.cells[0]!.reviews).toHaveLength(1);
    expect(s.notes[0]!.onTakeId).toBe(s.latest!.takeId);
    expect(studyMarksFor(p.state(), 'john3').map((m) => m.stepId)).toEqual(['hear']);
  });

  it('questions come as one list labelled by source, the asker’s last', () => {
    const p = language();
    p.run('lead', (c) => c.defineMaterial({ commandId: 'm', materialId: 'questions-ours', kind: 'questions', title: 'Community check questions', scope: { stepId: 'community' },
      fields: [{ fieldId: 'q1', text: formatQuestionField({ text: 'Did it make sense?', type: 'yesno' }) }] }));
    p.run('akol', (c) => c.ask({ commandId: 'ask', unitId: 'john3', what: 'review', kindId: 'community', profileId: 'ayen', questions: [{ id: 'own', text: 'Did the children follow?', type: 'yesno', required: true }] }));
    const req = derivePassage(p.state(), 'john3').requests[0]!;
    const qs = questionsForKind(p.state(), 'community', req);
    expect(qs[0]).toMatchObject({ source: 'language', q: { text: 'Did it make sense?', type: 'yesno' } });
    expect(qs.at(-1)).toMatchObject({ source: 'request', required: true });
  });

  it('LangQuest’s ready-made checks come with no questions', () => {
    // Why (LAN-85): a team writes its own questions on each check; LangQuest's
    // English ones could not be changed, and every team got them.
    const p = language();
    for (const f of ['standard_bible', 'spoken_oral']) {
      p.useFlow(f);
      for (const k of deriveFlow(p.state()).steps.flatMap((st) => st.kindIds)) expect(questionsForKind(p.state(), k), `${f} ${k}`).toEqual([]);
    }
  });

  it('places units by book and chapter for the Map', () => {
    const s: LanguageState = fold([...buildFixture(), ...buildStep11Fixture()], emptyState());
    expect(unitPlace(s, 'luke1')).toMatchObject({ bookId: 'luk', chapters: [1], testament: 'nt' });
    expect(unitPlace(s, 'fia@1/gen-p1')).toMatchObject({ bookId: 'gen', chapters: [1, 2], testament: 'ot' });
  });

  it('reads the flow in force: its steps, less the removed ones, never another flow\'s', () => {
    // Why: steps are never deleted when a language switches flows
    // (decision 32), so only the selected flow's prefix may be read.
    const s = fold([...buildFixture(), ...buildStep11Fixture()], emptyState());
    const flow = deriveFlow(s);
    expect([flow.flowId, flow.name]).toEqual(['quick_check', 'Quick Check']);
    expect(flow.steps.map((x) => [x.id, x.kindIds])).toEqual([['quick_check/s1', ['peer']], ['quick_check/s2', ['final']]]);
  });

  it('a language that chose no flow has no steps, so a recorded passage is done', () => {
    // Why: a new language must be able to collect recordings before anyone
    // has decided how it will be checked; nothing may hold it back.
    const unflowed = fold(buildFixture().filter((e) => e.type !== 'v1.ReviewRecorded'), emptyState());
    expect(deriveFlow(unflowed)).toEqual({ flowId: null, itemId: null, docHash: null, name: 'No review flow', steps: [] });
    const s = derivePassage(unflowed, 'luke1');
    expect([s.recorded, s.done, s.next]).toEqual([true, true, undefined]);
    expect(passageSummary(s, deriveKinds(unflowed), 't1', (id) => id)).toBe('Recorded · done');
    expect(upNext(unflowed, { canRecord: false, canReview: true })).toBeNull();
  });
});

describe('updates for the inbox', () => {
  it('tell people what concerns them, never their own acts', () => {
    const p = language();
    record(p, ['c1']);
    p.run('akol', (c) => c.ask({ commandId: 'ask', unitId: 'john3', what: 'review', kindId: 'peer', profileId: 'ayen' }));
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    expect(updatesFor(p.state(), 'ayen').map((u) => u.kind)).toEqual(['request']);
    expect(updatesFor(p.state(), 'akol')).toEqual([]);
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'x', requestId: 'req:ask' }));
    expect(updatesFor(p.state(), 'akol').map((u) => u.kind).sort()).toEqual(['request_done', 'review']);
    record(p, ['c2'], 'Fixed.');
    expect(updatesFor(p.state(), 'ayen').map((u) => u.kind)).toEqual(['revision', 'request']);
  });
});

describe('study marks', () => {
  it('read guide ids that contain a colon', () => {
    const s = fold([...buildFixture(), ...buildRecordFixture()], emptyState());
    // The fixture's second device un-marks the step later, so nothing is finished.
    expect(studyMarksFor(s, 'luke1', 'fia:luke1')).toEqual([]);
    const marked = fold([...buildFixture(), ...buildRecordFixture().filter((e) => !(e.type === 'v1.StudyStepMarked' && e.actorId === 't2'))], emptyState());
    expect(studyMarksFor(marked, 'luke1', 'fia:luke1').map((m) => [m.guideId, m.stepId])).toEqual([['fia:luke1', 'hear']]);
  });
});

describe('a language\'s flow', () => {
  it('choosing another flow leaves the first one\'s steps on the record but out of force', () => {
    const p = language();
    p.useFlow('quick_check');
    expect(deriveFlow(p.state()).steps.map((s) => s.kindIds)).toEqual([['peer'], ['final']]);
    expect(Object.keys(p.state().flowSteps).filter((id) => id.startsWith('standard_bible/'))).toHaveLength(4);
  });

  it('switching back to a flow brings its steps back, and what the record says about them', () => {
    const p = language();
    record(p, ['c1']);
    const checkpoint = derivePassage(p.state(), 'john3').steps[2]!.step.id;
    p.run('lead', (c) => c.depart({ commandId: 'ovr', unitId: 'john3', type: 'override', stepId: checkpoint, reason: 'Visit next year.' }));
    const before = deriveFlow(p.state());
    const previous = { flow: p.state().flow?.value ?? null, steps: before.steps };
    p.useFlow('quick_check');
    expect(deriveFlow(p.state()).name).toBe('Quick Check');
    p.run('lead', (c) => c.restoreFlow({ commandId: 'undo', previous }));
    const after = deriveFlow(p.state());
    expect(after).toEqual(before);
    expect(derivePassage(p.state(), 'john3').steps[2]!.override?.reason).toBe('Visit next year.');
  });

  it('undoing a choice made from a hand-edited flow brings its steps back as the custom flow', () => {
    const p = language();
    p.run('lead', (c) => c.saveFlowSteps({ commandId: 'edit', steps: [{ kindIds: ['peer'], checkpoint: true }] }));
    const before = deriveFlow(p.state());
    const previous = { flow: p.state().flow?.value ?? null, steps: before.steps };
    p.useFlow('quick_check');
    p.run('lead', (c) => c.restoreFlow({ commandId: 'undo', previous }));
    expect(deriveFlow(p.state())).toEqual(before);
  });

  it('a hand-edited flow is the language’s own, and Collect only means none', () => {
    const p = language();
    p.emit('lead', 'v1.FlowStepSet', { stepId: 'other/s1', order: 's00', kindIds: ['community'], checkpoint: false });
    p.run('lead', (c) => c.saveFlowSteps({ commandId: 'edit', steps: [{ kindIds: ['peer', 'retell'], checkpoint: true }] }));
    let flow = deriveFlow(p.state());
    expect(flow.name).toBe('Custom flow');
    expect(flow.steps.map((s) => [s.kindIds, s.checkpoint])).toEqual([[['peer', 'retell'], true]]);
    const kept = flow.steps[0]!.id;
    p.run('lead', (c) => c.saveFlowSteps({ commandId: 'edit2', steps: [{ stepId: kept, kindIds: ['peer'], checkpoint: true }, { kindIds: ['final'], checkpoint: false }] }));
    flow = deriveFlow(p.state());
    expect(flow.steps[0]!.id).toBe(kept);
    expect(flow.steps).toHaveLength(2);
    p.run('lead', (c) => c.saveFlowSteps({ commandId: 'none', steps: [] }));
    expect(deriveFlow(p.state()).steps).toEqual([]);
  });
});

describe('audit follow-ups', () => {
  it('a check logged afterwards completes an ordinary step but never a checkpoint', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('akol', (c) => c.recordReview({ commandId: 'logged', takeIds: [v1], kindId: 'consultant', outcome: 'looks_good', via: 'logged', givenBy: 'Peter' }));
    p.run('akol', (c) => c.recordReview({ commandId: 'logged2', takeIds: [v1], kindId: 'community', outcome: 'looks_good', via: 'logged', people: 9 }));
    let s = derivePassage(p.state(), 'john3');
    expect(s.steps[1]!.complete).toBe(true);
    expect(s.steps[2]!.complete).toBe(false);
    expect(s.steps[3]!.lockedBy).toBe('Consultant Check');
    p.run('lead', (c) => c.recordReview({ commandId: 'inapp', takeIds: [v1], kindId: 'consultant', outcome: 'looks_good', via: 'app' }));
    s = derivePassage(p.state(), 'john3');
    expect(s.steps[2]!.complete).toBe(true);
  });

  it('"recorded" completes only a kind that makes content', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.produceContent({ commandId: 'odd', fromTakeId: v1, kindId: 'peer', cards: [{ hash: 'x', durationMs: 1 }] }));
    expect(derivePassage(p.state(), 'john3').steps[0]!.kinds.find((k) => k.kindId === 'peer')!.state).toBe('todo');
  });

  it('publishing replaces only the publisher\'s own draft', () => {
    const p = language();
    p.run('ayen', (c) => c.keepTake({ commandId: 'theirs', unitId: 'john3', cardHashes: ['o1'], actorId: 'ayen' }));
    const specs = commands(p.state()).publishVersion({ commandId: 'mine', unitId: 'john3', cardHashes: ['m1'], actorId: 'akol' });
    expect(specs.some((x) => x.type === 'v1.TakeArchived')).toBe(false);
  });

  it('record audio is uploaded because the record names it, not because it was a recording', () => {
    const p = language();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('akol', (c) => c.addNote({ commandId: 'vn', unitId: 'john3', anchor: { kind: 'passage' }, blobHash: 'voice1' }));
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cards: [{ hash: 'bt1', durationMs: 5, format: 'wav' }] }));
    const refs = referencedBlobs(p.state());
    expect(refs.get('voice1')).toMatchObject({ format: 'm4a', unitId: 'john3' });
    expect(refs.get('bt1')).toMatchObject({ format: 'wav', unitId: 'john3' });
  });

  it('derived views stay current on a state the fold keeps mutating', () => {
    const p = language();
    const live = emptyState();
    for (const e of p.events) applyLanguageEvent(live, e);
    expect(derivePassage(live, 'john3').recorded).toBe(false);
    record(p, ['c1']);
    for (const e of p.events) applyLanguageEvent(live, e);
    expect(derivePassage(live, 'john3')).toEqual(derivePassage(fold(p.events, emptyState()), 'john3'));
  });

  it('kinds read the same whatever order their definitions arrived in', () => {
    const p = language();
    p.emit('lead', 'v1.ReviewKindDefined', { kindId: 'zeta', name: 'Zeta' });
    p.emit('lead', 'v1.ReviewKindDefined', { kindId: 'alpha', name: 'Alpha' });
    const forward = deriveKinds(fold(p.events, emptyState())).map((k) => k.id);
    const backward = deriveKinds(fold([...p.events].reverse(), emptyState())).map((k) => k.id);
    expect(backward).toEqual(forward);
  });
});

describe('notes on what a check shows (decisions.md 149)', () => {
  it('a note on a part stays with that part in a later version that kept it, and not on the one recorded again', () => {
    const p = language();
    record(p, ['c1', 'c2', 'c3']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.addNote({ commandId: 'n1', unitId: 'john3', anchor: { kind: 'version', takeId: v1, part: 'c2', at: '0:04' }, text: 'Too fast.', kindId: 'peer' }));
    p.run('ayen', (c) => c.addNote({ commandId: 'n2', unitId: 'john3', anchor: { kind: 'version', takeId: v1, part: 'c3' }, text: 'Good.', kindId: 'peer' }));
    record(p, ['c1', 'c2b', 'c3'], 'Slower in part 2');
    const s = derivePassage(p.state(), 'john3');
    expect(partNotesFor(s, 'c2').map((n) => n.id)).toEqual(['note:n1']);
    expect(partNotesFor(s, 'c2b')).toEqual([]);
    expect(partNotesFor(s, 'c3').map((n) => n.id)).toEqual(['note:n2']);
    expect(notePart(s.notes[0]!.anchor)).toEqual({ takeId: v1, part: 'c2', at: '0:04' });
  });

  it('notes on a help and a key word are found by what they are on; replies stay under their note', () => {
    const p = language();
    record(p, ['c1']);
    p.run('ayen', (c) => c.addNote({ commandId: 'h', unitId: 'john3', anchor: { kind: 'passage', help: 'material:m1' }, text: 'Ask about names too.' }));
    p.run('ayen', (c) => c.addNote({ commandId: 't', unitId: 'john3', anchor: { kind: 'term', termId: 'k1' }, text: 'Same word in 3:18.' }));
    p.run('akol', (c) => c.addNote({ commandId: 'r', unitId: 'john3', anchor: { kind: 'term', termId: 'k1', replyTo: 'note:t' }, text: 'Done.' }));
    const s = derivePassage(p.state(), 'john3');
    expect(helpNotesFor(s, 'material:m1').map((n) => n.id)).toEqual(['note:h']);
    expect(helpNotesFor(s, 'item:m1')).toEqual([]);
    expect(termNotesFor(s, 'k1').map((n) => n.id)).toEqual(['note:t']);
    expect(repliesTo(s, 'note:t').map((n) => n.id)).toEqual(['note:r']);
    // Taken back by its author, a reply goes too (decision 111).
    p.run('akol', (c) => c.withdrawNote({ commandId: 'w', noteId: 'note:r' }));
    expect(repliesTo(derivePassage(p.state(), 'john3'), 'note:t')).toEqual([]);
  });

  it('what the server lets through and the fold ignores: part, at, help and replyTo that are not strings', () => {
    const odd = { kind: 'version', takeId: 't', part: 5, at: {}, replyTo: '' } as never;
    expect(notePart(odd)).toBeNull();
    expect(replyOf(odd)).toBeNull();
    expect(notePart({ kind: 'version', takeId: 't', part: 'h', at: 7 } as never)).toEqual({ takeId: 't', part: 'h' });
    // The server's check of a note is unchanged: these are valid events.
    expect(validateEvent({ id: 'e', type: 'v1.NoteAdded', orgId: 'o', streamId: 's', actorId: 'a', deviceId: 'a', hlc: '0', payload: { noteId: 'n', unitId: 'u', anchor: { kind: 'version', takeId: 't', part: 'h', at: '0:04' }, text: 'x' } } as never)).toBeNull();
  });
});
