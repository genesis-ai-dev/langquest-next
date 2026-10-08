import {
  commands, deriveKinds, derivePassage, emptyLanguageState, flowTemplate, foldLanguage, foldOrg, HlcClock, instantiateFlow, ORG_STREAM,
  recordTimeline, SEED_ROLES, type AnyEvent, type EventPayloads, type EventType, type OrgState, type Scope
} from '@langquest-next/core';
import {
  addDays, answeredQuestions, askCandidates, currentStepId, describeEntry, dueError, feedbackNames, gridKindIds, heroHeadline, historySummary,
  kindLineText, kindRowActions, kindRowSub, kindPathState, lastReviewOn, ledTo, madeAfter, nextQuestionType, oldKindLineText, oldStepState,
  oldStepSummary, pathState, sendTargetLabel, stepSheetSub, stepSummary, versionCaption
} from '../src/passage/record';
import { requestIsMine, sendToInput, usualTargetFor } from '../src/passage/sendTarget';
import { HIDDEN_TEXT } from '../src/moderation';

/**
 * The passage record's words and button rules (demo screens/passage.tsx),
 * read from a real event log: a translator records, reviewers review, the
 * record reads against the Standard Bible Flow (peer + bt, community,
 * consultant checkpoint, final).
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
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: null, kind: 'passage', label: 'John 3:1-21', order: 'a1' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  const passage = () => derivePassage(state(), 'john3');
  const kinds = () => deriveKinds(state());
  return { emit, run, state, passage, kinds, events };
}

/**
 * The organization around the language: the seed roles and a "Community
 * Reviewer" role, the lead an Organization Admin, akol translating and ayen
 * and deng reviewing in Dinka, plus anyone `extra` names.
 */
function team(extra: [string, string, Scope][] = []): OrgState {
  const events: AnyEvent[] = [];
  let seq = 0;
  const emit = <T extends EventType>(type: T, payload: EventPayloads[T]) => {
    seq += 1;
    events.push({ id: `o${seq}`, type, orgId: 'o', streamId: ORG_STREAM, actorId: 'lead', deviceId: 'lead',
      hlc: `${String(seq).padStart(15, '0')}:000000:lead`, payload } as AnyEvent);
  };
  for (const r of SEED_ROLES) emit('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  emit('v1.RoleDefined', { roleId: 'rev', name: 'Community Reviewer', privileges: ['review'] });
  const din: Scope = { level: 'language', languageId: 'din' };
  const members: [string, string, Scope][] = [
    ['lead', 'org_admin', { level: 'org' }], ['akol', 'translator', din], ['ayen', 'reviewer', din], ['deng', 'reviewer', din], ...extra
  ];
  for (const [profileId, roleId, scope] of members) emit('v1.MemberAdded', { profileId, roleId, scope });
  return foldOrg(events);
}

/** ctx.name as seen by `me`: the viewer is always "you". */
const nameFor = (me: string) => (id: string, lower = false) => (id === me ? (lower ? 'you' : 'You') : id.charAt(0).toUpperCase() + id.slice(1));
const name = nameFor('akol');
const record = (p: ReturnType<typeof language>, cmd: string, cards: string[], note?: string) =>
  p.run('akol', (c) => c.publishVersion({ commandId: cmd, unitId: 'john3', cardHashes: cards, ...(note ? { note } : {}) }));
const all = { review: true, ask: true, log: true, skip: true };

describe('the passage record hero', () => {
  it('says Not started, then Next with the open kinds of the first step', () => {
    const p = language();
    expect(heroHeadline(p.passage(), p.kinds(), 'akol', name)).toBe('Not started');
    record(p, 'v1', ['c1']);
    expect(heroHeadline(p.passage(), p.kinds(), 'akol', name)).toBe('Next: Peer Review + Back Translation');
  });

  it('feedback belongs to the latest version’s author: theirs to answer, everyone else waits on them', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    const take = p.passage().latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [take], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 3 is unclear' }));
    const s = p.passage();
    expect(heroHeadline(s, p.kinds(), 'akol', name)).toBe('Feedback for you to answer');
    expect(heroHeadline(s, p.kinds(), 'ayen', nameFor('ayen'))).toBe('Waiting on Akol');
    expect(heroHeadline(s, p.kinds(), 'deng', nameFor('deng'))).toBe('Waiting on Akol');
    expect(feedbackNames(s, p.kinds())).toBe('Peer Review');
  });

  it('an asked kind reads as your turn for the person asked, waiting for anyone else', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    p.run('akol', (c) => c.ask({ commandId: 'a1', unitId: 'john3', what: 'review', kindId: 'peer', profileId: 'ayen' }));
    p.run('akol', (c) => c.ask({ commandId: 'a2', unitId: 'john3', what: 'review', kindId: 'bt', profileId: 'ayen' }));
    const s = p.passage();
    expect(heroHeadline(s, p.kinds(), 'ayen', nameFor('ayen'))).toBe('Your turn: Peer Review + Back Translation');
    expect(heroHeadline(s, p.kinds(), 'deng', nameFor('deng'))).toBe('Waiting on Ayen');
    expect(pathState(s.steps[0]!, true)).toBe('waiting');
  });
});

