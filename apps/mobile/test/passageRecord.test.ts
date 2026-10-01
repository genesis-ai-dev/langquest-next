import {
  commands, deriveKinds, derivePassage, emptyOrgState, emptyState, fold, HlcClock, recordTimeline,
  type AnyEvent, type EventPayloads, type EventType, type OrgState
} from '@langquest-next/core';
import {
  addDays, answeredQuestions, askCandidates, describeEntry, dueError, feedbackNames, gridKindIds, heroHeadline, historySummary,
  kindRowActions, kindRowSub, laneState, nextQuestionType, pathState, stepSheetSub
} from '../src/passage/record';
import { HIDDEN_TEXT } from '../src/moderation';

/**
 * The passage record's words and button rules (demo screens/passage.tsx),
 * read from a real event log: a translator records, reviewers review, the
 * record reads against the Standard Bible Flow (peer + bt, community,
 * consultant checkpoint, final).
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
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.MemberAdded', { profileId: 'lead', role: 'owner' });
  emit('lead', 'v1.MemberAdded', { profileId: 'akol', role: 'translator' });
  emit('lead', 'v1.MemberAdded', { profileId: 'ayen', role: 'reviewer' });
  emit('lead', 'v1.MemberAdded', { profileId: 'deng', role: 'reviewer' });
  emit('lead', 'v1.LaneAdded', { laneId: 'din', languoidId: 'din' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: null, kind: 'passage', label: 'John 3:1-21', order: 'a1' });
  run('lead', (c) => c.useFlow({ commandId: 'flow', laneId: 'din', flowId: 'standard_bible' }));
  const passage = () => derivePassage(state(), 'john3', 'din');
  const kinds = () => deriveKinds(state());
  return { emit, run, state, passage, kinds, events };
}

/** ctx.name as seen by `me`: the viewer is always "you". */
const nameFor = (me: string) => (id: string, lower = false) => (id === me ? (lower ? 'you' : 'You') : id.charAt(0).toUpperCase() + id.slice(1));
const name = nameFor('akol');
const record = (p: ReturnType<typeof project>, cmd: string, cards: string[], note?: string) =>
  p.run('akol', (c) => c.publishVersion({ commandId: cmd, unitId: 'john3', laneId: 'din', cardHashes: cards, ...(note ? { note } : {}) }));
const all = { review: true, ask: true, log: true, skip: true };

