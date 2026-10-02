import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { CommandError, commands } from '../src/commands';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import {
  derivePassage, highlightsFor, kindOf, passageSummary, requestAddressee, requestAddresseeName, requestIsFor,
  updatesFor, usualTarget, waitingOn
} from '../src/passage';
import { validateEvent } from '../src/validate';
import { privilegeFor } from '../src/org';

/**
 * Requests sent to a review team (ADR-029, v2.RequestMade): open to every
 * member, closed by the first review of the kind, and "Send to …" picks the
 * language's team for a kind, else the one person who usually does it.
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
  for (const [id, role] of [['lead', 'owner'], ['akol', 'translator'], ['ayen', 'reviewer'], ['deng', 'reviewer'], ['nyibol', 'reviewer']] as const) {
    emit('lead', 'v1.MemberAdded', { profileId: id, role });
  }
  emit('lead', 'v1.LaneAdded', { laneId: 'din', languoidId: 'din' });
  emit('lead', 'v1.LaneAdded', { laneId: 'nus', languoidId: 'nus' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'a' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'a1' });
  run('lead', (c) => c.useFlow({ commandId: 'flow', laneId: 'din', flowId: 'standard_bible' }));
  emit('lead', 'v1.ReviewTeamDefined', { teamId: 'peers', laneId: 'din', name: 'Dinka peers' });
  emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'ayen', member: true });
  emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'deng', member: true });
  emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'akol', member: true });
  emit('lead', 'v1.ReviewTeamDefined', { teamId: 'nuer', laneId: 'nus', name: 'Nuer peers' });
  emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'nuer', profileId: 'nyibol', member: true });
  run('akol', (c) => c.publishVersion({ commandId: 'v1', unitId: 'john3', laneId: 'din', cardHashes: ['c1'] }));
  return { emit, run, state, events };
}

const askTeam = (p: ReturnType<typeof project>, teamId = 'peers') =>
  p.run('akol', (c) => c.ask({ commandId: 'ask', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', teamId }));
const name = (id: string) => id;

describe('requests to a review team', () => {
  it('ask with a team emits v2.RequestMade; without one, v1 exactly as before', () => {
    const s = project().state();
    const team = commands(s).ask({ commandId: 'a', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', teamId: 'peers' });
    expect(team.map((e) => [e.type, e.payload])).toEqual([['v2.RequestMade', { requestId: 'req:a', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', teamId: 'peers' }]]);
    const person = commands(s).ask({ commandId: 'b', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', profileId: 'ayen' });
    expect(person.map((e) => [e.type, e.payload])).toEqual([['v1.RequestMade', { requestId: 'req:b', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', profileId: 'ayen' }]]);
    expect(() => commands(s).ask({ commandId: 'c', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'peer', teamId: 'peers', profileId: 'ayen' })).toThrow(CommandError);
  });

  it('v2 takes exactly one of profileId, guest, teamId, and needs the same privilege as v1', () => {
    const base = { id: 'e', orgId: 'o', projectId: 'p', actorId: 'a', deviceId: 'd', hlc: 'h' };
    const payload = { requestId: 'r', unitId: 'u', laneId: 'l', what: 'review', kindId: 'peer' };
    const v = (p: object) => validateEvent({ ...base, type: 'v2.RequestMade', payload: { ...payload, ...p } } as AnyEvent);
    expect(v({ teamId: 't' })).toBeNull();
    expect(v({ profileId: 'x' })).toBeNull();
    expect(v({})).not.toBeNull();
    expect(v({ teamId: '' })).not.toBeNull();
    expect(v({ teamId: 't', profileId: 'x' })).not.toBeNull();
    expect(v({ teamId: 't', guest: { name: 'n', channel: 'sms', contact: 'c' } })).not.toBeNull();
    const ev = (type: 'v1.RequestMade' | 'v2.RequestMade') => ({ ...base, type, payload: { ...payload, teamId: 't' } }) as AnyEvent;
    expect(privilegeFor(ev('v2.RequestMade'))).toEqual(privilegeFor(ev('v1.RequestMade')));
  });

  it('is open to every member but the asker, and on their My Work', () => {
    const p = project();
    askTeam(p);
    const s = p.state();
    const req = derivePassage(s, 'john3', 'din').openRequests[0]!;
    expect(req.teamId).toBe('peers');
    expect(req.team).toEqual({ name: 'Dinka peers', memberIds: ['ayen', 'deng'] });
    expect(requestIsFor(s, req, 'ayen')).toBe(true);
    expect(requestIsFor(s, req, 'deng')).toBe(true);
    expect(requestIsFor(s, req, 'akol')).toBe(false); // the asker, though on the team
    expect(requestIsFor(s, req, 'nyibol')).toBe(false);
    for (const id of ['ayen', 'deng']) {
      expect(highlightsFor(s, id, { canRecord: false, canReview: true }).map((h) => h.kind)).toEqual(['review']);
      expect(updatesFor(s, id).map((u) => u.kind)).toEqual(['request']);
    }
    expect(highlightsFor(s, 'nyibol', { canRecord: false, canReview: true })).toEqual([]);
    expect(waitingOn(s, 'akol').map((w) => w.request.id)).toEqual(['req:ask']);
    const kinds = [kindOf(s, 'peer')];
    expect(passageSummary(derivePassage(s, 'john3', 'din'), kinds, 'ayen', name)).toBe('Your turn: Peer Review');
    expect(passageSummary(derivePassage(s, 'john3', 'din'), kinds, 'lead', name)).toBe('Waiting on Dinka peers · Peer Review');
  });

  it('names its addressee: the team, a person, or a guest', () => {
    const p = project();
    askTeam(p);
    const s = p.state();
    const req = derivePassage(s, 'john3', 'din').openRequests[0]!;
    expect(requestAddressee(s, req)).toEqual({ kind: 'team', teamId: 'peers', name: 'Dinka peers', memberIds: ['ayen', 'deng'] });
    expect(requestAddresseeName(s, req, name)).toBe('Dinka peers');
    expect(requestAddresseeName(s, { laneId: 'din', profileId: 'ayen' }, (id) => id.toUpperCase())).toBe('AYEN');
    expect(requestAddresseeName(s, { laneId: 'din', guest: { name: 'Pastor Garang', channel: 'sms', contact: 'c' } }, name)).toBe('Pastor Garang');
  });

  it('a team from another lane is open to nobody', () => {
    const p = project();
    askTeam(p, 'nuer');
    const s = p.state();
    const req = derivePassage(s, 'john3', 'din').openRequests[0]!;
    expect(requestIsFor(s, req, 'nyibol')).toBe(false);
    expect(highlightsFor(s, 'nyibol', { canRecord: false, canReview: true })).toEqual([]);
  });

  it('the first member who reviews closes it for everyone; anyone else may still do it', () => {
    const p = project();
    askTeam(p);
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('deng', (c) => c.recordReview({ commandId: 'r', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app', requestId: 'req:ask' }));
    const s = p.state();
    expect(derivePassage(s, 'john3', 'din').requests[0]!.status).toBe('done');
    expect(highlightsFor(s, 'ayen', { canRecord: false, canReview: true })).toEqual([]);
    expect(updatesFor(s, 'akol').map((u) => [u.kind, u.by])).toContainEqual(['request_done', 'deng']);

    const q = project();
    askTeam(q);
    q.run('nyibol', (c) => c.recordReview({ commandId: 'r', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    expect(derivePassage(q.state(), 'john3', 'din').requests[0]!.status).toBe('done');
  });
});

describe('usualTarget', () => {
  it('nothing clear: no team for the kind and nobody has done it here', () => {
    expect(usualTarget(project().state(), 'din', 'peer', 'akol')).toBeUndefined();
  });

  it('the one person who reviewed this kind here before, in the app', () => {
    const p = project();
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    // A check logged afterwards is the typist's act, not the reviewer's.
    p.run('lead', (c) => c.recordReview({ commandId: 'r2', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'logged', givenBy: 'Elder Deng' }));
    expect(usualTarget(p.state(), 'din', 'peer', 'akol')).toEqual({ profileId: 'ayen' });
    expect(usualTarget(p.state(), 'din', 'peer', 'ayen')).toBeUndefined(); // never yourself
    expect(usualTarget(p.state(), 'nus', 'peer', 'akol')).toBeUndefined(); // another language
    expect(usualTarget(p.state(), 'din', 'peer', 'akol', { eligible: (id) => id !== 'ayen' })).toBeUndefined();
    p.run('deng', (c) => c.recordReview({ commandId: 'r3', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    expect(usualTarget(p.state(), 'din', 'peer', 'akol')).toBeUndefined(); // two people: no one is "the" usual
  });

  it('a team a v1 step of this kind names, with someone on it besides me', () => {
    const p = project();
    p.emit('lead', 'v1.WorkflowStepSet', { stepId: 'quick_check@1/peer_review', laneId: 'din', order: 's00', role: 'reviewer', teamId: 'peers', required: true, rule: 'any' });
    expect(usualTarget(p.state(), 'din', 'peer', 'akol')).toEqual({ teamId: 'peers', name: 'Dinka peers' });
    expect(usualTarget(p.state(), 'din', 'community', 'akol')).toBeUndefined();
    expect(usualTarget(p.state(), 'nus', 'peer', 'akol')).toBeUndefined(); // the team is Dinka's
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'ayen', member: false });
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'deng', member: false });
    expect(usualTarget(p.state(), 'din', 'peer', 'akol')).toBeUndefined(); // only me left on it
  });

  it('a team that usually does this kind comes first, before a v1 step or a person', () => {
    const p = project();
    const v1 = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('nyibol', (c) => c.recordReview({ commandId: 'r1', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    expect(usualTarget(p.state(), 'din', 'peer', 'akol')).toEqual({ profileId: 'nyibol' });
    p.emit('lead', 'v1.ReviewTeamKindSet', { teamId: 'peers', laneId: 'din', kindId: 'peer' });
    expect(p.state().teams['peers']!.kindId?.value).toBe('peer');
    expect(usualTarget(p.state(), 'din', 'peer', 'akol')).toEqual({ teamId: 'peers', name: 'Dinka peers' });
    expect(usualTarget(p.state(), 'din', 'community', 'akol')).toBeUndefined();
    expect(usualTarget(p.state(), 'nus', 'peer', 'akol')).toBeUndefined();
    // "Any kind" is no kind's usual team.
    p.emit('lead', 'v1.ReviewTeamKindSet', { teamId: 'peers', laneId: 'din', kindId: null });
    expect(usualTarget(p.state(), 'din', 'peer', 'akol')).toEqual({ profileId: 'nyibol' });
  });

  it('the kind is a register: the later clock wins whatever order events arrive in', () => {
    const p = project();
    p.emit('lead', 'v1.ReviewTeamKindSet', { teamId: 'peers', laneId: 'din', kindId: 'peer' });
    p.emit('deng', 'v1.ReviewTeamKindSet', { teamId: 'peers', laneId: 'din', kindId: 'community' });
    const forward = fold(p.events, emptyState());
    const backward = fold([...p.events].reverse(), emptyState());
    expect(forward.teams['peers']!.kindId?.value).toBe('community');
    expect(backward.teams['peers']).toEqual(forward.teams['peers']);
  });
});