describe('the step path', () => {
  it('marks the next step current, a checkpoint’s later steps locked, and answered feedback as answered', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    let s = p.passage();
    expect(pathState(s.steps[0]!, true)).toBe('current');
    expect(pathState(s.steps[3]!, false)).toBe('locked');
    expect(stepSheetSub(s.steps[3]!, true)).toBe('Waits for the Consultant Check checkpoint.');
    expect(stepSheetSub(s.steps[0]!, true)).toBe('2 separate pieces of work, in either order. Steps are a suggested order — you can do this now.');

    const take = s.latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [take], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Fix it' }));
    s = p.passage();
    expect(pathState(s.steps[0]!, true)).toBe('attention');
    expect(kindPathState(s.steps[0]!.kinds[0]!, s.steps[0]!, true)).toBe('attention');
    record(p, 'v2', ['c2'], 'Clearer verse 3');
    p.run('deng', (c) => c.produceContent({ commandId: 'bt1', fromTakeId: p.passage().latest!.takeId, kindId: 'bt', cards: [{ hash: 'b1', durationMs: 1000 }] }));
    s = p.passage();
    expect(kindPathState(s.steps[0]!.kinds[0]!, s.steps[0]!, false)).toBe('answered');
    expect(kindPathState(s.steps[0]!.kinds[1]!, s.steps[0]!, false)).toBe('complete');
    expect(pathState(s.steps[0]!, false)).toBe('answered');
  });
});

