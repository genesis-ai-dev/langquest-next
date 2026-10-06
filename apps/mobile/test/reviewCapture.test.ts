import {
  commands, derivePassage, deriveKinds, emptyLanguageState, flowTemplate, foldLanguage, HlcClock, instantiateFlow,
  type AnyEvent, type EventPayloads, type EventType, type SourcedQuestion
} from '@langquest-next/core';
import {
  cleanAnswers, cleanSkips, earlierReviews, footHint, isGroupKind, loggedTargets, matchesQuery, nearbyPassages, noteAnchorText,
  nextLabel, openRequired, questionSource, readiness, recordedPassages, requestFor, reviewStages, searchPassages, stageAt, summaryLine,
  toCompareFor, versionFor
} from '../src/reviewing/capture';
import { parseQuery } from '../src/canon';

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
    expect(questionSource(q('x', false, 'org'))).toBe('Organization');
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

describe('a session that already happened (REV-6)', () => {
  it('asks how many listened for a group kind, and who for the rest', () => {
    expect(isGroupKind('community')).toBe(true);
    expect(isGroupKind('retell')).toBe(true);
    expect(isGroupKind('consultant')).toBe(false);
  });

  it('suggests the nearest recorded passages in the same book, and searches for the rest', () => {
    const p = language();
    for (const u of ['john1', 'john2', 'john3', 'john4', 'john5', 'john9', 'mark2']) p.publish(u, [`c-${u}`]);
    const all = recordedPassages(p.state());
    expect(all.map((x) => x.unitId)).toEqual(['mark2', 'john1', 'john2', 'john3', 'john4', 'john5', 'john9']); // canon order: Mark before John
    const here = all.find((x) => x.unitId === 'john3')!;
    expect(nearbyPassages(all, here).map((x) => x.unitId)).toEqual(['john1', 'john2', 'john4', 'john5']);
    expect(searchPassages(all, 'Mark 2', 'john3').map((x) => x.unitId)).toEqual(['mark2']);
    expect(searchPassages(all, 'joh 9', 'john3').map((x) => x.unitId)).toEqual(['john9']);
    expect(searchPassages(all, 'john', 'john3')).toHaveLength(5);
    expect(searchPassages(all, '', 'john3')).toEqual([]);
    expect(parseQuery('1 Cor 13:4')).toEqual({ book: '1 cor', chapter: 13 });
    expect(parseQuery('1 cor 13:4-6')).toEqual({ book: '1 cor', chapter: 13 });
    expect(matchesQuery(here, 'luke')).toBe(false);
    // Same parsing as the Map: a verse range still finds the chapter, and a bare number is a book prefix.
    expect(searchPassages(all, 'john 9:1-5', 'john3').map((x) => x.unitId)).toEqual(['john9']);
    expect(searchPassages(all, '1', 'john3')).toEqual([]);
    expect(matchesQuery(here, 'jn')).toBe(false);
  });

  it('leaves out passages with no version, and caches the list per state', () => {
    const p = language();
    p.publish('john3', ['a']);
    const state = p.state();
    expect(recordedPassages(state).map((x) => x.unitId)).toEqual(['john3']);
    expect(recordedPassages(state)).toBe(recordedPassages(state));
  });

  it('saves to the version played here and the latest version of each other passage picked', () => {
    const p = language();
    p.publish('john3', ['a']);
    p.publish('john3', ['b'], 'Second.');
    p.publish('john4', ['c']);
    const state = p.state();
    const here = derivePassage(state, 'john3');
    const first = here.versions[0]!.takeId;
    const other = derivePassage(state, 'john4').latest!.takeId;
    expect(loggedTargets(state, { unitId: 'john3', takeId: first }, ['john4', 'john5', 'john3']))
      .toEqual([{ unitId: 'john3', takeId: first }, { unitId: 'john4', takeId: other }]);
  });
});

describe('reviewing is three short stages (REV-0, ADR-029)', () => {
  const labels = (o: Parameters<typeof reviewStages>[0]) => reviewStages(o).map((x) => x.label);

  it('Listen, Questions, Your verdict; Questions left out when there are none', () => {
    expect(labels({ questions: 2, logged: false, makes: false })).toEqual(['Listen', 'Questions', 'Your verdict']);
    expect(labels({ questions: 0, logged: false, makes: false })).toEqual(['Listen', 'Your verdict']);
  });

  it('the last stage is named for what it holds when the review already happened', () => {
    expect(labels({ questions: 1, logged: true, makes: false })).toEqual(['Listen', 'Questions', 'What happened']);
    expect(labels({ questions: 0, logged: true, makes: true })).toEqual(['Listen', 'Record it']);
  });

  it('the main button names the next stage, and a stage that went away falls back to Listen', () => {
    const stages = reviewStages({ questions: 1, logged: false, makes: false });
    expect(stages.slice(1).map(nextLabel)).toEqual(['Next: questions', 'Next: your verdict']);
    expect(stageAt(stages, 'verdict')).toBe(2);
    expect(stageAt(reviewStages({ questions: 0, logged: false, makes: false }), 'questions')).toBe(0);
  });

  it('a collapsed card says only what it has', () => {
    expect(summaryLine(['Where', 'Version 2 (latest)', false, undefined, 'Retelling'])).toBe('Where · Version 2 (latest) · Retelling');
    expect(summaryLine([false, null])).toBe('');
  });
});
