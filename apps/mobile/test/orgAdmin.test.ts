// The organization screens' derivations and event plans (src/orgAdmin.ts):
// who is listed where (ORG-5), what an admin may grant (ORG-6), what a role
// or scope change writes and how Undo puts it back (ORG-7, CORE-5), what a
// new language adds (ORG-2), and review teams (FLOW-5).
import { describe, expect, it } from 'vitest';
import {
  fold, foldOrg, HlcClock, languageProgress, laneName,
  type AnyEvent, type EventPayloads, type EventSpec, type EventType, type OrgState
} from '@langquest-next/core';
import {
  addLanguage, assignableLevels, changeMembership, editableAt, grantFloor, groupBelow, memberEntries, membersAbove,
  membersAt, newLaneId, progressLine, removeMembership, reviewEligible, saveTeam, suggestedTemplate, sumProgress,
  teamMembers, unitsInScope
} from '../src/orgAdmin';

let seq = 0;
const clock = new HlcClock('dev1', () => 1_700_000_000_000 + seq * 1000);
function ev<T extends EventType>(type: T, payload: EventPayloads[T], projectId = 'p1'): AnyEvent {
  seq += 1;
  return { id: `x${seq}`, type, orgId: 'o1', projectId, actorId: 'admin', deviceId: 'dev1', hlc: clock.next(), payload } as AnyEvent;
}
const fromSpecs = (specs: EventSpec[]) => specs.map((s) => ev(s.type, s.payload as never));
/** Apply org writes on top of a base built first, so the writes carry the later clocks. */
const applyOrg = (ops: { type: EventType; payload: unknown }[], base: OrgState) => foldOrg(ops.map((o) => ev(o.type, o.payload as never, '_org')), base);

function orgFixture(): OrgState {
  return foldOrg([
    ev('v1.OrgCreated', { name: 'Wycliffe' }, '_org'),
    ev('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_structure', 'invite_members', 'review'] }, '_org'),
    ev('v1.RoleDefined', { roleId: 'reviewer', name: 'Reviewer', privileges: ['review', 'view_status'] }, '_org'),
    ev('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate'] }, '_org'),
    ev('v1.ProjectRegistered', { projectId: 'p1', name: 'Luke' }, '_org'),
    ev('v1.ProjectRegistered', { projectId: 'p2', name: 'Psalms' }, '_org'),
    ev('v1.OrgMemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } }, '_org'),
    ev('v1.OrgMemberAdded', { profileId: 'pat', roleId: 'reviewer', scope: { level: 'project', projectId: 'p1' } }, '_org'),
    ev('v1.OrgMemberAdded', { profileId: 'lin', roleId: 'reviewer', scope: { level: 'lane', projectId: 'p1', laneId: 'L1' } }, '_org'),
    ev('v1.OrgMemberAdded', { profileId: 'tom', roleId: 'translator', scope: { level: 'lane', projectId: 'p1', laneId: 'L1' } }, '_org'),
    ev('v1.OrgMemberAdded', { profileId: 'sue', roleId: 'reviewer', scope: { level: 'project', projectId: 'p2' } }, '_org'),
    ev('v1.OrgMemberAdded', { profileId: 'gone', roleId: 'reviewer', scope: { level: 'org' } }, '_org'),
    ev('v1.OrgMemberRemoved', { profileId: 'gone', scope: { level: 'org' } }, '_org')
  ]);
}

function projectFixture() {
  return fold([
    ev('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' }),
    ev('v1.MemberAdded', { profileId: 'old', role: 'reviewer' }),
    ev('v1.LaneAdded', { laneId: 'L1', languoidId: 'din' }),
    ev('v1.LaneTemplateSelected', { laneId: 'L1', templateId: 'bible', catalogVersion: 1 })
  ]);
}