describe('a kind’s actions', () => {
  it('the author gets Ask as the main button, a reviewer gets Review it now; set aside is not on checkpoints', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    const s = p.passage();
    const peer = s.steps[0]!.kinds[0]!;
    const kind = p.kinds().find((k) => k.id === 'peer')!;
    const author = kindRowActions({ status: peer, kind, step: s.steps[0]!, can: all, isAuthor: true, me: 'akol' });
    expect(author.primary?.label).toBe('Ask someone');
    expect(author.second?.label).toBe('Already happened');
    expect(author.rest.map((a) => a.label)).toEqual(['Review it now', 'Set aside']);
    const reviewer = kindRowActions({ status: peer, kind, step: s.steps[0]!, can: all, isAuthor: false, me: 'ayen' });
    expect(reviewer.primary?.label).toBe('Review it now');

    const consultant = s.steps[2]!.kinds[0]!;
    const cKind = p.kinds().find((k) => k.id === 'consultant')!;
    const onCheckpoint = kindRowActions({ status: consultant, kind: cKind, step: s.steps[2]!, can: all, isAuthor: false, me: 'ayen' });
    expect([onCheckpoint.primary, onCheckpoint.second, ...onCheckpoint.rest].map((a) => a?.label)).not.toContain('Set aside');
  });

  it('a producing kind offers its own action, and says it records content, not a verdict', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    const s = p.passage();
    const bt = s.steps[0]!.kinds[1]!;
    const kind = p.kinds().find((k) => k.id === 'bt')!;
    expect(kindRowActions({ status: bt, kind, step: s.steps[0]!, can: all, isAuthor: false, me: 'ayen' }).primary?.label).toBe('Back-translate it');
    expect(kindRowSub({ status: bt, kind, step: s.steps[0]!, me: 'ayen', name, checkedBy: 'Consultant Check' }))
      .toBe('A bilingual speaker records it in English — new content, not a verdict · the Consultant Check reviews it');
  });

  it('someone asked sees Review it now; everyone else sees who it waits on and no main button', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    p.run('akol', (c) => c.ask({ commandId: 'a1', unitId: 'john3', what: 'review', kindId: 'peer', profileId: 'ayen', dueDate: '2099-01-02' }));
    const s = p.passage();
    const peer = s.steps[0]!.kinds[0]!;
    const kind = p.kinds().find((k) => k.id === 'peer')!;
    const asked = kindRowActions({ status: peer, kind, step: s.steps[0]!, can: all, isAuthor: false, me: 'ayen' });
    expect(asked.askedMe).toBe(true);
    expect(asked.primary?.label).toBe('Review it now');
    expect(kindRowSub({ status: peer, kind, step: s.steps[0]!, me: 'ayen', name: nameFor('ayen') })).toBe('Akol asked you · due Jan 2');
    const other = kindRowActions({ status: peer, kind, step: s.steps[0]!, can: all, isAuthor: false, me: 'deng' });
    expect(other.primary).toBeUndefined();
    expect(kindRowSub({ status: peer, kind, step: s.steps[0]!, me: 'deng', name: nameFor('deng') })).toBe('Waiting on Ayen · due Jan 2');
  });

  it('while feedback is open, the other kinds are best after it (advice, not a gate)', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [p.passage().latest!.takeId], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'x' }));
    const s = p.passage();
    const bt = s.steps[0]!.kinds[1]!;
    const kind = p.kinds().find((k) => k.id === 'bt')!;
    expect(kindRowSub({ status: bt, kind, step: s.steps[0]!, me: 'deng', name, waitFor: 'Peer Review' }))
      .toBe("Best after the Peer Review feedback is answered, so it's done on the version you keep");
    expect(kindRowActions({ status: bt, kind, step: s.steps[0]!, can: all, isAuthor: false, me: 'deng' }).actionable).toBe(true);
  });
});

