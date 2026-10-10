// The organization screens' derivations and event plans (src/orgAdmin.ts):
// who is listed where (ORG-5), what an admin may grant (ORG-6), what a role
// or scope change writes and how Undo puts it back (ORG-7, CORE-5), what a
// new language adds (ORG-2), and review teams (FLOW-5).
import { describe, expect, it } from 'vitest';
import {
  BIBLE_BOOKS, emptyLanguageState, foldLanguage, foldOrg, HlcClock, languageInfo, languageName, languageProgress, ORG_STREAM, selectFlowSpecs,
  selectTemplateSpecs,
  type AnyEvent, type EventPayloads, type EventSpec, type EventType, type FlowDoc, type LibraryItemView, type OrgState, type TemplateDoc,
  type VersificationDoc
} from '@langquest-next/core';
import type { LibraryChoice } from '../src/contentTemplates';
import {
  addLanguage, assignableLevels, booksInScope, changeMembership, grantableLanguages, grantFloor, groupBelow, mayGrantAt, memberEntries,
  membersAbove, membersAt, newLanguageId, progressLine, removeMembership, reviewEligible, saveTeam, similarLanguages, STARTER_FLOW, suggestedChoice,
  sumProgress, teamMembers
} from '../src/orgAdmin';
import { STARTER_TEMPLATE } from '../src/contentTemplates';

let seq = 0;
const clock = new HlcClock('dev1', () => 1_700_000_000_000 + seq * 1000);
function ev<T extends EventType>(type: T, payload: EventPayloads[T], streamId = 'L1'): AnyEvent {
  seq += 1;
  return { id: `x${seq}`, type, orgId: 'o1', streamId, actorId: 'admin', deviceId: 'dev1', hlc: clock.next(), payload } as AnyEvent;
}
const fromSpecs = (specs: EventSpec[], streamId = 'L1') => specs.map((s) => ev(s.type, s.payload as never, streamId));
/** Apply org writes on top of a base built first, so the writes carry the later clocks. */
const applyOrg = (ops: { type: EventType; payload: unknown }[], base: OrgState) => foldOrg(ops.map((o) => ev(o.type, o.payload as never, ORG_STREAM)), base);

function orgFixture(): OrgState {
  const o = (type: EventType, payload: unknown) => ev(type, payload as never, ORG_STREAM);
  return foldOrg([
    o('v1.OrgCreated', { name: 'Wycliffe' }),
    o('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_structure', 'invite_members', 'review'] }),
    o('v1.RoleDefined', { roleId: 'lang_admin', name: 'Language Admin', privileges: ['manage_structure', 'invite_members'] }),
    o('v1.RoleDefined', { roleId: 'reviewer', name: 'Reviewer', privileges: ['review', 'view_status'] }),
    o('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate'] }),
    o('v1.LanguageAdded', { languageId: 'L1', name: 'Dinka', code: 'din', sourceCode: 'eng' }),
    o('v1.LanguageAdded', { languageId: 'L2', name: 'Nuer', code: 'nus', sourceCode: 'eng' }),
    o('v1.MemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } }),
    o('v1.MemberAdded', { profileId: 'pat', roleId: 'reviewer', scope: { level: 'org' } }),
    o('v1.MemberAdded', { profileId: 'lin', roleId: 'reviewer', scope: { level: 'language', languageId: 'L1' } }),
    o('v1.MemberAdded', { profileId: 'tom', roleId: 'translator', scope: { level: 'language', languageId: 'L1' } }),
    o('v1.MemberAdded', { profileId: 'sue', roleId: 'reviewer', scope: { level: 'language', languageId: 'L2' } }),
    o('v1.MemberAdded', { profileId: 'ada', roleId: 'lang_admin', scope: { level: 'language', languageId: 'L2' } }),
    o('v1.MemberAdded', { profileId: 'gone', roleId: 'reviewer', scope: { level: 'org' } }),
    o('v1.MemberRemoved', { profileId: 'gone', scope: { level: 'org' } })
  ]);
}

