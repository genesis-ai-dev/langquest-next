import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { CommandError, commands } from '../src/commands';
import { foldLanguage as fold } from '../src/reducer';
import { emptyLanguageState as emptyState } from '../src/state';
import { flowTemplate, instantiateFlow } from '../src/record';
import {
  derivePassage, highlightsFor, kindOf, passageSummary, requestAddressee, requestAddresseeName, requestIsFor,
  updatesFor, usualTarget, waitingOn
} from '../src/passage';
import { validateEvent } from '../src/validate';
import { privilegeFor } from '../src/org';

/**
 * Requests sent to a review team (ADR-029, v1.RequestMade with a teamId): open to every
 * member, closed by the first review of the kind, and "Send to …" picks the
 * language's team for a kind, else the one person who usually does it.
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
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'a' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'a1' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  emit('lead', 'v1.ReviewTeamDefined', { teamId: 'peers', name: 'Dinka peers' });
  emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'ayen', member: true });
  emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'deng', member: true });
  emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'akol', member: true });
  run('akol', (c) => c.publishVersion({ commandId: 'v1', unitId: 'john3', cardHashes: ['c1'] }));
  return { emit, run, state, events };
}

const askTeam = (p: ReturnType<typeof language>, teamId = 'peers') =>
  p.run('akol', (c) => c.ask({ commandId: 'ask', unitId: 'john3', what: 'review', kindId: 'peer', teamId }));
const name = (id: string) => id;

describe('requests to a review team', () => {
  it('ask names a team or a person in the same event, never both', () => {
    const s = language().state();
    const team = commands(s).ask({ commandId: 'a', unitId: 'john3', what: 'review', kindId: 'peer', teamId: 'peers' });
    expect(team.map((e) => [e.type, e.payload])).toEqual([['v1.RequestMade', { requestId: 'req:a', unitId: 'john3', what: 'review', kindId: 'peer', teamId: 'peers' }]]);
    const person = commands(s).ask({ commandId: 'b', unitId: 'john3', what: 'review', kindId: 'peer', profileId: 'ayen' });
    expect(person.map((e) => [e.type, e.payload])).toEqual([['v1.RequestMade', { requestId: 'req:b', unitId: 'john3', what: 'review', kindId: 'peer', profileId: 'ayen' }]]);
    expect(() => commands(s).ask({ commandId: 'c', unitId: 'john3', what: 'review', kindId: 'peer', teamId: 'peers', profileId: 'ayen' })).toThrow(CommandError);
  });

  it('a request takes exactly one of profileId, guest, teamId, and a team needs the same privilege as a person', () => {
    const base = { id: 'e', orgId: 'o', streamId: 'din', actorId: 'a', deviceId: 'd', hlc: 'h' };
    const payload = { requestId: 'r', unitId: 'u', what: 'review', kindId: 'peer' };
    const v = (p: object) => validateEvent({ ...base, type: 'v1.RequestMade', payload: { ...payload, ...p } } as AnyEvent);
    expect(v({ teamId: 't' })).toBeNull();
    expect(v({ profileId: 'x' })).toBeNull();
    expect(v({})).not.toBeNull();
    expect(v({ teamId: '' })).not.toBeNull();
    expect(v({ teamId: 't', profileId: 'x' })).not.toBeNull();
    expect(v({ teamId: 't', guest: { name: 'n', channel: 'sms', contact: 'c' } })).not.toBeNull();
    const ev = (to: object) => ({ ...base, type: 'v1.RequestMade', payload: { ...payload, ...to } }) as AnyEvent;
    expect(privilegeFor(ev({ teamId: 't' }))).toEqual(privilegeFor(ev({ profileId: 'x' })));
  });

  it('is open to every member but the asker, and on their My Work', () => {
    const p = language();
    askTeam(p);
    const s = p.state();
    const req = derivePassage(s, 'john3').openRequests[0]!;
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
    expect(passageSummary(derivePassage(s, 'john3'), kinds, 'ayen', name)).toBe('Your turn: Peer Review');
    expect(passageSummary(derivePassage(s, 'john3'), kinds, 'lead', name)).toBe('Waiting on Dinka peers · Peer Review');
  });

  it('names its addressee: the team, a person, or a guest', () => {
    const p = language();
    askTeam(p);
    const s = p.state();
    const req = derivePassage(s, 'john3').openRequests[0]!;
    expect(requestAddressee(s, req)).toEqual({ kind: 'team', teamId: 'peers', name: 'Dinka peers', memberIds: ['ayen', 'deng'] });
    expect(requestAddresseeName(s, req, name)).toBe('Dinka peers');
    expect(requestAddresseeName(s, { profileId: 'ayen' }, (id) => id.toUpperCase())).toBe('AYEN');
    expect(requestAddresseeName(s, { guest: { name: 'Pastor Garang', channel: 'sms', contact: 'c' } }, name)).toBe('Pastor Garang');
  });

  it('a team this language never defined is open to nobody', () => {
    // Why: each language has its own teams; a request naming a team from
    // another language (or a typo) must not land on anyone's list.
    const p = language();
    askTeam(p, 'nuer');
    const s = p.state();
    const req = derivePassage(s, 'john3').openRequests[0]!;
    expect(req.team).toEqual({ name: '', memberIds: [] });
    for (const id of ['ayen', 'deng', 'nyibol']) {
      expect(requestIsFor(s, req, id)).toBe(false);
      expect(highlightsFor(s, id, { canRecord: false, canReview: true })).toEqual([]);
    }
  });

  it('the first member who reviews closes it for everyone; anyone else may still do it', () => {
    const p = language();
    askTeam(p);
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('deng', (c) => c.recordReview({ commandId: 'r', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app', requestId: 'req:ask' }));
    const s = p.state();
    expect(derivePassage(s, 'john3').requests[0]!.status).toBe('done');
    expect(highlightsFor(s, 'ayen', { canRecord: false, canReview: true })).toEqual([]);
    expect(updatesFor(s, 'akol').map((u) => [u.kind, u.by])).toContainEqual(['request_done', 'deng']);

    const q = language();
    askTeam(q);
    q.run('nyibol', (c) => c.recordReview({ commandId: 'r', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    expect(derivePassage(q.state(), 'john3').requests[0]!.status).toBe('done');
  });
});

describe('usualTarget', () => {
  it('nothing clear: no team for the kind and nobody has done it here', () => {
    expect(usualTarget(language().state(), 'peer', 'akol')).toBeUndefined();
  });

  it('the one person who reviewed this kind here before, in the app', () => {
    const p = language();
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'r1', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    // A check logged afterwards is the typist's act, not the reviewer's.
    p.run('lead', (c) => c.recordReview({ commandId: 'r2', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'logged', givenBy: 'Elder Deng' }));
    expect(usualTarget(p.state(), 'peer', 'akol')).toEqual({ profileId: 'ayen' });
    expect(usualTarget(p.state(), 'peer', 'ayen')).toBeUndefined(); // never yourself
    expect(usualTarget(p.state(), 'peer', 'akol', { eligible: (id) => id !== 'ayen' })).toBeUndefined();
    p.run('deng', (c) => c.recordReview({ commandId: 'r3', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    expect(usualTarget(p.state(), 'peer', 'akol')).toBeUndefined(); // two people: no one is "the" usual
  });

  it('a team that usually does this kind comes first, before a person, while someone besides me is on it', () => {
    const p = language();
    const v1 = derivePassage(p.state(), 'john3').latest!.takeId;
    p.run('nyibol', (c) => c.recordReview({ commandId: 'r1', takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
    expect(usualTarget(p.state(), 'peer', 'akol')).toEqual({ profileId: 'nyibol' });
    p.emit('lead', 'v1.ReviewTeamKindSet', { teamId: 'peers', kindId: 'peer' });
    expect(p.state().teams['peers']!.kindId?.value).toBe('peer');
    expect(usualTarget(p.state(), 'peer', 'akol')).toEqual({ teamId: 'peers', name: 'Dinka peers' });
    expect(usualTarget(p.state(), 'community', 'akol')).toBeUndefined();
    // Only me left on it: not a team to send to.
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'ayen', member: false });
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'deng', member: false });
    expect(usualTarget(p.state(), 'peer', 'akol')).toEqual({ profileId: 'nyibol' });
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'peers', profileId: 'deng', member: true });
    expect(usualTarget(p.state(), 'peer', 'akol')).toEqual({ teamId: 'peers', name: 'Dinka peers' });
    // "Any kind" is no kind's usual team.
    p.emit('lead', 'v1.ReviewTeamKindSet', { teamId: 'peers', kindId: null });
    expect(usualTarget(p.state(), 'peer', 'akol')).toEqual({ profileId: 'nyibol' });
  });

  it('the kind is a register: the later clock wins whatever order events arrive in', () => {
    const p = language();
    p.emit('lead', 'v1.ReviewTeamKindSet', { teamId: 'peers', kindId: 'peer' });
    p.emit('deng', 'v1.ReviewTeamKindSet', { teamId: 'peers', kindId: 'community' });
    const forward = fold(p.events, emptyState());
    const backward = fold([...p.events].reverse(), emptyState());
    expect(forward.teams['peers']!.kindId?.value).toBe('community');
    expect(backward.teams['peers']).toEqual(forward.teams['peers']);
  });
});