describe('the record’s details', () => {
  it('reads each entry the demo’s way, newest first, with set-asides and their reasons', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    p.run('ayen', (c) => c.depart({ commandId: 'd1', unitId: 'john3', type: 'skip', kindId: 'bt', reason: 'Not needed for this passage' }));
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [p.passage().latest!.takeId], kindId: 'peer', outcome: 'looks_good', via: 'logged', givenBy: 'Pastor Garang' }));
    const s = p.passage();
    const t = recordTimeline(p.state(), s);
    const o = { p: s, kinds: p.kinds(), name, anchor: () => 'Whole passage' };
    expect(t.map((e) => describeEntry(e, o).title)).toEqual(['Peer Review · looks good', 'Back Translation set aside', 'Version 1 published']);
    expect(describeEntry(t[0]!, o).sub).toBe('From Pastor Garang');
    expect(describeEntry(t[0]!, o).who).toBe('Logged by Ayen');
    expect(describeEntry(t[1]!, o).sub).toBe('Not needed for this passage');
    expect(describeEntry(t[2]!, o).sub).toBe('First recording.');
    expect(historySummary(t, Date.now())).toMatch(/^3 entries since /);
    expect(gridKindIds(s)).toEqual(['peer', 'bt', 'community', 'consultant', 'final']);
  });

  it('keeps a blocked person\'s words out of the record\'s lines, and nothing else (decisions.md 48)', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    p.run('ayen', (c) => c.depart({ commandId: 'd1', unitId: 'john3', type: 'skip', kindId: 'bt', reason: 'You are useless' }));
    const s = p.passage();
    const t = recordTimeline(p.state(), s);
    const o = { p: s, kinds: p.kinds(), name, anchor: () => 'Whole passage', hidden: (id: string) => id === 'ayen' };
    expect(describeEntry(t[0]!, o).title).toBe('Back Translation set aside');
    expect(describeEntry(t[0]!, o).sub).toBe(HIDDEN_TEXT);
    expect(describeEntry(t[0]!, o).who).toBe('Ayen');
    expect(describeEntry(t[1]!, o).sub).toBe('First recording.');
  });

  it('drops a version a moderator removed, from the events remove_content redacts for it (decisions.md 48)', () => {
    const p = language();
    record(p, 'v1', ['c1'], 'First try');
    record(p, 'v2', ['c2'], 'Clearer in verse 3');
    const [gone, kept] = p.passage().versions;
    // What the server's _content_events picks for a version (migration 20260930220000).
    const holds = p.events.filter((e) => {
      const pl = e.payload as { takeId?: string; anchor?: { kind?: string; role?: string; takeId?: string } };
      return (['v1.TakeComposed', 'v1.TakeSubmitted', 'v1.ResponseRecorded'].includes(e.type) && pl.takeId === gone!.takeId)
        || (e.type === 'v1.NoteAdded' && pl.anchor?.kind === 'version' && pl.anchor.role === 'change' && pl.anchor.takeId === gone!.takeId);
    });
    expect(holds.map((e) => e.type)).toEqual(expect.arrayContaining(['v1.TakeComposed', 'v1.TakeSubmitted', 'v1.NoteAdded']));
    for (const e of holds) p.emit('lead', 'v1.Redacted', { eventId: e.id, reason: 'Removed by a moderator' });
    const s = p.passage();
    expect(s.versions.map((v) => v.takeId)).toEqual([kept!.takeId]);
    expect(s.latest?.changeNote).toBe('Clearer in verse 3');
    expect(s.drafting).toBe(false);
    expect(() => recordTimeline(p.state(), s).map((e) => describeEntry(e, { p: s, kinds: p.kinds(), name, anchor: () => '' }))).not.toThrow();
  });

  it('pairs answers with their questions and keeps answers whose question is gone', () => {
    const qs = [{ q: { id: 'q1', text: 'Is it clear?', type: 'yesno' as const }, source: 'org' as const, required: false },
      { q: { id: 'q2', text: 'How natural?', type: 'rating' as const }, source: 'request' as const, required: false }];
    expect(answeredQuestions(qs, { q1: 'yes', q2: '4', old: 'Fine' })).toEqual([
      { id: 'q1', label: 'Is it clear?', source: 'Organization', answer: 'Yes' },
      { id: 'q2', label: 'How natural?', source: 'Asked for this review', answer: '4 / 5' },
      { id: 'old', label: 'Question', answer: 'Fine' }
    ]);
  });
});

