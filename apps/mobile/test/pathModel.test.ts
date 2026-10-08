import {
  commands, deriveKinds, derivePassage, emptyLanguageState, flowTemplate, foldLanguage, HlcClock, instantiateFlow,
  type AnyEvent, type EventPayloads, type EventType
} from '@langquest-next/core';
import { checkPhrase, pathSteps, teamSteps, type PathInput } from '../src/passage/pathModel';

/**
 * The passage path (decision 71, demo ADR-033), read from a real event log:
 * the recording's own steps, then the team's checks of the Standard Bible
 * Flow (peer + bt, community, consultant checkpoint, final).
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
  emit('lead', 'v1.UnitAdded', { unitId: 'luk15', parentUnitId: null, kind: 'passage', label: 'Luke 15:1–7', order: 'a1' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  const record = (actorId: string, hash: string, note?: string) => {
    emit(actorId, 'v1.RecordingAdded', { recordingId: `r-${hash}`, unitId: 'luk15', kind: 'target', cards: [{ hash, durationMs: 84_000, format: 'wav' }] });
    run(actorId, (c) => c.publishVersion({ commandId: `p-${hash}`, unitId: 'luk15', cardHashes: [hash], actorId, ...(note ? { note } : {}) }));
  };
  const input = (me: string, extra: Partial<PathInput> = {}): PathInput => ({
    p: derivePassage(state(), 'luk15'), kinds: deriveKinds(state()), me,
    name: (id) => ({ akol: 'Akol', ayen: 'Ayen', lead: 'Mary' })[id] ?? id,
    when: () => 'Tuesday', ...extra
  });
  return { emit, run, state, record, input };
}

const shape = (steps: ReturnType<typeof pathSteps>) => steps.map((s) => `${s.kind}:${s.state}`);

describe('the passage path (decision 71)', () => {
  it('before anything is recorded: Record is lit, Publish waits, and the team waits for the version', () => {
    const l = language();
    const steps = pathSteps(l.input('akol'));
    expect(shape(steps)).toEqual(['record:current', 'publish:todo']);
    expect(steps[1]!.sub).toBe('Then ask for the peer review');
    const team = teamSteps(l.input('akol'));
    expect(team.map((t) => `${t.name}|${t.status}`)).toEqual([
      'Peer Review + Back Translation|after you publish',
      'Community Check|after the peer review',
      'Consultant Check|after the community check',
      'Final Approval|after the consultant check'
    ]);
    expect(team[2]!.checkpoint).toBe(true);
  });

  it('a study guide with steps comes first, and stays lit until it is done or someone records', () => {
    const l = language();
    const study = { name: 'FIA guide', total: 6, done: 2 };
    let steps = pathSteps(l.input('akol', { study }));
    expect(shape(steps)).toEqual(['study:current', 'record:todo', 'publish:todo']);
    expect(steps[0]!.sub).toBe('FIA guide · 2 of 6 steps');
    steps = pathSteps(l.input('akol', { study: { ...study, done: 6 } }));
    expect(shape(steps)).toEqual(['study:done', 'record:current', 'publish:todo']);
    expect(steps[0]!.sub).toBe('FIA guide · done');
    l.record('akol', 'h1');
    // Recorded without finishing the study: the study was advice, so it is passed, not lit.
    expect(shape(pathSteps(l.input('akol', { study })))).toEqual(['study:passed', 'record:done', 'publish:done']);
  });

  it('a guide with no steps adds nothing', () => {
    const l = language();
    expect(shape(pathSteps(l.input('akol', { study: { name: 'Notes', total: 0, done: 0 } })))).toEqual(['record:current', 'publish:todo']);
  });

  it('who asked and by when goes on the Record step', () => {
    const l = language();
    l.run('lead', (c) => c.ask({ commandId: 'a1', unitId: 'luk15', what: 'record', profileId: 'akol', dueDate: '2026-10-11' }));
    const steps = pathSteps(l.input('akol', { due: (iso) => `due ${iso.slice(5)}` }));
    expect(steps[0]!.sub.startsWith('Mary asked you · due 10-11.')).toBe(true);
  });

  it('after publishing, Record says the version and its length; Publish says when and who was asked', () => {
    const l = language();
    l.record('akol', 'h1');
    l.run('akol', (c) => c.ask({ commandId: 'a2', unitId: 'luk15', what: 'review', kindId: 'peer', profileId: 'ayen' }));
    const steps = pathSteps(l.input('akol', { latestSeconds: 84 }));
    expect(shape(steps)).toEqual(['record:done', 'publish:done']);
    expect(steps[0]!.sub).toBe('Version 1 · 1:24');
    expect(steps[1]!.sub).toBe('Published Tuesday · asked Ayen');
    expect(teamSteps(l.input('akol'))[0]).toMatchObject({ state: 'waiting', status: 'asked Ayen' });
  });

  it('feedback that needs changes lights Hear the feedback, then Fix it, and the check says needs changes', () => {
    const l = language();
    l.record('akol', 'h1');
    const takeId = derivePassage(l.state(), 'luk15').latest!.takeId;
    l.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [takeId], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 4 is hard to follow.' }));
    const steps = pathSteps(l.input('akol'));
    expect(shape(steps)).toEqual(['record:done', 'publish:done', 'feedback:current', 'fix:todo']);
    expect(steps[2]!.sub).toBe('Peer Review · needs changes');
    expect(steps[2]!.review?.comment).toBe('Verse 4 is hard to follow.');
    expect(teamSteps(l.input('akol'))[0]).toMatchObject({ state: 'attention', status: 'needs changes' });
    // A new version answers it: the path is the recording's again.
    l.record('akol', 'h2', 'Said verse 4 more simply.');
    expect(shape(pathSteps(l.input('akol')))).toEqual(['record:done', 'publish:done']);
    expect(pathSteps(l.input('akol'))[0]!.sub).toBe('Version 2');
  });

  it('a check that passed says so, and the next one is next', () => {
    const l = language();
    l.record('akol', 'h1');
    const takeId = derivePassage(l.state(), 'luk15').latest!.takeId;
    l.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [takeId], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    l.run('ayen', (c) => c.depart({ commandId: 'd1', unitId: 'luk15', type: 'skip', kindId: 'bt', reason: 'No bilingual speaker yet.' }));
    const team = teamSteps(l.input('akol'));
    expect(team[0]).toMatchObject({ state: 'done', status: 'looks good' });
    expect(team[1]).toMatchObject({ state: 'todo', status: 'next' });
    expect(team[2]).toMatchObject({ status: 'after the community check' });
  });

  it('says a check in a sentence', () => {
    expect(checkPhrase('Community Check')).toBe('the community check');
  });
});