describe('what an admin may grant (ORG-6)', () => {
  it('is the home level and below, never above your own scope, and never a project (decision 34)', () => {
    expect(assignableLevels({ level: 'org' }, 'org')).toEqual(['org', 'lane']);
    expect(assignableLevels({ level: 'org' }, 'lane')).toEqual(['lane']);
    // Someone assigned to all languages the old way grants at a language.
    expect(assignableLevels({ level: 'project', projectId: 'p1' }, 'org')).toEqual(['lane']);
    expect(assignableLevels({ level: 'lane', projectId: 'p1', laneId: 'L1' }, 'org')).toEqual(['lane']);
    expect(assignableLevels(null, 'org')).toEqual([]);
    expect(grantFloor({ level: 'project', projectId: 'p1' }, 'lane')).toBe('lane');
  });
});

describe('members per level (ORG-5)', () => {
  const org = orgFixture();
  const project = projectFixture();
  const entries = memberEntries(org, project, 'p1');

  it('lists active org memberships and project-log members, not removed ones', () => {
    expect(entries.map((e) => e.profileId).sort()).toEqual(['admin', 'lin', 'old', 'pat', 'sue', 'tom']);
    const old = entries.find((e) => e.profileId === 'old')!;
    expect(old.legacyRole).toBe('reviewer');
    expect(old.scope).toEqual({ level: 'project', projectId: 'p1' });
  });

  it('puts each person at their own level, higher levels above as view only', () => {
    // All languages of this organization's work partition read as the organization; p2 is not open.
    expect(membersAt(entries, 'org', 'p1').map((e) => e.profileId).sort()).toEqual(['admin', 'old', 'pat']);
    expect(membersAt(entries, 'lane', 'p1', 'L1').map((e) => e.profileId).sort()).toEqual(['lin', 'tom']);
    expect(membersAbove(entries, 'org', 'p1')).toEqual([]);
    expect(membersAbove(entries, 'lane', 'p1').map((e) => e.profileId).sort()).toEqual(['admin', 'old', 'pat']);
  });

  it('groups language members by language', () => {
    expect([...groupBelow(entries, 'p1').keys()]).toEqual(['L1']);
    expect(groupBelow(entries, 'p1').get('L1')!.map((e) => e.profileId).sort()).toEqual(['lin', 'tom']);
    expect(groupBelow(entries, 'p2').size).toBe(0);
  });

  it('edits only at the home level and below', () => {
    expect(editableAt({ level: 'lane', projectId: 'p1', laneId: 'L1' }, 'org')).toBe(true);
    expect(editableAt({ level: 'project', projectId: 'p1' }, 'org')).toBe(true);
    expect(editableAt({ level: 'org' }, 'lane')).toBe(false);
  });
});

describe('changing a member (ORG-7)', () => {
  const org = orgFixture();
  const pat = memberEntries(org, null, 'p1').find((e) => e.profileId === 'pat')!;

  it('writes nothing when nothing changed', () => {
    expect(changeMembership(pat, { roleId: 'reviewer', scope: pat.scope }).apply).toEqual([]);
  });

  it('changes a role in place, and Undo puts the old role back', () => {
    const base = orgFixture();
    const plan = changeMembership(pat, { roleId: 'translator', scope: pat.scope });
    const after = applyOrg(plan.apply, base);
    expect(after.members['pat']!['project:p1']!.roleId.value).toBe('translator');
    const undone = applyOrg(plan.undo, after);
    expect(undone.members['pat']!['project:p1']!.roleId.value).toBe('reviewer');
  });

  it('moves a member to a new scope and back', () => {
    const scope = { level: 'lane' as const, projectId: 'p1', laneId: 'L1' };
    const base = orgFixture();
    const plan = changeMembership(pat, { roleId: 'reviewer', scope });
    const after = applyOrg(plan.apply, base);
    expect(memberEntries(after, null, 'p1').filter((e) => e.profileId === 'pat').map((e) => e.scope)).toEqual([scope]);
    const undone = applyOrg(plan.undo, after);
    expect(memberEntries(undone, null, 'p1').filter((e) => e.profileId === 'pat').map((e) => e.scope)).toEqual([pat.scope]);
  });

  it('removes and restores', () => {
    const base = orgFixture();
    const plan = removeMembership(pat);
    const after = applyOrg(plan.apply, base);
    expect(memberEntries(after, null, 'p1').some((e) => e.profileId === 'pat')).toBe(false);
    const undone = applyOrg(plan.undo, after);
    expect(memberEntries(undone, null, 'p1').some((e) => e.profileId === 'pat')).toBe(true);
  });
});