describe('asking someone', () => {
  it('lists everyone whose role covers the language with the needed permission, the usual reviewers first, never the asker', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    p.run('deng', (c) => c.recordReview({ commandId: 'r1', takeIds: [p.passage().latest!.takeId], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    const org = team([
      ['nyibol', 'rev', { level: 'language', languageId: 'din' }],
      ['elsewhere', 'rev', { level: 'language', languageId: 'other' }]
    ]);

    const review = askCandidates(p.state(), org, { languageId: 'din', what: 'review', kindId: 'peer', me: 'lead' });
    expect(review.map((c) => c.profileId).sort()).toEqual(['ayen', 'deng', 'nyibol']);
    expect(review.find((c) => c.profileId === 'deng')).toMatchObject({ usual: true, sub: 'Reviewer · Has done this here before' });
    expect(review.find((c) => c.profileId === 'nyibol')).toMatchObject({ usual: false, sub: 'Community Reviewer' });

    const rec = askCandidates(p.state(), org, { languageId: 'din', what: 'record', me: 'lead' });
    expect(rec.map((c) => c.profileId)).toEqual(['akol']);
  });

  it('puts the review group for this check first, named, when admins have put people in it', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    const org = team([['nyibol', 'rev', { level: 'language', languageId: 'din' }]]);
    const state = p.state();
    const reg = <T,>(value: T) => ({ value, hlc: '0', eventId: 'e' });
    state.teams['t1'] = { name: reg('Community group'), members: { nyibol: reg(true) }, kindId: reg('peer') } as never;
    const review = askCandidates(state, org, { languageId: 'din', what: 'review', kindId: 'peer', me: 'lead' });
    expect(review[0]).toMatchObject({ profileId: 'nyibol', usual: true, sub: 'Community Reviewer · In Community group' });
    const other = askCandidates(state, org, { languageId: 'din', what: 'review', kindId: 'consultant', me: 'lead' });
    expect(other.find((c) => c.profileId === 'nyibol')?.sub).toBe('Community Reviewer · On the review team');
  });

  it('takes a due date from today on, written as YYYY-MM-DD', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(dueError('', '2026-09-28')).toBeNull();
    expect(dueError('2026-09-28', '2026-09-28')).toBeNull();
    expect(dueError('2026-09-27', '2026-09-28')).toBe('Pick today or a later day.');
    expect(dueError('2026-02-30', '2026-01-01')).toBe('That date does not exist.');
    expect(dueError('Oct 7', '2026-09-28')).toMatch(/YYYY-MM-DD/);
    expect(nextQuestionType('yesno')).toBe('text');
    expect(nextQuestionType('text')).toBe('rating');
    expect(nextQuestionType('rating')).toBe('yesno');
  });
});

describe('sending to the usual reviewer (ADR-029)', () => {
  it('the author’s main button sends to whoever usually does it, with Send to someone else beside it', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    const s = p.passage();
    const peer = s.steps[0]!.kinds[0]!;
    const kind = p.kinds().find((k) => k.id === 'peer')!;
    const acts = kindRowActions({ status: peer, kind, step: s.steps[0]!, can: all, isAuthor: true, me: 'akol', sendTo: 'the Peer team' });
    expect(acts.primary).toEqual({ id: 'send', label: 'Send to the Peer team' });
    expect(acts.second).toEqual({ id: 'ask', label: 'Send to someone else' });
    expect(acts.rest.map((a) => a.label)).toEqual(['Review it now', 'Already happened', 'Set aside']);
    // Nobody usually does it: Ask someone, as before. A reviewer still reviews it now.
    expect(kindRowActions({ status: peer, kind, step: s.steps[0]!, can: all, isAuthor: true, me: 'akol' }).primary?.label).toBe('Ask someone');
    expect(kindRowActions({ status: peer, kind, step: s.steps[0]!, can: all, isAuthor: false, me: 'ayen', sendTo: 'Deng' }).primary?.label).toBe('Review it now');
    expect(sendTargetLabel({ teamId: 't', name: 'Community' }, name)).toBe('the Community team');
    expect(sendTargetLabel({ profileId: 'ayen' }, name)).toBe('Ayen');
  });

  it('finds the one person who reviewed this kind here, and sends to them in one command', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    expect(usualTargetFor(p.state(), team(), { languageId: 'din', kindId: 'peer', me: 'akol' })).toBeUndefined();
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [p.passage().latest!.takeId], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    const target = usualTargetFor(p.state(), team(), { languageId: 'din', kindId: 'peer', me: 'akol' });
    expect(target).toEqual({ profileId: 'ayen' });
    // Who may review comes from the organization's roles: with none loaded, nobody does.
    expect(usualTargetFor(p.state(), null, { languageId: 'din', kindId: 'peer', me: 'akol' })).toBeUndefined();
    record(p, 'v2', ['c2'], 'Clearer');
    p.run('akol', (c) => c.ask(sendToInput({ commandId: 's1', unitId: 'john3', kindId: 'peer', target: target! })));
    const sent = p.passage().openRequests.find((r) => r.kindId === 'peer')!;
    expect(sent).toMatchObject({ profileId: 'ayen', by: 'akol', what: 'review' });
    expect(requestIsMine(p.state(), 'ayen')(sent)).toBe(true);
    expect(requestIsMine(p.state(), 'deng')(sent)).toBe(false);
  });
});

