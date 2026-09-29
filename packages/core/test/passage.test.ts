import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { commands } from '../src/commands';
import { fold } from '../src/reducer';
import { emptyState, type ProjectState } from '../src/state';
import {
  deriveFlow, deriveKinds, derivePassage, highlightsFor, languageProgress, passageSummary,
  questionsForKind, recordTimeline, reviewGrid, studyMarksFor, unitPlace, upNext, waitingOn
} from '../src/passage';
import { validateEvent } from '../src/validate';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

/**
 * The passage record, read against the lane's flow (UX demo record.ts). The
 * scenarios are the demo's seed passages: a step set aside, feedback waiting
 * on its author, a checkpoint holding the steps after it, a back
 * translation that completes its step by being recorded.
 */

function project() {
  const events: AnyEvent[] = [];
  let wall = 1_700_000_000_000;
  let seq = 0;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T]) => {
    const clock = clocks.get(actorId) ?? new HlcClock(actorId, () => wall);
    clocks.set(actorId, clock);
    wall += 1000;
    seq += 1;
    events.push({ id: `x${seq}`, type, orgId: 'o', projectId: 'p', actorId, deviceId: actorId, hlc: clock.next(), payload } as AnyEvent);
  };
  const state = () => fold(events, emptyState());
  /** Run a command as someone against the fold so far. */
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.MemberAdded', { profileId: 'lead', role: 'owner' });
  emit('lead', 'v1.MemberAdded', { profileId: 'akol', role: 'translator' });
  emit('lead', 'v1.MemberAdded', { profileId: 'ayen', role: 'reviewer' });
  emit('lead', 'v1.LaneAdded', { laneId: 'din', languoidId: 'din' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'a' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'a1' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john4', parentUnitId: 'john', kind: 'passage', label: 'John 4:1-42', order: 'a2' });
  run('lead', (c) => c.useFlow({ commandId: 'flow', laneId: 'din', flowId: 'standard_bible' }));
  return { emit, run, state, events };
}

const record = (p: ReturnType<typeof project>, cards: string[], note?: string) =>
  p.run('akol', (c) => c.publishVersion({ commandId: `v${cards.join('')}`, unitId: 'john3', laneId: 'din', cardHashes: cards, ...(note ? { note } : {}) }));

describe('passage record', () => {
  it('reads every event in the record fixture as valid', () => {
    // Why: an event the validator rejects is silently skipped by the fold,
    // so a typo in a payload would look like the feature doing nothing.
    for (const e of buildRecordFixture()) expect(validateEvent(e), e.type).toBeNull();
  });

  it('a lane that chose a flow reads its steps, kinds in parallel, the checkpoint marked', () => {
    const s = project().state();
    const flow = deriveFlow(s, 'din');
    expect(flow.name).toBe('Standard Bible Flow');
    expect(flow.steps.map((x) => [x.kindIds, x.checkpoint])).toEqual([
      [['peer', 'bt'], false], [['community'], false], [['consultant'], true], [['final'], false]
    ]);
  });

  it('Collect only means no steps, so recorded is done', () => {
    const p = project();
    p.run('lead', (c) => c.useFlow({ commandId: 'collect', laneId: 'din', flowId: 'collect_only' }));
    expect(deriveFlow(p.state(), 'din').steps).toEqual([]);
    record(p, ['c1']);
    const s = derivePassage(p.state(), 'john3', 'din');
    expect(s.recorded).toBe(true);
    expect(s.done).toBe(true);
  });

  it('before a recording nothing is suggested; after one, the first step is', () => {
    const p = project();
    expect(derivePassage(p.state(), 'john3', 'din').next).toBeUndefined();
    record(p, ['c1', 'c2']);
    const s = derivePassage(p.state(), 'john3', 'din');
    expect(s.versions.map((v) => v.n)).toEqual([1]);
    expect(s.next?.step.kindIds).toEqual(['peer', 'bt']);
    expect(passageSummary(s, deriveKinds(p.state()), 'akol', (id) => id)).toBe('Next: Peer Review + Back Translation');
  });

  it('a version exists only when content changes, and later versions say what changed', () => {
    const p = project();
    record(p, ['c1']);
    const s = p.state();
    expect(() => commands(s).publishVersion({ commandId: 'same', unitId: 'john3', laneId: 'din', cardHashes: ['c1'], note: 'x' })).toThrow(/Nothing changed/);
    expect(() => commands(s).publishVersion({ commandId: 'mute', unitId: 'john3', laneId: 'din', cardHashes: ['c1', 'c2'] })).toThrow(/Say what changed/);
  });

  it('set aside with a reason completes the kind, and undo brings it back', () => {
    const p = project();
    record(p, ['c1']);
    p.run('akol', (c) => c.depart({ commandId: 'skip', unitId: 'john3', laneId: 'din', type: 'skip', kindId: 'peer', reason: 'No peer to ask.' }));
    let s = derivePassage(p.state(), 'john3', 'din');
    expect(s.steps[0]!.kinds.find((k) => k.kindId === 'peer')!.state).toBe('skipped');
    p.run('akol', (c) => c.undoDeparture({ commandId: 'undo', departureId: 'dep:skip' }));
    s = derivePassage(p.state(), 'john3', 'din');
    expect(s.steps[0]!.kinds.find((k) => k.kindId === 'peer')!.state).toBe('todo');
    expect(s.departures[0]!.undone?.by).toBe('akol');
  });

  it('a back translation is recorded, not judged, and is never a version', () => {
    const p = project();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cardHashes: ['b1'], note: 'Verse 5 was hard.' }));
    const s = derivePassage(p.state(), 'john3', 'din');
    expect(s.versions).toHaveLength(1);
    expect(s.drafting).toBe(false);
    const bt = s.steps[0]!.kinds.find((k) => k.kindId === 'bt')!;
    expect(bt.state).toBe('approved');
    expect(bt.review?.outcome).toBe('recorded');
    expect(bt.review?.contentTakeId).toBe('content:bt');
  });

  it('feedback waits on the latest version’s author; a new version answers all of it', () => {
    const p = project();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 5 is fast.' }));
    let s = derivePassage(p.state(), 'john3', 'din');
    expect(s.awaitingResponse).toHaveLength(1);
    expect(s.steps[0]!.kinds[0]!.state).toBe('suggestions');
    expect(passageSummary(s, deriveKinds(p.state()), 'akol', (id) => id)).toBe('Feedback for you to answer');
    expect(passageSummary(s, deriveKinds(p.state()), 'ayen', (id) => id)).toBe('Waiting on akol to answer feedback');
    expect(highlightsFor(p.state(), 'akol', { canRecord: true, canReview: false }).map((h) => h.kind)).toEqual(['respond']);

    record(p, ['c1b'], 'Slowed down verse 5.');
    s = derivePassage(p.state(), 'john3', 'din');
    expect(s.awaitingResponse).toEqual([]);
    const answered = s.reviews.find((r) => r.kindId === 'peer')!;
    expect(answered.response).toMatchObject({ decision: 'revised', note: 'Slowed down verse 5.' });
    expect(s.steps[0]!.kinds[0]!.state).toBe('addressed');
  });

  it('keeping a version despite feedback needs a reason and answers it', () => {
    const p = project();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 5 is fast.' }));
    const reviewId = derivePassage(p.state(), 'john3', 'din').awaitingResponse[0]!.id;
    expect(() => commands(p.state()).depart({ commandId: 'k0', unitId: 'john3', laneId: 'din', type: 'keep', reviewId, reason: ' ' })).toThrow(/Say why/);
    p.run('akol', (c) => c.depart({ commandId: 'keep', unitId: 'john3', laneId: 'din', type: 'keep', reviewId, reason: 'That pace is how it is told.' }));
    const s = derivePassage(p.state(), 'john3', 'din');
    expect(s.awaitingResponse).toEqual([]);
    expect(s.reviews[0]!.response).toMatchObject({ decision: 'kept', note: 'That pace is how it is told.' });
  });

  it('a checkpoint holds the steps after it until approved or overridden', () => {
    const p = project();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    for (const kindId of ['peer', 'community']) {
      p.run('ayen', (c) => c.recordReview({ commandId: kindId, takeIds: [v1], kindId, outcome: 'looks_good', via: 'app' }));
    }
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cardHashes: ['b1'] }));
    let s = derivePassage(p.state(), 'john3', 'din');
    expect(s.next?.step.kindIds).toEqual(['consultant']);
    expect(s.steps[3]!.lockedBy).toBe('Consultant Check');
    expect(s.steps[3]!.kinds[0]!.state).toBe('locked');

    // Answering the consultant's feedback does not clear a checkpoint.
    p.run('lead', (c) => c.recordReview({ commandId: 'cons', takeIds: [v1], kindId: 'consultant', outcome: 'needs_changes', via: 'app', comment: 'Verse 16.' }));
    const reviewId = derivePassage(p.state(), 'john3', 'din').awaitingResponse[0]!.id;
    p.run('akol', (c) => c.depart({ commandId: 'keep', unitId: 'john3', laneId: 'din', type: 'keep', reviewId, reason: 'Agreed with the elders.' }));
    s = derivePassage(p.state(), 'john3', 'din');
    expect(s.steps[2]!.complete).toBe(false);
    expect(s.steps[3]!.lockedBy).toBe('Consultant Check');

    p.run('lead', (c) => c.depart({ commandId: 'ovr', unitId: 'john3', laneId: 'din', type: 'override', stepId: s.steps[2]!.step.id, reason: 'Consultant visit is next year.' }));
    s = derivePassage(p.state(), 'john3', 'din');
    expect(s.steps[2]!.override?.reason).toBe('Consultant visit is next year.');
    expect(s.steps[3]!.lockedBy).toBeUndefined();
    expect(s.next?.step.kindIds).toEqual(['final']);
    expect(s.done).toBe(false);
  });

  it('asking is a record: it shows as asked, on the other person’s list, and closes when done', () => {
    const p = project();
    record(p, ['c1']);
    p.run('akol', (c) => c.ask({ commandId: 'ask', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', profileId: 'ayen', dueDate: '2026-10-01' }));
    let s = derivePassage(p.state(), 'john3', 'din');
    expect(s.steps[0]!.kinds[0]!.state).toBe('asked');
    expect(highlightsFor(p.state(), 'ayen', { canRecord: false, canReview: true }).map((h) => [h.kind, h.request?.id])).toEqual([['review', 'req:ask']]);
    expect(waitingOn(p.state(), 'akol').map((w) => w.request.id)).toEqual(['req:ask']);
    expect(passageSummary(s, deriveKinds(p.state()), 'ayen', (id) => id)).toBe('Your turn: Peer Review');

    const v1 = s.latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app', requestId: 'req:ask' }));
    s = derivePassage(p.state(), 'john3', 'din');
    expect(s.requests[0]!.status).toBe('done');
    expect(s.steps[0]!.kinds[0]!.state).toBe('approved');
    expect(waitingOn(p.state(), 'akol')).toEqual([]);
  });

  it('a withdrawn request is not waiting on anyone', () => {
    const p = project();
    p.run('lead', (c) => c.ask({ commandId: 'rec', unitId: 'john4', laneId: 'din', what: 'record', profileId: 'akol' }));
    expect(highlightsFor(p.state(), 'akol', { canRecord: true, canReview: false }).map((h) => h.kind)).toEqual(['record']);
    p.run('lead', (c) => c.withdrawRequest({ commandId: 'w', requestId: 'req:rec' }));
    expect(highlightsFor(p.state(), 'akol', { canRecord: true, canReview: false })).toEqual([]);
  });

  it('logged feedback from a session covering several passages lands on each', () => {
    const p = project();
    record(p, ['c1']);
    p.run('akol', (c) => c.publishVersion({ commandId: 'j4', unitId: 'john4', laneId: 'din', cardHashes: ['d1'] }));
    const s = p.state();
    const takes = ['john3', 'john4'].map((u) => derivePassage(s, u, 'din').latest!.takeId);
    p.run('akol', (c) => c.recordReview({ commandId: 'sess', takeIds: takes, kindId: 'community', outcome: 'looks_good', via: 'logged', people: 14, place: 'Bor' }));
    for (const u of ['john3', 'john4']) {
      const r = derivePassage(p.state(), u, 'din').reviews.find((x) => x.kindId === 'community')!;
      expect(r).toMatchObject({ via: 'logged', people: 14, place: 'Bor', by: 'akol' });
    }
  });

  it('progress is several counts, not one number', () => {
    const p = project();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    p.run('ayen', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cardHashes: ['b1'] }));
    const progress = languageProgress(p.state(), 'din');
    expect(progress).toMatchObject({ total: 2, recorded: 1, done: 0 });
    expect(progress.steps.map((x) => x.cleared)).toEqual([1, 0, 0, 0]);
    expect(progress.steps[2]!.checkpoint).toBe(true);
  });

  it('suggests something real when nothing is waiting', () => {
    const p = project();
    expect(upNext(p.state(), 'din', { canRecord: true, canReview: false })).toEqual({ kind: 'record', unitId: 'john3' });
    record(p, ['c1']);
    expect(upNext(p.state(), 'din', { canRecord: false, canReview: true })).toEqual({ kind: 'review', unitId: 'john3' });
  });

  it('the timeline and the reviews-by-version grid read the whole record', () => {
    const p = project();
    record(p, ['c1']);
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'x' }));
    record(p, ['c2'], 'Fixed.');
    p.run('akol', (c) => c.addNote({ commandId: 'n', unitId: 'john3', laneId: 'din', anchor: { kind: 'passage' }, text: 'Check verse 16.' }));
    p.run('akol', (c) => c.markStudyStep({ commandId: 'st', unitId: 'john3', laneId: 'din', guideId: 'fia', stepId: 'hear', done: true }));
    const s = derivePassage(p.state(), 'john3', 'din');
    const types = recordTimeline(p.state(), s).map((e) => e.type);
    expect(types).toEqual(['study', 'note', 'response', 'version', 'review', 'version']);
    const grid = reviewGrid(s, ['peer', 'bt']);
    expect(grid.map((row) => row.version.n)).toEqual([2, 1]);
    expect(grid[1]!.cells[0]!.reviews).toHaveLength(1);
    expect(s.notes[0]!.onTakeId).toBe(s.latest!.takeId);
    expect(studyMarksFor(p.state(), 'john3', 'din').map((m) => m.stepId)).toEqual(['hear']);
  });

  it('questions come as one list labelled by source, the asker’s last', () => {
    const p = project();
    p.run('akol', (c) => c.ask({ commandId: 'ask', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'community', profileId: 'ayen', questions: [{ id: 'own', text: 'Did the children follow?', type: 'yesno', required: true }] }));
    const req = derivePassage(p.state(), 'john3', 'din').requests[0]!;
    const qs = questionsForKind(p.state(), 'community', 'din', req);
    expect(qs[0]!.source).toBe('org');
    expect(qs.at(-1)).toMatchObject({ source: 'request', required: true });
  });

  it('places units by book and chapter for the Map', () => {
    const s: ProjectState = fold([...buildFixture(), ...buildStep11Fixture()], emptyState());
    expect(unitPlace(s, 'luke1')).toMatchObject({ bookId: 'luk', chapters: [1], testament: 'nt' });
    expect(unitPlace(s, 'fia@1/gen-p1')).toMatchObject({ bookId: 'gen', chapters: [1, 2], testament: 'ot' });
  });

  it('a lane configured with v1 steps reads them as kinds', () => {
    const s = fold([...buildFixture(), ...buildStep11Fixture()], emptyState());
    const flow = deriveFlow(s, 'L1');
    expect(flow.steps.map((x) => x.kindIds[0])).toEqual(['peer', 'consultant']);
    expect(flow.steps.every((x) => !x.checkpoint)).toBe(true);
  });
});
