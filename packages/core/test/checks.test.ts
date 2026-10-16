import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { commands, type EventSpec } from '../src/commands';
import { foldLanguage as fold } from '../src/reducer';
import { emptyLanguageState as emptyState } from '../src/state';
import { DEFAULT_KINDS, flowTemplate, instantiateFlow } from '../src/record';
import { deriveFlow, usualTarget } from '../src/passage';
import { checkHelps, checkHelpSpecs, checkPeople, checkPeopleSpecs, checkShows, checkShowsSpecs, shownFrom, checkTeamFor, checkTeamId, RECORD_STEP } from '../src/checks';
import { validateEvent } from '../src/validate';
import { applyOrgEvent, emptyOrgState, SEED_ROLES, translatorReviewUpgrade, type OrgState } from '../src/org';

/**
 * A language's checks carry their own people and helps (decisions.md 91):
 * people are stored as one review team per check, older teams for the kind
 * or for any kind still count until the check's people are edited, and a
 * ready-made flow is copied into the language rather than followed.
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
  const apply = (actorId: string, specs: EventSpec[]) => {
    for (const s of specs) emit(actorId, s.type, s.payload as never);
  };
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  return { emit, apply, state, events };
}

const KINDS = ['peer', 'bt', 'community', 'consultant', 'final'];
const nameOf = (k: string) => `${k} check`;

describe("a check's people", () => {
  it('are its own team, made on first use, and asking the check asks that team', () => {
    const p = language();
    const { specs } = checkPeopleSpecs(p.state(), { commandId: 'c', kindId: 'peer', people: ['achol', 'deng'], kinds: KINDS, nameOf });
    for (const s of specs) expect(validateEvent({ id: s.id, type: s.type, orgId: 'o', streamId: 'din', actorId: 'lead', deviceId: 'd', hlc: 'h', payload: s.payload } as AnyEvent)).toBeNull();
    p.apply('lead', specs);
    const s = p.state();
    expect(checkPeople(s, 'peer')).toEqual(['achol', 'deng']);
    expect(s.teams[checkTeamId('peer')]!.kindId?.value).toBe('peer');
    expect(checkTeamFor(s, 'peer', 'deng')).toBe(checkTeamId('peer'));
    expect(usualTarget(s, 'peer', 'rebecca')).toEqual({ teamId: checkTeamId('peer'), name: 'peer check' });
    expect(checkPeople(s, 'community')).toEqual([]);
  });

  it('write only what changes, and undo puts them back', () => {
    const p = language();
    p.apply('lead', checkPeopleSpecs(p.state(), { commandId: 'a', kindId: 'peer', people: ['achol', 'deng'], kinds: KINDS, nameOf }).specs);
    const before = p.state();
    const edit = checkPeopleSpecs(before, { commandId: 'b', kindId: 'peer', people: ['achol', 'garang'], kinds: KINDS, nameOf });
    expect(edit.specs.map((s) => [s.type, s.payload])).toEqual([
      ['v1.ReviewTeamMemberSet', { teamId: 'check:peer', profileId: 'deng', member: false }],
      ['v1.ReviewTeamMemberSet', { teamId: 'check:peer', profileId: 'garang', member: true }]
    ]);
    p.apply('lead', edit.specs);
    expect(checkPeople(p.state(), 'peer')).toEqual(['achol', 'garang']);
    p.apply('lead', edit.undo());
    expect(checkPeople(p.state(), 'peer')).toEqual(['achol', 'deng']);
    expect(checkPeopleSpecs(p.state(), { commandId: 'c', kindId: 'peer', people: ['deng', 'achol'], kinds: KINDS, nameOf }).specs).toEqual([]);
  });

  it('an older team for the kind gives its people up to the check when the check is edited', () => {
    const p = language();
    p.emit('lead', 'v1.ReviewTeamDefined', { teamId: 'team:old', name: 'Peer checkers' });
    p.emit('lead', 'v1.ReviewTeamKindSet', { teamId: 'team:old', kindId: 'peer' });
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'team:old', profileId: 'achol', member: true });
    expect(checkPeople(p.state(), 'peer')).toEqual(['achol']);
    expect(checkTeamFor(p.state(), 'peer', 'me')).toBe('team:old');
    p.apply('lead', checkPeopleSpecs(p.state(), { commandId: 'c', kindId: 'peer', people: ['achol', 'deng'], kinds: KINDS, nameOf }).specs);
    const s = p.state();
    expect(checkPeople(s, 'peer')).toEqual(['achol', 'deng']);
    expect(s.teams['team:old']!.members['achol']!.value).toBe(false);
    expect(checkTeamFor(s, 'peer', 'me')).toBe('check:peer');
  });

  it("an older team for any kind is on every check, and editing one check moves its people onto each check's team", () => {
    const p = language();
    p.emit('lead', 'v1.ReviewTeamDefined', { teamId: 'team:all', name: 'Reviewers' });
    p.emit('lead', 'v1.ReviewTeamMemberSet', { teamId: 'team:all', profileId: 'garang', member: true });
    for (const k of KINDS) expect(checkPeople(p.state(), k)).toEqual(['garang']);
    // Taking Garang off Peer check keeps Garang on every other check.
    p.apply('lead', checkPeopleSpecs(p.state(), { commandId: 'c', kindId: 'peer', people: ['achol'], kinds: KINDS, nameOf }).specs);
    const s = p.state();
    expect(checkPeople(s, 'peer')).toEqual(['achol']);
    for (const k of KINDS.filter((k) => k !== 'peer')) expect(checkPeople(s, k)).toEqual(['garang']);
    expect(s.teams['team:all']!.members['garang']!.value).toBe(false);
    expect(s.teams['check:community']!.name.value).toBe('community check');
  });
});

describe("a check's helps", () => {
  it('link and unlink library items and the language’s own material, as registers', () => {
    const p = language();
    p.apply('lead', checkHelpSpecs(p.state(), { commandId: 'a', kindId: 'peer', help: { materialId: 'note-names' }, linked: true }));
    p.apply('lead', checkHelpSpecs(p.state(), { commandId: 'b', kindId: 'peer', help: { itemId: 'fia-guides' }, linked: true }));
    expect(checkHelps(p.state(), 'peer')).toEqual([{ itemId: 'fia-guides' }, { materialId: 'note-names' }]);
    expect(checkHelpSpecs(p.state(), { commandId: 'c', kindId: 'peer', help: { itemId: 'fia-guides' }, linked: true })).toEqual([]);
    p.apply('lead', checkHelpSpecs(p.state(), { commandId: 'd', kindId: 'peer', help: { itemId: 'fia-guides' }, linked: false }));
    expect(checkHelps(p.state(), 'peer')).toEqual([{ materialId: 'note-names' }]);
    expect(checkHelps(p.state(), 'community')).toEqual([]);
  });

  it('name exactly one help each', () => {
    const ev = (payload: object) => ({ id: 'e', type: 'v1.CheckHelpSet', orgId: 'o', streamId: 'din', actorId: 'a', deviceId: 'd', hlc: 'h', payload } as AnyEvent);
    expect(validateEvent(ev({ kindId: 'peer', itemId: 'x', linked: true }))).toBeNull();
    expect(validateEvent(ev({ kindId: 'peer', itemId: 'x', materialId: 'y', linked: true }))).not.toBeNull();
    expect(validateEvent(ev({ kindId: 'peer', linked: true }))).not.toBeNull();
    expect(validateEvent(ev({ kindId: 'peer', materialId: '', linked: true }))).not.toBeNull();
    expect(validateEvent(ev({ kindId: 'peer', itemId: 'x', linked: 'yes' }))).not.toBeNull();
  });
});

describe('what a step shows', () => {
  it('is everything by default, and nothing at a kind that withholds context', () => {
    const p = language();
    const all = { bibleAudio: true, bibleText: true, guideAudio: true, guideText: true, terms: true, notes: true, earlier: true };
    expect(checkShows(p.state(), RECORD_STEP)).toEqual(all);
    expect(checkShows(p.state(), 'peer')).toEqual(all);
    expect(Object.values(checkShows(p.state(), 'bt')).every((v) => !v)).toBe(true);
  });

  it('turns each thing on or off as a register, the recording like any check', () => {
    const p = language();
    p.apply('lead', checkShowsSpecs(p.state(), { commandId: 'a', kindId: RECORD_STEP, what: 'bibleText', shown: false }));
    p.apply('lead', checkShowsSpecs(p.state(), { commandId: 'b', kindId: 'bt', what: 'bibleAudio', shown: true }));
    expect(checkShows(p.state(), RECORD_STEP)).toMatchObject({ bibleText: false, bibleAudio: true, guideText: true });
    expect(checkShows(p.state(), 'bt')).toMatchObject({ bibleAudio: true, bibleText: false });
    expect(checkShowsSpecs(p.state(), { commandId: 'c', kindId: RECORD_STEP, what: 'bibleText', shown: false })).toEqual([]);
    expect(checkShowsSpecs(p.state(), { commandId: 'd', kindId: 'peer', what: 'notes', shown: true })).toEqual([]);
    p.apply('lead', checkShowsSpecs(p.state(), { commandId: 'e', kindId: RECORD_STEP, what: 'bibleText', shown: true }));
    expect(checkShows(p.state(), RECORD_STEP).bibleText).toBe(true);
  });

  it('chooses notes and earlier versions step by step, falling back to the thing', () => {
    const p = language();
    expect(shownFrom(p.state(), 'consultant', 'notes', 'peer')).toBe(true);
    expect(shownFrom(p.state(), 'bt', 'earlier', RECORD_STEP)).toBe(false);
    p.apply('lead', checkShowsSpecs(p.state(), { commandId: 'a', kindId: 'consultant', what: 'notes', from: 'peer', shown: false }));
    expect(shownFrom(p.state(), 'consultant', 'notes', 'peer')).toBe(false);
    expect(shownFrom(p.state(), 'consultant', 'notes', 'community')).toBe(true);
    expect(checkShows(p.state(), 'consultant').notes).toBe(true);
    expect(checkShowsSpecs(p.state(), { commandId: 'b', kindId: 'consultant', what: 'notes', from: 'peer', shown: false })).toEqual([]);
  });

  it('names one of the things a step can show', () => {
    const ev = (payload: object) => ({ id: 'e', type: 'v1.CheckShowsSet', orgId: 'o', streamId: 'din', actorId: 'a', deviceId: 'd', hlc: 'h', payload } as AnyEvent);
    expect(validateEvent(ev({ kindId: 'record', what: 'guideText', shown: false }))).toBeNull();
    expect(validateEvent(ev({ kindId: 'record', what: 'bible', shown: false }))).not.toBeNull();
    expect(validateEvent(ev({ kindId: '', what: 'notes', shown: false }))).not.toBeNull();
    expect(validateEvent(ev({ kindId: 'peer', what: 'notes', shown: 'no' }))).not.toBeNull();
    expect(validateEvent(ev({ kindId: 'peer', what: 'notes', shown: false, from: 'record' }))).toBeNull();
    expect(validateEvent(ev({ kindId: 'peer', what: 'bibleText', shown: false, from: 'record' }))).not.toBeNull();
    expect(validateEvent(ev({ kindId: 'peer', what: 'earlier', shown: false, from: '' }))).not.toBeNull();
  });
});

describe('a ready-made flow', () => {
  it('is copied into the language as its own checks, named for where they came from', () => {
    const p = language();
    const quick = flowTemplate('quick_check')!;
    p.apply('lead', commands(p.state()).copyFlow({ commandId: 'use', name: quick.name, kinds: DEFAULT_KINDS, steps: quick.steps }));
    const flow = deriveFlow(p.state());
    expect(flow.flowId).toBe('custom');
    expect(flow.itemId).toBeNull();
    expect(flow.name).toBe('Quick Check');
    expect(flow.steps.map((s) => s.kindIds)).toEqual([['peer'], ['final']]);
    // Editing it keeps the language's own steps.
    p.apply('lead', commands(p.state()).saveFlowSteps({ commandId: 'edit', steps: [...flow.steps.map((s) => ({ stepId: s.id, kindIds: s.kindIds, checkpoint: s.checkpoint })), { kindIds: ['community'], checkpoint: false }] }));
    expect(deriveFlow(p.state()).steps.map((s) => s.kindIds)).toEqual([['peer'], ['final'], ['community']]);
  });

  it('defines the kinds it brings that the language lacks', () => {
    const p = language();
    const elder = { id: 'elder', name: 'Elder check', description: 'The elders listen.', usualReviewer: 'Elders' };
    const specs = commands(p.state()).copyFlow({ commandId: 'use', name: 'Ours', kinds: [elder], steps: [{ kindIds: ['elder'], checkpoint: true }] });
    expect(specs[0]).toMatchObject({ type: 'v1.ReviewKindDefined', payload: { kindId: 'elder', name: 'Elder check' } });
    p.apply('lead', specs);
    expect(deriveFlow(p.state()).steps).toMatchObject([{ kindIds: ['elder'], checkpoint: true }]);
  });
});

describe('the Translator role', () => {
  const org = (privileges: string[]): OrgState => {
    let s = emptyOrgState();
    s = applyOrgEvent(s, { id: 'r', type: 'v1.RoleDefined', orgId: 'o', streamId: 'org', actorId: 'a', deviceId: 'd', hlc: '0000000001000:0000:a', payload: { roleId: 'translator', name: 'Translator', privileges } } as AnyEvent);
    return s;
  };

  it('is seeded with Review, so a translator can be on a check and be asked', () => {
    expect(SEED_ROLES.find((r) => r.roleId === 'translator')!.privileges).toContain('review');
  });

  it('gains Review once in an organization that still has the old seeded role, and a changed role is left alone', () => {
    const up = translatorReviewUpgrade(org(['translate', 'fill_reference', 'send_to_reviewers', 'view_status']));
    expect(up).toEqual({ roleId: 'translator', name: 'Translator', privileges: SEED_ROLES.find((r) => r.roleId === 'translator')!.privileges });
    expect(translatorReviewUpgrade(org(up!.privileges))).toBeNull();
    expect(translatorReviewUpgrade(org(['translate', 'view_status']))).toBeNull();
    expect(translatorReviewUpgrade(null)).toBeNull();
  });
});