describe('the journey (REC-2, REC-2a, ADR-030)', () => {
  it('opens on the next step, or on the step whose feedback waits for an answer', () => {
    const p = language();
    expect(currentStepId(p.passage())).toBeUndefined();
    record(p, 'v1', ['c1']);
    expect(currentStepId(p.passage())).toBe(p.passage().steps[0]!.step.id);
    p.run('deng', (c) => c.produceContent({ commandId: 'bt1', fromTakeId: p.passage().latest!.takeId, kindId: 'bt', cards: [{ hash: 'b1', durationMs: 1000 }] }));
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [p.passage().latest!.takeId], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 3' }));
    const s = p.passage();
    expect(currentStepId(s)).toBe(s.steps[0]!.step.id);
    expect(stepSummary(s.steps[0]!, p.kinds(), name)).toBe('Peer: Needs changes · Back Translation: Looks good');
    expect(stepSummary(s.steps[3]!, p.kinds(), name)).toBe('Starts after the Consultant Check checkpoint');
  });

  it('flips between versions: what each heard, which version answered it, and what a version was made after', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    const first = p.passage().latest!;
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [first.takeId], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Fix it' }));
    record(p, 'v2', ['c2'], 'Clearer verse 3');
    const s = p.passage();
    expect(versionCaption(1, 2)).toBe('Latest of 2');
    expect(versionCaption(0, 2)).toBe('Older · 1 newer');
    expect(versionCaption(0, 1)).toBe('Recorded');
    const heard = lastReviewOn(s, 'peer', 1);
    expect(heard?.comment).toBe('Fix it');
    expect(lastReviewOn(s, 'peer', 2)).toBeUndefined();
    expect(oldKindLineText(heard, p.kinds().find((k) => k.id === 'peer'), name)).toBe('Needs changes · Ayen');
    expect(oldKindLineText(undefined, undefined, name)).toBe('Not reviewed on this version');
    expect(oldStepSummary(['peer', 'bt'], [heard, undefined], p.kinds())).toBe('Peer: Needs changes · Back Translation: Not reviewed');
    expect(oldStepState([heard])).toBe('answered');
    expect(ledTo(s, heard!)?.n).toBe(2);
    expect(madeAfter(s, s.latest!).map((r) => r.id)).toEqual([heard!.id]);
    expect(madeAfter(s, first)).toEqual([]);
    expect(oldStepState([undefined])).toBe('todo');
  });

  it('a kind’s line says who and on which version, and who it waits on', () => {
    const p = language();
    record(p, 'v1', ['c1']);
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [p.passage().latest!.takeId], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    record(p, 'v2', ['c2'], 'Clearer');
    p.run('akol', (c) => c.ask({ commandId: 'a1', unitId: 'john3', what: 'review', kindId: 'bt', profileId: 'deng', dueDate: '2099-01-02' }));
    const s = p.passage();
    expect(kindLineText(s.steps[0]!.kinds[0]!, s.steps[0]!, s, name)).toBe('Looks good · Ayen on Version 1');
    expect(kindLineText(s.steps[0]!.kinds[1]!, s.steps[0]!, s, name)).toBe('Waiting on Deng · due Jan 2');
    expect(kindLineText(s.steps[1]!.kinds[0]!, s.steps[1]!, s, name)).toBe('Not yet');
  });
});