describe('what an admin may grant (ORG-6)', () => {
  const org = orgFixture();

  it('is where they hold Invite: the organization and every language, or their own language', () => {
    expect(assignableLevels(org, 'admin', 'org')).toEqual(['org', 'language']);
    expect(assignableLevels(org, 'admin', 'language')).toEqual(['language']);
    expect(grantableLanguages(org, 'admin')).toEqual(['L1', 'L2']);
    // A language admin grants only in their language, even from the organization's home.
    expect(assignableLevels(org, 'ada', 'org')).toEqual(['language']);
    expect(grantFloor(org, 'ada', 'org')).toBe('language');
    expect(grantableLanguages(org, 'ada')).toEqual(['L2']);
    expect(mayGrantAt(org, 'ada', { level: 'language', languageId: 'L1' })).toBe(false);
    expect(mayGrantAt(org, 'ada', { level: 'org' })).toBe(false);
    expect(assignableLevels(org, 'tom', 'org')).toEqual([]);
    expect(grantFloor(org, 'tom', 'org')).toBeNull();
  });
});

describe('members per level (ORG-5)', () => {
  const entries = memberEntries(orgFixture());

  it('lists active memberships at every scope, not removed ones', () => {
    expect(entries.map((e) => e.profileId).sort()).toEqual(['ada', 'admin', 'lin', 'pat', 'sue', 'tom']);
  });

  it('puts each person at their own level, the organization above a language as view only', () => {
    expect(membersAt(entries, 'org').map((e) => e.profileId).sort()).toEqual(['admin', 'pat']);
    expect(membersAt(entries, 'language', 'L1').map((e) => e.profileId).sort()).toEqual(['lin', 'tom']);
    expect(membersAbove(entries, 'org')).toEqual([]);
    expect(membersAbove(entries, 'language').map((e) => e.profileId).sort()).toEqual(['admin', 'pat']);
  });

  it('groups language members by language', () => {
    const groups = groupBelow(entries);
    expect([...groups.keys()].sort()).toEqual(['L1', 'L2']);
    expect(groups.get('L1')!.map((e) => e.profileId).sort()).toEqual(['lin', 'tom']);
  });
});

describe('changing a member (ORG-7)', () => {
  const pat = memberEntries(orgFixture()).find((e) => e.profileId === 'pat')!;

  it('writes nothing when nothing changed', () => {
    expect(changeMembership(pat, { roleId: 'reviewer', scope: pat.scope }).apply).toEqual([]);
  });

  it('changes a role in place, and Undo puts the old role back', () => {
    const base = orgFixture();
    const plan = changeMembership(pat, { roleId: 'translator', scope: pat.scope });
    const after = applyOrg(plan.apply, base);
    expect(after.members['pat']!['org']!.roleId.value).toBe('translator');
    const undone = applyOrg(plan.undo, after);
    expect(undone.members['pat']!['org']!.roleId.value).toBe('reviewer');
  });

  it('moves a member to a new scope and back', () => {
    const scope = { level: 'language' as const, languageId: 'L1' };
    const base = orgFixture();
    const plan = changeMembership(pat, { roleId: 'reviewer', scope });
    const after = applyOrg(plan.apply, base);
    expect(memberEntries(after).filter((e) => e.profileId === 'pat').map((e) => e.scope)).toEqual([scope]);
    const undone = applyOrg(plan.undo, after);
    expect(memberEntries(undone).filter((e) => e.profileId === 'pat').map((e) => e.scope)).toEqual([pat.scope]);
  });

  it('removes and restores', () => {
    const base = orgFixture();
    const plan = removeMembership(pat);
    const after = applyOrg(plan.apply, base);
    expect(memberEntries(after).some((e) => e.profileId === 'pat')).toBe(false);
    const undone = applyOrg(plan.undo, after);
    expect(memberEntries(undone).some((e) => e.profileId === 'pat')).toBe(true);
  });
});

describe('review teams (FLOW-5)', () => {
  it('offers people holding Review over the language, from the organization or that language', () => {
    expect(reviewEligible(orgFixture(), 'L1')).toEqual(['admin', 'lin', 'pat']);
    expect(reviewEligible(orgFixture(), 'L2')).toEqual(['admin', 'pat', 'sue']);
  });

  it('saves only what changed, and Undo restores the name and members', () => {
    let state = emptyLanguageState();
    const created = saveTeam(state, { commandId: 'c1', teamId: 't1', name: 'Elders', members: ['lin', 'pat'] });
    expect(created.undo).toBeNull();
    state = foldLanguage(fromSpecs(created.specs), state);
    expect(teamMembers(state, 't1')).toEqual(['lin', 'pat']);
    expect(saveTeam(state, { commandId: 'c2', teamId: 't1', name: 'Elders', members: ['pat', 'lin'] }).specs).toEqual([]);

    const edit = saveTeam(state, { commandId: 'c3', teamId: 't1', name: 'Church elders', members: ['pat', 'admin'] });
    const after = foldLanguage(fromSpecs(edit.specs), state);
    expect(after.teams['t1']!.name.value).toBe('Church elders');
    expect(teamMembers(after, 't1')).toEqual(['admin', 'pat']);
    const undone = foldLanguage(fromSpecs(edit.undo!()), after);
    expect(undone.teams['t1']!.name.value).toBe('Elders');
    expect(teamMembers(undone, 't1')).toEqual(['lin', 'pat']);
  });
});

