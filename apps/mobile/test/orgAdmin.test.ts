// The organization screens' derivations and event plans (src/orgAdmin.ts):
// who is listed where (ORG-5), what an admin may grant (ORG-6), what a role
// or scope change writes and how Undo puts it back (ORG-7, CORE-5), what a
// new language adds (ORG-2), and review teams (FLOW-5).
import { describe, expect, it } from 'vitest';
import {
  BIBLE_BOOKS, fold, foldOrg, HlcClock, languageProgress, laneName, selectTemplateSpecs,
  type AnyEvent, type EventPayloads, type EventSpec, type EventType, type LibraryItemView, type OrgState, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import type { LibraryChoice } from '../src/contentTemplates';
import {
  addLanguage, assignableLevels, booksInScope, changeMembership, editableAt, grantFloor, groupBelow, memberEntries, membersAbove,
  membersAt, newLaneId, progressLine, removeMembership, reviewEligible, saveTeam, suggestedTemplate, sumProgress,
  teamMembers
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
    // Every language counts, whichever partition is open (decisions.md 37).
    expect([...groupBelow(entries).keys()]).toEqual(['L1']);
    expect(groupBelow(entries).get('L1')!.map((e) => e.profileId).sort()).toEqual(['lin', 'tom']);
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
  const HASH = 'a'.repeat(64);
  const V11N = 'b'.repeat(64);
  const luke = BIBLE_BOOKS.find((b) => b.itemId === 'luk')!;
  const gen = BIBLE_BOOKS.find((b) => b.itemId === 'gen')!;
  const v11n: VersificationDoc = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { GEN: gen.verses, LUK: luke.verses, TOB: [22] }, mappedVerses: {} };
  const doc: TemplateDoc = {
    format: 'template@1', name: 'Bible chapters (English)', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Chapter' }],
    bible: { versification: V11N, books: [{ book: 'GEN', name: 'Genesis' }, { book: 'LUK', name: 'Luke' }, { book: 'TOB', name: 'Tobit' }], divide: 'chapters' },
    deps: [V11N]
  };
  const templateFor = (state: Parameters<typeof selectTemplateSpecs>[0], laneId: string, books?: string[]) =>
    selectTemplateSpecs(state, { commandId: `t-${laneId}`, laneId, itemId: 'lq.bible', docHash: HASH, doc, versification: v11n, ...(books ? { books } : {}) });

  it('covers a testament of a Bible template, or all of it', () => {
    expect(booksInScope(doc, 'nt')).toEqual(['LUK']);
    expect(booksInScope(doc, 'ot')).toEqual(['GEN']);
    expect(booksInScope(doc, 'all')).toBeUndefined();
    expect(booksInScope({ ...doc, structure: 'outline', outline: [] }, 'nt')).toBeUndefined();
  });

  it('starts the language\'s own partition, then adds the lane, its name, its template and its passages', () => {
    const state = projectFixture();
    const specs = addLanguage(state, { commandId: 'c9', laneId: 'L2', code: 'NUS', name: 'Nuer', template: templateFor(state, 'L2', booksInScope(doc, 'nt')) });
    // Each language is its own partition (decisions.md 37), and its first event starts it.
    expect(specs.slice(0, 4).map((s) => s.type)).toEqual(['v1.ProjectCreated', 'v1.LaneAdded', 'v1.LaneNamed', 'v2.LaneTemplateSelected']);
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
    const after = fold(fromSpecs(specs), state);
    expect(laneName(after, 'L2')).toBe('Nuer');
    expect(after.lanes['L2']!.languoidId).toBe('nus');
    expect(after.laneTemplates['L2']!.value).toMatchObject({ itemId: 'lq.bible', docHash: HASH, books: ['LUK'] });
    expect(languageProgress(after, 'L2').total).toBe(24);
    // Within one partition, units already there are not added again.
    const again = addLanguage(after, { commandId: 'c10', laneId: 'L3', code: 'shk', name: 'Shilluk', template: templateFor(after, 'L3', ['LUK']) });
    expect(again.map((s) => s.type)).toEqual(['v1.ProjectCreated', 'v1.LaneAdded', 'v1.LaneNamed', 'v2.LaneTemplateSelected']);
    expect(() => addLanguage(after, { commandId: 'c11', laneId: 'L2', code: 'x', name: 'X', template: [] })).toThrow();
  });

  it('starts from the template most languages use, else the LangQuest starter, else the first', () => {
    const ours = (itemId: string): LibraryChoice => ({ key: `ours:${itemId}`, source: 'ours', item: { itemId } as LibraryItemView, name: itemId, hash: HASH });
    const shared = (org: string, name: string): LibraryChoice => ({
      key: `shared:${org}/${name}`, source: 'shared', name, hash: HASH,
      shared: { org_id: org, org_name: org, item_id: name, kind: 'template', name, description: '', subscribable: true, version_count: 1, latest_hash: HASH, updated_hlc: '1' }
    });
    const starter = shared('langquest', 'FIA passages (English)');
    const base = projectFixture();
    const state = fold(fromSpecs([
      ...templateFor(base, 'L1'),
      { id: 'l9', type: 'v1.LaneAdded', payload: { laneId: 'L9', languoidId: 'nus' } } as EventSpec
    ]), base);
    expect(suggestedTemplate(state, [ours('mine'), ours('lq.bible'), starter])).toBe('ours:lq.bible');
    expect(suggestedTemplate(projectFixture(), [ours('mine'), shared('wa', 'Acts'), starter])).toBe(starter.key);
    expect(suggestedTemplate(null, [shared('wa', 'Acts')])).toBe('shared:wa/Acts');
    expect(suggestedTemplate(null, [])).toBeNull();
    expect(newLaneId('D I N', 'abcdef12-3456')).toBe('L-din-abcdef');
  });
});

describe('progress (ORG-1)', () => {
  it('says recorded and done, summed across languages', () => {
    expect(progressLine({ total: 0, recorded: 0, done: 0 })).toBe('No passages yet');
    expect(progressLine(sumProgress([{ total: 260, recorded: 12, done: 3 }, { total: 1000, recorded: 1, done: 0 }]))).toBe('13 of 1,260 recorded · 3 done');
  });
});
