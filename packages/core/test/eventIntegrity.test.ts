import type { AnyEvent, EventType } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { emptyOrgState, foldOrg, mayChangeMembership, mayGrantRole, SEED_ROLES } from '../src/org';
import { approvedVersion, derivePassage } from '../src/passage';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { entityKeyOf } from '../src/validate';
import { shuffle } from './fixtures';

/**
 * Who may put what in the log (decisions.md 75), as core sees it. The
 * server refuses a second event for an entity, but a log may already hold
 * one, so the fold must keep the earliest in every order; a review given by
 * link counts only where its step takes links; and nobody grants, changes
 * or removes a role that holds more than they do.
 */

const T = 1_790_000_000_000;
let n = 0;
const ev = (type: EventType, payload: unknown, actorId = 'translatorA', at = T + ++n * 1000, deviceId = 'd'): AnyEvent =>
  ({ id: `e${++n}`, type, orgId: 'o', streamId: 'L', actorId, deviceId, hlc: encodeHlc(at, 0, deviceId), payload }) as AnyEvent;

const passage = () => [
  ev('v1.FlowSelected', { flowId: 'f', name: 'F' }),
  ev('v1.FlowStepSet', { stepId: 'f/s1', order: 's00', kindIds: ['peer'], checkpoint: false }),
  ev('v1.UnitAdded', { unitId: 'u', parentUnitId: null, kind: 'passage', label: 'U', order: 'a' })
];