describe('the passage record hero', () => {
  it('says Not started, then Next with the open kinds of the first step', () => {
    const p = project();
    expect(heroHeadline(p.passage(), p.kinds(), 'akol', name)).toBe('Not started');
    record(p, 'v1', ['c1']);
    expect(heroHeadline(p.passage(), p.kinds(), 'akol', name)).toBe('Next: Peer Review + Back Translation');
  });

  it('feedback belongs to the latest version’s author: theirs to answer, everyone else waits on them', () => {
    const p = project();
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
    const p = project();
    record(p, 'v1', ['c1']);
    p.run('akol', (c) => c.ask({ commandId: 'a1', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', profileId: 'ayen' }));
    p.run('akol', (c) => c.ask({ commandId: 'a2', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'bt', profileId: 'ayen' }));
    const s = p.passage();
    expect(heroHeadline(s, p.kinds(), 'ayen', nameFor('ayen'))).toBe('Your turn: Peer Review + Back Translation');
    expect(heroHeadline(s, p.kinds(), 'deng', nameFor('deng'))).toBe('Waiting on Ayen');
    expect(pathState(s.steps[0]!, true)).toBe('waiting');
  });
});

describe('the step path', () => {
  it('marks the next step current, a checkpoint’s later steps locked, and answered feedback as answered', () => {
    const p = project();
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
    expect(laneState(s.steps[0]!.kinds[0]!, s.steps[0]!, true)).toBe('attention');
    record(p, 'v2', ['c2'], 'Clearer verse 3');
    p.run('deng', (c) => c.produceContent({ commandId: 'bt1', fromTakeId: p.passage().latest!.takeId, kindId: 'bt', cards: [{ hash: 'b1', durationMs: 1000 }] }));
    s = p.passage();
    expect(laneState(s.steps[0]!.kinds[0]!, s.steps[0]!, false)).toBe('answered');
    expect(laneState(s.steps[0]!.kinds[1]!, s.steps[0]!, false)).toBe('complete');
    expect(pathState(s.steps[0]!, false)).toBe('answered');
  });
});

describe('a kind’s actions', () => {
  it('the author gets Ask as the main button, a reviewer gets Review it now; set aside is not on checkpoints', () => {
    const p = project();
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
    const p = project();
    record(p, 'v1', ['c1']);
    const s = p.passage();
    const bt = s.steps[0]!.kinds[1]!;
    const kind = p.kinds().find((k) => k.id === 'bt')!;
    expect(kindRowActions({ status: bt, kind, step: s.steps[0]!, can: all, isAuthor: false, me: 'ayen' }).primary?.label).toBe('Back-translate it');
    expect(kindRowSub({ status: bt, kind, step: s.steps[0]!, me: 'ayen', name, checkedBy: 'Consultant Check' }))
      .toBe('A bilingual speaker records it in English — new content, not a verdict · the Consultant Check reviews it');
  });

  it('someone asked sees Review it now; everyone else sees who it waits on and no main button', () => {
    const p = project();
    record(p, 'v1', ['c1']);
    p.run('akol', (c) => c.ask({ commandId: 'a1', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', profileId: 'ayen', dueDate: '2099-01-02' }));
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
    const p = project();
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
    const p = project();
    record(p, 'v1', ['c1']);
    p.run('ayen', (c) => c.depart({ commandId: 'd1', unitId: 'john3', laneId: 'din', type: 'skip', kindId: 'bt', reason: 'Not needed for this passage' }));
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
    const p = project();
    record(p, 'v1', ['c1']);
    p.run('ayen', (c) => c.depart({ commandId: 'd1', unitId: 'john3', laneId: 'din', type: 'skip', kindId: 'bt', reason: 'You are useless' }));
    const s = p.passage();
    const t = recordTimeline(p.state(), s);
    const o = { p: s, kinds: p.kinds(), name, anchor: () => 'Whole passage', hidden: (id: string) => id === 'ayen' };
    expect(describeEntry(t[0]!, o).title).toBe('Back Translation set aside');
    expect(describeEntry(t[0]!, o).sub).toBe(HIDDEN_TEXT);
    expect(describeEntry(t[0]!, o).who).toBe('Ayen');
    expect(describeEntry(t[1]!, o).sub).toBe('First recording.');
  });

  it('drops a version a moderator removed, from the events remove_content redacts for it (decisions.md 48)', () => {
    const p = project();
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
  it('lists project and org members with the needed permission, the usual reviewers first, never the asker', () => {
    const p = project();
    record(p, 'v1', ['c1']);
    p.run('deng', (c) => c.recordReview({ commandId: 'r1', takeIds: [p.passage().latest!.takeId], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    const org: OrgState = emptyOrgState();
    org.roles['rev'] = { name: { value: 'Community Reviewer', hlc: '', eventId: '' }, privileges: { value: ['review'], hlc: '', eventId: '' }, retired: false };
    org.members['nyibol'] = { 'lane:p/din': { roleId: { value: 'rev', hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' }, scope: { level: 'lane', projectId: 'p', laneId: 'din' } } as never };
    org.members['elsewhere'] = { 'lane:p/other': { roleId: { value: 'rev', hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' }, scope: { level: 'lane', projectId: 'p', laneId: 'other' } } as never };

    const review = askCandidates(p.state(), org, { projectId: 'p', laneId: 'din', what: 'review', kindId: 'peer', me: 'lead' });
    expect(review.map((c) => c.profileId).sort()).toEqual(['ayen', 'deng', 'nyibol']);
    expect(review.find((c) => c.profileId === 'deng')).toMatchObject({ usual: true, sub: 'Reviewer · Has done this here before' });
    expect(review.find((c) => c.profileId === 'nyibol')).toMatchObject({ usual: false, sub: 'Community Reviewer' });

    const rec = askCandidates(p.state(), org, { projectId: 'p', laneId: 'din', what: 'record', me: 'lead' });
    expect(rec.map((c) => c.profileId)).toEqual(['akol']);
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