describe('review teams (FLOW-5)', () => {
  it('offers people holding Review over the language', () => {
    expect(reviewEligible(orgFixture(), projectFixture(), 'p1', 'L1')).toEqual(['admin', 'lin', 'old', 'pat']);
  });

  it('saves only what changed, and Undo restores the name and members', () => {
    let state = projectFixture();
    const created = saveTeam(state, { commandId: 'c1', teamId: 't1', laneId: 'L1', name: 'Elders', members: ['lin', 'pat'] });
    expect(created.undo).toBeNull();
    state = fold(fromSpecs(created.specs), state);
    expect(teamMembers(state, 't1')).toEqual(['lin', 'pat']);
    expect(saveTeam(state, { commandId: 'c2', teamId: 't1', laneId: 'L1', name: 'Elders', members: ['pat', 'lin'] }).specs).toEqual([]);

    const edit = saveTeam(state, { commandId: 'c3', teamId: 't1', laneId: 'L1', name: 'Church elders', members: ['pat', 'old'] });
    const after = fold(fromSpecs(edit.specs), state);
    expect(after.teams['t1']!.name.value).toBe('Church elders');
    expect(teamMembers(after, 't1')).toEqual(['old', 'pat']);
    const undone = fold(fromSpecs(edit.undo!()), after);
    expect(undone.teams['t1']!.name.value).toBe('Elders');
    expect(teamMembers(undone, 't1')).toEqual(['lin', 'pat']);
  });
});

describe('a new language (ORG-2)', () => {
  it('covers a testament of the Bible', () => {
    const nt = unitsInScope('bible', 'nt');
    expect(nt.filter((u) => u.parentUnitId === null)).toHaveLength(27);
    expect(nt.filter((u) => u.parentUnitId !== null)).toHaveLength(260);
    expect(unitsInScope('bible', 'ot').filter((u) => u.parentUnitId === null)).toHaveLength(39);
  });

  it('adds the lane, its name, its template and the passages the project lacks', () => {
    const state = projectFixture();
    const specs = addLanguage(state, { commandId: 'c9', laneId: 'L2', code: 'NUS', name: 'Nuer', templateId: 'bible', scope: 'nt' });
    expect(specs.slice(0, 3).map((s) => s.type)).toEqual(['v1.LaneAdded', 'v1.LaneNamed', 'v1.LaneTemplateSelected']);
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
    const after = fold(fromSpecs(specs), state);
    expect(laneName(after, 'L2')).toBe('Nuer');
    expect(after.lanes['L2']!.languoidId).toBe('nus');
    expect(languageProgress(after, 'L2').total).toBe(260);
    // Units are shared across languages: a second one adds none of them again.
    const again = addLanguage(after, { commandId: 'c10', laneId: 'L3', code: 'shk', name: 'Shilluk', templateId: 'bible', scope: 'nt' });
    expect(again.map((s) => s.type)).toEqual(['v1.LaneAdded', 'v1.LaneNamed', 'v1.LaneTemplateSelected']);
    expect(() => addLanguage(after, { commandId: 'c11', laneId: 'L2', code: 'x', name: 'X', templateId: 'bible', scope: 'nt' })).toThrow();
  });

  it('starts from the template the project already uses', () => {
    expect(suggestedTemplate(projectFixture(), orgFixture(), 'p1')).toBe('bible');
    expect(suggestedTemplate(fold([]), null, 'p1')).toBe('fia');
    expect(newLaneId('D I N', 'abcdef12-3456')).toBe('L-din-abcdef');
  });
});

describe('progress (ORG-1)', () => {
  it('says recorded and done, summed across languages', () => {
    expect(progressLine({ total: 0, recorded: 0, done: 0 })).toBe('No passages yet');
    expect(progressLine(sumProgress([{ total: 260, recorded: 12, done: 3 }, { total: 1000, recorded: 1, done: 0 }]))).toBe('13 of 1,260 recorded · 3 done');
  });
});