describe('one create, one entity', () => {
  it('never lets a second compose swap the audio under a reviewed version, in any order', () => {
    const base = [
      ...passage(),
      ev('v1.TakeComposed', { takeId: 't1', unitId: 'u', cardHashes: ['a'.repeat(64)], parentTakeId: null }),
      ev('v1.TakeSubmitted', { takeId: 't1' }),
      ev('v1.ReviewRecorded', { reviewId: 'r1', takeId: 't1', kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'reviewer')
    ];
    const swap = ev('v1.TakeComposed', { takeId: 't1', unitId: 'u', cardHashes: ['f'.repeat(64)], parentTakeId: null }, 'translatorB');
    const all = [...base, swap];
    const want = foldLanguage(all, emptyLanguageState());
    expect(want.takes['t1']).toMatchObject({ actorId: 'translatorA', cardHashes: ['a'.repeat(64)] });
    expect(approvedVersion(derivePassage(want, 'u'))?.cardHashes).toEqual(['a'.repeat(64)]);
    for (let seed = 1; seed <= 50; seed++) expect(foldLanguage(shuffle(all, seed), emptyLanguageState())).toEqual(want);
  });

  it('keeps the earliest of each create-once entity, and breaks a tied clock the same way in every order', () => {
    const at = T + 500_000;
    const pairs: [EventType, (who: string) => unknown][] = [
      ['v1.RecordingAdded', (who) => ({ recordingId: 'rec', unitId: 'u', kind: 'target', cards: [{ hash: who.repeat(64).slice(0, 64), durationMs: 1 }] })],
      ['v1.TakeComposed', (who) => ({ takeId: 'tk', unitId: 'u', cardHashes: [who.repeat(64).slice(0, 64)], parentTakeId: null })],
      ['v1.ResponseRecorded', (who) => ({ takeId: 'resp', respondsToTakeId: 'tk', note: who })],
      ['v1.ReviewRecorded', (who) => ({ reviewId: 'rv', takeId: 'tk', kindId: 'peer', outcome: who === 'a' ? 'looks_good' : 'needs_changes', via: 'app' })],
      ['v1.NoteAdded', (who) => ({ noteId: 'nt', unitId: 'u', anchor: { kind: 'passage' }, text: who })],
      ['v1.KeyTermRenderingAdded', (who) => ({ termId: 'k', renderingId: 'kr', rendering: who, context: '' })],
      ['v1.KeyTermAdjusted', (who) => ({ termId: 'k', adjustmentId: 'ka', note: who })]
    ];
    for (const [type, payload] of pairs) {
      // Earlier clock wins, whoever arrives first; a backdated copy is what the server now refuses.
      const early = ev(type, payload('a'), 'a', at);
      const late = ev(type, payload('b'), 'b', at + 1);
      const tieA = ev(type, payload('c'), 'c', at - 10, 'dX');
      const tieB = ev(type, payload('d'), 'd', at - 10, 'dX');
      const forward = foldLanguage([early, late], emptyLanguageState());
      expect(foldLanguage([late, early], emptyLanguageState()), type).toEqual(forward);
      const tied = foldLanguage([tieA, tieB], emptyLanguageState());
      expect(foldLanguage([tieB, tieA], emptyLanguageState()), `${type} on a tied clock`).toEqual(tied);
      expect(entityKeyOf(early), type).not.toBeNull();
    }
  });

  it('names the entity of each creating event, and of nothing else', () => {
    expect(entityKeyOf(ev('v1.TakeComposed', { takeId: 't', unitId: 'u', cardHashes: [], parentTakeId: null }))).toBe('take:t');
    expect(entityKeyOf(ev('v1.ResponseRecorded', { takeId: 't', respondsToTakeId: 'p' }))).toBe('response:t');
    expect(entityKeyOf(ev('v1.KeyTermAdjusted', { termId: 'k', adjustmentId: 'a', note: '' }))).toBe('adjustment:k/a');
    // Two phones define the translation guide and key terms under one id by design.
    expect(entityKeyOf(ev('v1.MaterialDefined', { materialId: 'tg', kind: 'tg', title: 'T', scope: {} }))).toBeNull();
    expect(entityKeyOf(ev('v1.KeyTermDefined', { termId: 'k', term: 't', gloss: 'g', unitScope: [] }))).toBeNull();
    expect(entityKeyOf(ev('v1.TakeArchived', { takeId: 't' }))).toBeNull();
  });
});

describe('a review given by link', () => {
  const recorded = () => [
    ...passage(),
    ev('v1.TakeComposed', { takeId: 't1', unitId: 'u', cardHashes: ['a'.repeat(64)], parentTakeId: null }),
    ev('v1.TakeSubmitted', { takeId: 't1' }),
    ev('v1.ReviewRecorded', { reviewId: 'r-link', takeId: 't1', kindId: 'peer', outcome: 'looks_good', via: 'link' }, 'translatorA')
  ];

  it('completes a step that takes links', () => {
    const s = derivePassage(foldLanguage(recorded(), emptyLanguageState()), 'u');
    expect(s.steps[0]).toMatchObject({ complete: true, linksAllowed: true });
    expect(approvedVersion(s)?.takeId).toBe('t1');
  });

  it('completes nothing where the step takes no links, whenever it was given', () => {
    const off = ev('v1.FlowStepLinksSet', { stepId: 'f/s1', allowed: false }, 'coordinator');
    const s = derivePassage(foldLanguage([...recorded(), off], emptyLanguageState()), 'u');
    expect(s.steps[0]).toMatchObject({ complete: false, linksAllowed: false });
    expect(s.steps[0]!.kinds[0]!.state).not.toBe('approved');
    expect(approvedVersion(s)).toBeNull();
    // The review itself stays on the record.
    expect(s.reviews.map((r) => r.id)).toContain('r-link');
  });
});

describe('who may grant what', () => {
  const org = () => {
    const out: AnyEvent[] = [];
    const add = (type: EventType, payload: unknown) => out.push({ ...ev(type, payload, 'owner'), streamId: '_org' } as AnyEvent);
    for (const r of SEED_ROLES) add('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
    add('v1.LanguageAdded', { languageId: 'L', name: 'L', code: 'l', sourceCode: 'eng' });
    add('v1.MemberAdded', { profileId: 'owner', roleId: 'org_admin', scope: { level: 'org' } });
    add('v1.MemberAdded', { profileId: 'coord', roleId: 'coordinator', scope: { level: 'org' } });
    add('v1.MemberAdded', { profileId: 'lead', roleId: 'coordinator', scope: { level: 'language', languageId: 'L' } });
    add('v1.MemberAdded', { profileId: 'tr', roleId: 'translator', scope: { level: 'language', languageId: 'L' } });
    return foldOrg(out, emptyOrgState());
  };
  const L = { level: 'language', languageId: 'L' } as const;
  const ORG = { level: 'org' } as const;

  it('lets nobody grant a role with a privilege they lack', () => {
    const s = org();
    expect(mayGrantRole(s, 'owner', 'org_admin', ORG)).toBe(true);
    expect(mayGrantRole(s, 'coord', 'org_admin', ORG)).toBe(false);
    expect(mayGrantRole(s, 'coord', 'coordinator', ORG)).toBe(true);
    expect(mayGrantRole(s, 'lead', 'translator', L)).toBe(true);
    expect(mayGrantRole(s, 'lead', 'translator', ORG)).toBe(false);
    expect(mayGrantRole(s, 'lead', 'org_admin', L)).toBe(false);
    expect(mayGrantRole(s, 'tr', 'viewer', L)).toBe(false); // no Invite
    expect(mayGrantRole(s, 'owner', 'nobody', ORG)).toBe(false);
  });

  it('lets nobody change or remove someone who holds more than they do', () => {
    const s = org();
    expect(mayChangeMembership(s, 'coord', 'owner', ORG)).toBe(false);
    expect(mayChangeMembership(s, 'coord', 'tr', L)).toBe(true);
    expect(mayChangeMembership(s, 'owner', 'coord', ORG)).toBe(true);
    expect(mayChangeMembership(s, 'lead', 'tr', L)).toBe(true);
    expect(mayChangeMembership(s, 'lead', 'coord', ORG)).toBe(false);
    expect(mayChangeMembership(s, 'tr', 'tr', L)).toBe(false); // no Invite
  });
});