describe('a new language (ORG-2)', () => {
  const HASH = 'a'.repeat(64);
  const FLOW_HASH = 'c'.repeat(64);
  const V11N = 'b'.repeat(64);
  const luke = BIBLE_BOOKS.find((b) => b.itemId === 'luk')!;
  const gen = BIBLE_BOOKS.find((b) => b.itemId === 'gen')!;
  const v11n: VersificationDoc = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { GEN: gen.verses, LUK: luke.verses, TOB: [22] }, mappedVerses: {} };
  const doc: TemplateDoc = {
    format: 'template@1', name: 'Bible chapters (English)', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Chapter' }],
    bible: { versification: V11N, books: [{ book: 'GEN', name: 'Genesis' }, { book: 'LUK', name: 'Luke' }, { book: 'TOB', name: 'Tobit' }], divide: 'chapters' },
    deps: [V11N]
  };
  const flowDoc: FlowDoc = {
    format: 'flow@1', name: 'Quick Check', description: '', deps: [],
    kinds: [{ id: 'peer', name: 'Peer Check', description: '', usualReviewer: 'peer' }],
    steps: [{ stepId: 's1', kindIds: ['peer'] }]
  };
  const template = (books?: string[]) =>
    selectTemplateSpecs(emptyLanguageState(), { commandId: 't', itemId: 'lq.bible', docHash: HASH, doc, versification: v11n, ...(books ? { books } : {}) });
  const flow = () => selectFlowSpecs(emptyLanguageState(), { commandId: 'f', itemId: 'lq.quick', docHash: FLOW_HASH, doc: flowDoc });

  it('covers a testament of a Bible template, or all of it', () => {
    expect(booksInScope(doc, 'nt')).toEqual(['LUK']);
    expect(booksInScope(doc, 'ot')).toEqual(['GEN']);
    expect(booksInScope(doc, 'custom', new Set(['LUK']))).toEqual(['LUK']);
    expect(booksInScope(doc, 'custom')).toEqual([]);
    expect(booksInScope(doc, 'all')).toBeUndefined();
    expect(booksInScope({ ...doc, structure: 'outline', outline: [] }, 'nt')).toBeUndefined();
  });

  it('lists the language in the organization, then starts its own stream with a template and a flow', () => {
    const org = orgFixture();
    const plan = addLanguage(org, { languageId: 'L3', code: 'SHK', name: 'Shilluk', template: template(booksInScope(doc, 'nt')), flow: flow() });
    expect(plan.added).toEqual({ languageId: 'L3', name: 'Shilluk', code: 'shk', sourceCode: 'eng' });
    expect(languageName(applyOrg([{ type: 'v1.LanguageAdded', payload: plan.added }], org), 'L3')).toBe('Shilluk');
    expect(new Set(plan.specs.map((s) => s.id)).size).toBe(plan.specs.length);
    const after = foldLanguage(fromSpecs(plan.specs, 'L3'));
    expect(after.template!.value).toMatchObject({ itemId: 'lq.bible', docHash: HASH, books: ['LUK'] });
    expect(after.flow!.value).toMatchObject({ itemId: 'lq.quick', docHash: FLOW_HASH });
    expect(languageProgress(after).total).toBe(24);
    expect(plan.link).toBeNull();
  });

  it('links a language picked from the language list, and leaves a typed one unlinked', () => {
    // Why: the link is what says which language in the world this is; the
    // code alone can be anything someone typed, offline above all.
    const org = orgFixture();
    const languoidId = '6d0c6d4e-3f0a-4c3e-9a51-6f3e2b9d7a10';
    const plan = addLanguage(org, { languageId: 'L3', code: 'DIK', name: 'Rek', template: template(), flow: flow(), languoidId });
    expect(plan.link).toEqual({ languageId: 'L3', code: 'dik', languoidId });
    const after = applyOrg([{ type: 'v1.LanguageAdded', payload: plan.added }, { type: 'v1.LanguageCodeSet', payload: plan.link! }], org);
    expect(languageInfo(after, 'L3')).toMatchObject({ name: 'Rek', code: 'dik', languoidId });
    expect(addLanguage(org, { languageId: 'L4', code: 'rek', name: 'Rek', template: template(), flow: flow(), languoidId: null }).link).toBeNull();
  });

  it('refuses a language with no code, no template or no flow, or one already there', () => {
    const org = orgFixture();
    expect(() => addLanguage(org, { languageId: 'L3', code: ' ', name: 'X', template: template(), flow: flow() })).toThrow('code');
    expect(() => addLanguage(org, { languageId: 'L3', code: 'x', name: 'X', template: template(), flow: [] })).toThrow('review flow');
    expect(() => addLanguage(org, { languageId: 'L3', code: 'x', name: 'X', template: [], flow: flow() })).toThrow('template');
    expect(() => addLanguage(org, { languageId: 'L1', code: 'x', name: 'X', template: template(), flow: flow() })).toThrow('already');
  });

  it('warns of a language already there under the same code or name, and only warns (decision 76)', () => {
    // Why: a new language gets a fresh id, so nothing refuses a second
    // Dinka; the admin is told before adding it, and may still go on.
    const org = orgFixture();
    const ids = (c: { code: string; name: string }) => similarLanguages(org, c).map((l) => l.languageId);
    expect(ids({ code: 'DIN ', name: 'Something else' })).toEqual(['L1']);
    expect(ids({ code: '', name: '  dinka ' })).toEqual(['L1']);
    expect(ids({ code: '', name: 'Nüer' })).toEqual(['L2']);
    expect(ids({ code: 'nus', name: 'Dinka' })).toEqual(['L1', 'L2']);
    expect(ids({ code: 'hdy', name: 'Hadiyya' })).toEqual([]);
    expect(ids({ code: '', name: '' })).toEqual([]);
    expect(similarLanguages(null, { code: 'din', name: 'Dinka' })).toEqual([]);
    // A renamed language is matched by the name it has now.
    const renamed = applyOrg([{ type: 'v1.LanguageRenamed', payload: { languageId: 'L1', name: 'Thuɔŋjäŋ' } }], org);
    expect(similarLanguages(renamed, { code: '', name: 'thuɔŋ jaŋ' }).map((l) => l.languageId)).toEqual(['L1']);
    expect(similarLanguages(renamed, { code: '', name: 'Dinka' })).toEqual([]);
    // Renaming a language: it is not a repeat of itself.
    expect(similarLanguages(org, { code: '', name: 'Dinka', except: 'L1' })).toEqual([]);
    expect(similarLanguages(org, { code: '', name: 'Nuer', except: 'L1' }).map((l) => l.languageId)).toEqual(['L2']);
  });

  it('suggests what the open language uses, else the LangQuest starter, else the first', () => {
    const ours = (itemId: string): LibraryChoice => ({ key: `ours:${itemId}`, source: 'ours', item: { itemId } as LibraryItemView, name: itemId, hash: HASH });
    const shared = (org: string, name: string): LibraryChoice => ({
      key: `shared:${org}/${name}`, source: 'shared', name, hash: HASH,
      shared: { org_id: org, org_name: org, item_id: name, kind: 'template', name, description: '', subscribable: true, version_count: 1, latest_hash: HASH, updated_hlc: '1' }
    });
    const starter = shared('langquest', STARTER_TEMPLATE.name);
    expect(suggestedChoice('lq.bible', [ours('mine'), ours('lq.bible'), starter], STARTER_TEMPLATE)).toBe('ours:lq.bible');
    expect(suggestedChoice(null, [ours('mine'), shared('wa', 'Acts'), starter], STARTER_TEMPLATE)).toBe(starter.key);
    expect(suggestedChoice(undefined, [shared('wa', 'Acts')], STARTER_FLOW)).toBe('shared:wa/Acts');
    expect(suggestedChoice(null, [], STARTER_FLOW)).toBeNull();
    expect(newLanguageId('D I N', 'abcdef12-3456')).toBe('L-din-abcdef');
  });
});

describe('progress (ORG-1)', () => {
  it('says recorded and done, summed across languages', () => {
    expect(progressLine({ total: 0, recorded: 0, done: 0 })).toBe('No passages yet');
    expect(progressLine(sumProgress([{ total: 260, recorded: 12, done: 3 }, { total: 1000, recorded: 1, done: 0 }]))).toBe('13 of 1,260 recorded · 3 done');
  });
});
