import {
  commands, deriveKinds, derivePassage, emptyLanguageState, flowTemplate, foldLanguage, HlcClock, instantiateFlow, recordTimeline,
  type AnyEvent, type EventPayloads, type EventType
} from '@langquest-next/core';
import { describeEntry, elseChoices, kindCleared, openCheckFor } from '../src/passage/recordTextModel';
import { teamSteps, type PathInput } from '../src/passage/pathModel';

/**
 * What the passage record offers beside its step sheet: the main button's
 * check for someone who was not asked, "Something else?"'s choices, and how
 * a checkpoint reads on the path (docs/ui-test-suite PASS-004, 027, 053, 054,
 * 057), against the Standard Bible Flow (peer + bt, community, consultant
 * checkpoint, final).
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
  const state = () => foldLanguage(events, emptyLanguageState());
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.UnitAdded', { unitId: 'luk15', parentUnitId: null, kind: 'passage', label: 'Luke 15:1–10', order: 'a1' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  const passage = () => derivePassage(state(), 'luk15');
  const take = () => passage().latest!.takeId;
  run('akol', (c) => c.publishVersion({ commandId: 'v1', unitId: 'luk15', cardHashes: ['c1'], actorId: 'akol' }));
  const input = (me: string): PathInput => ({ p: passage(), kinds: deriveKinds(state()), me, name: (id) => id, when: () => 'Tuesday' });
  return { run, emit, state, passage, take, input };
}

/** Peer, back translation and community done: the passage waits at the consultant checkpoint. */
function atCheckpoint() {
  const l = language();
  l.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [l.take()], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
  l.run('ayen', (c) => c.produceContent({ commandId: 'bt1', fromTakeId: l.take(), kindId: 'bt', cards: [{ hash: 'b1', durationMs: 1000 }], via: 'app' }));
  l.run('ayen', (c) => c.recordReview({ commandId: 'r2', takeIds: [l.take()], kindId: 'community', outcome: 'looks_good', via: 'app', people: 6 }));
  return l;
}

describe('the check someone may do without being asked', () => {
  it('is the next check on someone else’s version, never the author’s own', () => {
    const l = language();
    expect(openCheckFor(l.passage(), { isAuthor: false, canReview: true })?.kindId).toBe('peer');
    expect(openCheckFor(l.passage(), { isAuthor: true, canReview: true })).toBeUndefined();
    expect(openCheckFor(l.passage(), { isAuthor: false, canReview: false })).toBeUndefined();
  });

  it('is none while feedback waits on the translator (PASS-004)', () => {
    const l = language();
    l.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [l.take()], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Too fast' }));
    expect(openCheckFor(l.passage(), { isAuthor: false, canReview: true })).toBeUndefined();
  });

  it('stays open at a checkpoint that only has a check logged afterwards (decision 72)', () => {
    const l = atCheckpoint();
    l.run('akol', (c) => c.recordReview({ commandId: 'r3', takeIds: [l.take()], kindId: 'consultant', outcome: 'looks_good', via: 'logged' }));
    const p = l.passage();
    const consultant = p.steps[2]!.kinds[0]!;
    expect(consultant.state).toBe('approved');
    expect(kindCleared(consultant, p.steps[2]!)).toBe(false);
    expect(openCheckFor(p, { isAuthor: false, canReview: true })?.kindId).toBe('consultant');
  });
});

describe('Something else?', () => {
  it('offers asking only while nobody has been asked (PASS-027)', () => {
    const l = language();
    l.run('akol', (c) => c.ask({ commandId: 'a1', unitId: 'luk15', what: 'review', kindId: 'peer', profileId: 'ayen' }));
    const p = l.passage();
    const peer = p.steps[0]!.kinds[0]!;
    expect(elseChoices(peer, p.steps[0]!, { recorded: true })).toEqual({ ask: false, log: true, skip: true });
    const bt = p.steps[0]!.kinds[1]!;
    expect(elseChoices(bt, p.steps[0]!, { recorded: true })).toEqual({ ask: true, log: true, skip: true });
  });

  it('offers no Not now at a checkpoint (PASS-057), and nothing on feedback waiting for its answer', () => {
    const l = atCheckpoint();
    const p = l.passage();
    expect(elseChoices(p.steps[2]!.kinds[0]!, p.steps[2]!, { recorded: true })).toEqual({ ask: true, log: true, skip: false });
    const f = language();
    f.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [f.take()], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'x' }));
    const q = f.passage();
    expect(elseChoices(q.steps[0]!.kinds[0]!, q.steps[0]!, { recorded: true })).toEqual({ ask: false, log: false, skip: false });
  });
});

describe('a checkpoint on the path', () => {
  it('a check logged afterwards leaves it next, and Final Approval locked (PASS-053)', () => {
    const l = atCheckpoint();
    l.run('akol', (c) => c.recordReview({ commandId: 'r3', takeIds: [l.take()], kindId: 'consultant', outcome: 'looks_good', via: 'logged' }));
    const team = teamSteps(l.input('akol'));
    expect(team[3]).toMatchObject({ kindId: 'consultant', state: 'todo', status: 'next' });
    expect(team[4]).toMatchObject({ kindId: 'final', state: 'locked', status: 'after the consultant check' });
  });

  it('moved past reads "moved past", and the step after it is next (PASS-054)', () => {
    const l = atCheckpoint();
    const stepId = l.passage().steps[2]!.step.id;
    l.run('lead', (c) => c.depart({ commandId: 'o1', unitId: 'luk15', type: 'override', stepId, reason: 'Consultant visit is months away' }));
    const team = teamSteps(l.input('akol'));
    expect(team[3]).toMatchObject({ kindId: 'consultant', state: 'done', status: 'moved past' });
    expect(team[4]).toMatchObject({ kindId: 'final', state: 'todo', status: 'next' });
  });
});

describe('History', () => {
  it('names a request to a check\'s team by the team, not "a reviewer" (decision 91)', () => {
    const l = language();
    l.emit('lead', 'v1.ReviewTeamDefined', { teamId: 'check:peer', name: 'Peer check' });
    l.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'check:peer', profileId: 'ayen', member: true });
    l.run('akol', (c) => c.ask({ commandId: 'a1', unitId: 'luk15', what: 'review', kindId: 'peer', teamId: 'check:peer' }));
    const p = l.passage();
    const entry = recordTimeline(l.state(), p).find((e) => e.type === 'request')!;
    const o = { p, kinds: deriveKinds(l.state()), name: (id: string) => id, anchor: () => 'Whole passage' };
    expect(describeEntry(entry, o).title).toBe('Asked the Peer check team for Peer check');
  });
});
