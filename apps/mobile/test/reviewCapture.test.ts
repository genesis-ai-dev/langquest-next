import { languageLines } from '@langquest-next/core';
import {
  commands, derivePassage, deriveKinds, emptyLanguageState, flowTemplate, foldLanguage, HlcClock, instantiateFlow,
  type AnyEvent, type EventPayloads, type EventType, type SourcedQuestion
} from '@langquest-next/core';
import {
  canLeave, cleanAnswers, cleanSkips, clockMs, earlierReviews, firstOpenAt, footHint, isGroupKind, kindLabel, listenLine,
  clockToMs, momentIn, noteAnchorText, nextLabel, openRequired, partAt, questionSource, readiness, replyAnchor, requestFor, reviewCapture, reviewStages,
  stageAt, stageBack, summaryLine, toCompareFor, verdictQuestion, versionFor
} from '../src/reviewing/capture';

/** A small language on the Standard Bible Flow, with a few passages of John and one of Mark. */
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
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'a' });
  const chapters = [1, 2, 3, 4, 5, 6, 9];
  chapters.forEach((ch, i) => emit('lead', 'v1.UnitAdded', { unitId: `john${ch}`, parentUnitId: 'john', kind: 'passage', label: `John ${ch}:1-20`, order: `a${i}` }));
  emit('lead', 'v1.UnitAdded', { unitId: 'mark2', parentUnitId: null, kind: 'passage', label: 'Mark 2:1-12', order: 'b' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  const publish = (unitId: string, cards: string[], note?: string) =>
    run('akol', (c) => c.publishVersion({ commandId: `v-${unitId}-${cards.join('')}`, unitId, cardHashes: cards, ...(note ? { note } : {}) }));
  return { emit, run, state, publish };
}

const q = (id: string, required: boolean, source: SourcedQuestion['source'] = 'language'): SourcedQuestion =>
  ({ q: { id, text: id, type: 'yesno', ...(required ? { required } : {}) }, source, required });

describe('what a review hears and answers', () => {
  it('hears the version named, else the latest', () => {
    const p = language();
    p.publish('john3', ['a']);
    p.publish('john3', ['b'], 'Fixed verse 2.');
    const s = derivePassage(p.state(), 'john3');
    expect(versionFor(s)?.n).toBe(2);
    expect(versionFor(s, s.versions[0]!.takeId)?.n).toBe(1);
    expect(versionFor(s, 'nope')?.n).toBe(2);
  });

  it('answers the request made to you before one made to someone else; a logged session closes only yours', () => {
    const p = language();
    p.publish('john3', ['a']);
    p.run('lead', (c) => c.ask({ commandId: 'r-other', unitId: 'john3', what: 'review', kindId: 'community', profileId: 'akol' }));
    p.run('lead', (c) => c.ask({ commandId: 'r-me', unitId: 'john3', what: 'review', kindId: 'community', profileId: 'peter' }));
    const s = derivePassage(p.state(), 'john3');
    expect(requestFor(s, 'community', 'peter')?.id).toBe('req:r-me');
    expect(requestFor(s, 'community', 'lead')?.id).toBe('req:r-other');
    expect(requestFor(s, 'community', 'lead', { mineOnly: true })).toBeUndefined();
    expect(requestFor(s, 'community', 'lead', { requestId: 'req:r-me' })?.id).toBe('req:r-me');
    expect(requestFor(s, 'peer', 'peter')).toBeUndefined();
  });

  it('puts the back translation in front of the consultant, not among earlier reviews (REV-5)', () => {
    const p = language();
    p.publish('john3', ['a']);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('peter', (c) => c.recordReview({ commandId: 'peer', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    p.run('peter', (c) => c.produceContent({ commandId: 'bt', fromTakeId: v1, kindId: 'bt', cards: [{ hash: 'bt1', durationMs: 3000 }] }));
    const state = p.state();
    const s = derivePassage(state, 'john3');
    const kinds = deriveKinds(state);
    expect(toCompareFor(s, kinds, 'consultant')?.artifacts?.map((c) => c.hash)).toEqual(['bt1']);
    expect(earlierReviews(s, kinds, 'consultant').map((r) => r.kindId)).toEqual(['peer']);
    // Other kinds have nothing to compare; the back translation is ordinary background for them.
    expect(toCompareFor(s, kinds, 'community')).toBeUndefined();
    expect(earlierReviews(s, kinds, 'community').map((r) => r.kindId)).toEqual(['bt', 'peer']);
  });
});

describe('before an outcome can be sent (REV-2, REV-3)', () => {
  const questions = [q('a', true), q('b', true), q('c', false)];

  it('a required question needs an answer or a reason', () => {
    expect(openRequired(questions, {}, {}).map((x) => x.q.id)).toEqual(['a', 'b']);
    expect(openRequired(questions, { a: 'Yes', b: '  ' }, {}).map((x) => x.q.id)).toEqual(['b']);
    expect(openRequired(questions, { a: 'Yes' }, { b: 'Ran out of time in the session' })).toEqual([]);
  });

  it('Looks good needs every required question handled; Needs changes also needs what to change', () => {
    const blocked = readiness(questions, { a: 'Yes' }, {}, '', null);
    expect(blocked).toEqual({ open: 1, ready: false, saysWhat: false });
    expect(footHint(blocked)).toBe('1 required question left — answer, or say why not');
    const ready = readiness(questions, { a: 'Yes', b: 'No' }, {}, '', null);
    expect(footHint(ready)).toBe('To ask for changes, say what to change above');
    expect(readiness(questions, { a: 'Yes', b: 'No' }, {}, '', 'voice').saysWhat).toBe(true);
    expect(footHint(readiness(questions, { a: 'Yes', b: 'No' }, {}, 'Verse 3 is unclear', null))).toBeNull();
    expect(footHint(ready, { what: 'back translation', has: false })).toBe('Record the back translation.');
    expect(footHint(ready, { what: 'back translation', has: true })).toBeNull();
  });

  it('saves only real answers, and skips only for questions still unanswered', () => {
    expect(cleanAnswers(questions, { a: ' Yes ', b: '', gone: 'x' })).toEqual({ a: 'Yes' });
    expect(cleanAnswers(questions, { b: ' ' })).toBeUndefined();
    expect(cleanSkips(questions, { a: 'Yes' }, { a: 'old reason', b: 'Not relevant' })).toEqual({ b: 'Not relevant' });
    expect(cleanSkips(questions, {}, {})).toBeUndefined();
  });

  it('labels questions by where they come from', () => {
    expect(questionSource(q('x', false, 'language'))).toBe('Language team');
    expect(questionSource(q('x', false, 'request'), 'Mary')).toBe('From Mary');
  });

  it('names what a note is about', () => {
    const look = { term: (id: string) => (id === 't1' ? 'Shepherd' : undefined), versionN: (id: string) => (id === 'tk' ? 2 : undefined) };
    expect(noteAnchorText({ kind: 'passage' }, look)).toBe('Whole passage');
    expect(noteAnchorText({ kind: 'verse', verse: '4' }, look)).toBe('Verse 4');
    expect(noteAnchorText({ kind: 'term', termId: 't1' }, look)).toBe('Key term · Shepherd');
    expect(noteAnchorText({ kind: 'version', takeId: 'tk' }, look)).toBe('Version 2');
  });
});

describe('a session that already happened (REV-6), on its one passage (decision 128)', () => {
  it('asks how many listened for a group kind, and who for the rest', () => {
    expect(isGroupKind('community')).toBe(true);
    expect(isGroupKind('retell')).toBe(true);
    expect(isGroupKind('consultant')).toBe(false);
  });
});

describe('reviewing is three short steps: Listen, Questions, Decide (REV-0, SIMPLE-10)', () => {
  const labels = (o: Parameters<typeof reviewStages>[0]) => reviewStages(o).map((x) => x.label);

  it('Listen, Questions, Decide; Questions left out when there are none', () => {
    expect(labels({ questions: 2, logged: false, makes: false })).toEqual(['Listen', 'Questions', 'Decide']);
    expect(labels({ questions: 0, logged: false, makes: false })).toEqual(['Listen', 'Decide']);
    expect(reviewStages({ questions: 2, logged: false, makes: false }).map((x) => x.icon)).toEqual(['listen', 'help', 'check']);
  });

  it('a session that already happened decides the same way; a kind that makes content ends in Record it', () => {
    expect(labels({ questions: 1, logged: true, makes: false })).toEqual(['Listen', 'Questions', 'Decide']);
    expect(labels({ questions: 0, logged: true, makes: true })).toEqual(['Listen', 'Record it']);
  });

  it('the main button names the next step, and a step that went away falls back to Listen', () => {
    const stages = reviewStages({ questions: 1, logged: false, makes: false });
    expect(stages.slice(1).map(nextLabel)).toEqual(['Next: questions', 'Next: decide']);
    expect(stageAt(stages, 'decide')).toBe(2);
    expect(stageAt(reviewStages({ questions: 0, logged: false, makes: false }), 'questions')).toBe(0);
  });

  it("a phone's Back goes one step back: the question before, the stage before, and leaves only from Listen (decision 137)", () => {
    const stages = reviewStages({ questions: 3, logged: false, makes: false });
    expect(stageBack(stages, 'decide', 0, 3)).toEqual({ stage: 'questions', qi: 2 });
    expect(stageBack(stages, 'questions', 2, 3)).toEqual({ stage: 'questions', qi: 1 });
    expect(stageBack(stages, 'questions', 0, 3)).toEqual({ stage: 'listen', qi: 0 });
    expect(stageBack(stages, 'listen', 0, 3)).toBeNull();
    const none = reviewStages({ questions: 0, logged: true, makes: true });
    expect(stageBack(none, 'decide', 0, 0)).toEqual({ stage: 'listen', qi: 0 });
    // Its questions went while it was open: it stands on Listen, so Back leaves.
    expect(stageBack(none, 'questions', 2, 0)).toBeNull();
  });

  it('a collapsed card says only what it has', () => {
    expect(summaryLine(['Where', 'Version 2 (latest)', false, undefined, 'Retelling'])).toBe('Where · Version 2 (latest) · Retelling');
    expect(summaryLine([false, null])).toBe('');
  });

  it('kinds read in sentence case under the passage, abbreviations kept', () => {
    expect(kindLabel('Community Check')).toBe('Community check');
    expect(kindLabel('Peer Review')).toBe('Peer review');
    expect(kindLabel('FIA Check')).toBe('FIA check');
    expect(kindLabel('Retell Check by FCBH')).toBe('Retell check by FCBH');
  });

  it('Decide asks the kind’s own question, and anything else asks whether it is clear', () => {
    expect(verdictQuestion('community')).toBe('Is it clear?');
    expect(verdictQuestion('consultant')).toBe('Does it carry the meaning?');
    expect(verdictQuestion('a-custom-kind')).toBe('Is it clear?');
    expect(listenLine('community', false)).toBe('Play it for the group');
    expect(listenLine('peer', false)).toBe('Listen to all of it first');
    expect(listenLine('peer', true)).toBe('The version that was played');
  });
});

describe('one question per screen (SIMPLE-10)', () => {
  const q = (id: string, required: boolean, type: 'text' | 'yesno' = 'text'): SourcedQuestion => ({ q: { id, text: id, type }, source: 'request', required });
  const clip = { hash: 'h1', durationMs: 14_200, format: 'm4a' as const };

  it('a required question is left only when answered, said aloud, or set aside with a reason', () => {
    expect(canLeave(q('a', false), {}, {}, {})).toBe(true);
    expect(canLeave(q('a', true), {}, {}, {})).toBe(false);
    expect(canLeave(q('a', true), { a: '  ' }, {}, {})).toBe(false);
    expect(canLeave(q('a', true), { a: 'Yes' }, {}, {})).toBe(true);
    expect(canLeave(q('a', true), {}, {}, { a: clip })).toBe(true);
    expect(canLeave(q('a', true), {}, { a: 'Ran out of time' }, {})).toBe(true);
  });

  it('Decide sends the reviewer back to the first required question still open', () => {
    const qs = [q('a', false), q('b', true), q('c', true)];
    expect(firstOpenAt(qs, {}, {}, {})).toBe(1);
    expect(firstOpenAt(qs, { b: 'x' }, {}, {})).toBe(2);
    expect(firstOpenAt(qs, { b: 'x' }, { c: 'why' }, {})).toBe(-1);
  });

  it('an answer said aloud is a recording of the review, named by its answer; moments and the retelling follow', () => {
    const qs = [q('who', true), q('clear', false, 'yesno'), q('more', false)];
    const out = reviewCapture({
      questions: qs, answers: { clear: 'Yes', more: 'The shepherd' },
      voice: { who: clip, more: { hash: 'h2', durationMs: 3000, format: 'wav' } },
      moments: [{ hash: 'm2', durationMs: 2000, format: 'm4a', atMs: 61_000.6 }, { hash: 'm1', durationMs: 1000, format: 'm4a', atMs: 4200 }],
      evidence: { hash: 'r1', durationMs: 30_000, format: 'm4a' }
    });
    expect(out.answers).toEqual({ who: 'Said aloud · 0:14 · recording 1', clear: 'Yes', more: 'The shepherd (said aloud · 0:03 · recording 2)' });
    expect(out.artifacts).toEqual([
      { hash: 'h1', durationMs: 14_200, format: 'm4a' }, { hash: 'h2', durationMs: 3000, format: 'wav' },
      { hash: 'm1', durationMs: 1000, format: 'm4a', atMs: 4200 }, { hash: 'm2', durationMs: 2000, format: 'm4a', atMs: 61_001 },
      { hash: 'r1', durationMs: 30_000, format: 'm4a' }
    ]);
    expect(clockMs(61_000)).toBe('1:01');
  });

  it('nothing said aloud adds nothing', () => {
    expect(reviewCapture({ questions: [q('a', false)], answers: { a: 'ok' }, voice: {}, moments: [], evidence: null }))
      .toEqual({ answers: { a: 'ok' }, artifacts: [] });
  });
});

describe('notes on what a check shows (decisions.md 149)', () => {
  const look = { term: () => 'shepherd', versionN: () => 2, partN: (_t: string, h: string) => (h === 'c2' ? 2 : undefined), help: () => 'What to listen for', author: () => 'Akol' };

  it('the player\'s note goes on the part playing, at that moment in it', () => {
    expect(partAt([3000, 3000, 3000], 4200)).toEqual({ index: 1, atMs: 1200 });
    expect(partAt([3000, 3000, 3000], 0)).toEqual({ index: 0, atMs: 0 });
    // Past the end: the last part, at its end.
    expect(partAt([3000, 3000], 9000)).toEqual({ index: 1, atMs: 3000 });
    // Lengths not known yet: the first part.
    expect(partAt([0, 0], 2500)).toEqual({ index: 0, atMs: 2500 });
  });

  it('says what each note is on', () => {
    expect(noteAnchorText({ kind: 'version', takeId: 't', part: 'c2', at: '0:04' }, look)).toBe('Part 2 · 0:04');
    expect(noteAnchorText({ kind: 'version', takeId: 't', part: 'gone' }, look)).toBe('A part');
    expect(noteAnchorText({ kind: 'passage', help: 'material:m' }, look)).toBe('“What to listen for”');
    expect(noteAnchorText({ kind: 'term', termId: 'k', replyTo: 'note:n' }, look)).toBe('Reply to Akol');
    expect(noteAnchorText({ kind: 'version', takeId: 't' }, look)).toBe('Version 2');
  });

  it('a note on a part reads back as the moment in the whole version the reviewer heard', () => {
    const lengths = new Map([['p1', 3000], ['p2', 3000], ['p3', 3000]]);
    expect(clockToMs('0:04')).toBe(4000);
    expect(clockToMs('1:02:05')).toBe(3_725_000);
    expect(clockToMs('soon')).toBeNull();
    expect(momentIn(['p1', 'p2', 'p3'], lengths, 'p2', '0:01')).toBe(4000);
    expect(momentIn(['p1', 'p2', 'p3'], lengths, 'p3', undefined)).toBe(6000);
    expect(momentIn(['p1', 'p2'], lengths, 'p3', '0:01')).toBeNull();
    // And back: the player's moment is the part and the time in it.
    const at = partAt([3000, 3000, 3000], 4000);
    expect(momentIn(['p1', 'p2', 'p3'], lengths, ['p1', 'p2', 'p3'][at.index]!, clockMs(at.atMs))).toBe(4000);
  });

  it('a reply is on what its note is on, answering that note', () => {
    expect(replyAnchor({ id: 'note:b', anchor: { kind: 'verse', verse: '3:16', replyTo: 'note:a' } })).toEqual({ kind: 'verse', verse: '3:16', replyTo: 'note:b' });
  });
});
