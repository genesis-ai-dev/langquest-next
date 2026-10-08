// The admin's simple screens in plain words (src/simple/adminModel.ts,
// decision 71, demo ADR-039): which of the four questions are answered, how
// a template, a flow and a role read to an admin who knows nothing about the
// model, and the small sums behind the screens.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KINDS, FLOWS, foldOrg, HlcClock, ORG_STREAM, PRIVILEGES,
  type AnyEvent, type EventPayloads, type EventType, type OrgState, type Privilege, type TemplateDoc
} from '@langquest-next/core';
import {
  askedAgo, dropIndex, firstName, flipSwitch, flowShort, flowSub, flowTitle, flowWho, guideShortName, helpsSummary, invitedTo, joinAnd,
  languageLabel, languageTranslators, moveTo, plainRoleChoices, readableRef, readiness, recordExamples, recordKind, recordSummary,
  ROLE_SWITCHES, scopeLabel, scopeOfBooks, stepTitle, stepWho, switchState, translatorsOf
} from '../src/simple/adminModel';

let seq = 0;
const clock = new HlcClock('dev1', () => 1_700_000_000_000 + seq * 1000);
function o<T extends EventType>(type: T, payload: EventPayloads[T]): AnyEvent {
  seq += 1;
  return { id: `a${seq}`, type, orgId: 'o1', streamId: ORG_STREAM, actorId: 'admin', deviceId: 'dev1', hlc: clock.next(), payload } as AnyEvent;
}

const ALL = [...PRIVILEGES];
function org(extra: AnyEvent[] = []): OrgState {
  return foldOrg([
    o('v1.OrgCreated', { name: 'Sample' }),
    o('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ALL }),
    o('v1.RoleDefined', { roleId: 'coordinator', name: 'Coordinator', privileges: ALL.filter((p) => p !== 'manage_roles') }),
    o('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'fill_reference', 'send_to_reviewers', 'view_status'] }),
    o('v1.RoleDefined', { roleId: 'reviewer', name: 'Reviewer', privileges: ['review', 'view_status'] }),
    o('v1.LanguageAdded', { languageId: 'L1', name: 'Dinka', code: 'din', sourceCode: 'eng' }),
    o('v1.LanguageAdded', { languageId: 'L2', name: 'Hadiyya', code: 'hdy', sourceCode: 'eng' }),
    o('v1.MemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } }),
    o('v1.MemberAdded', { profileId: 'mary', roleId: 'coordinator', scope: { level: 'org' } }),
    o('v1.MemberAdded', { profileId: 'deng', roleId: 'translator', scope: { level: 'org' } }),
    ...extra
  ]);
}

const bible = (divide: 'passages' | 'chapters' | 'books', passages?: { ref: string; name?: string }[]): TemplateDoc => ({
  format: 'template@1', name: 'T', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Passage' }],
  bible: { versification: 'v', books: [{ book: 'GEN', name: 'Genesis' }, { book: 'LUK', name: 'Luke' }, { book: 'ACT', name: 'Acts' }], divide, ...(passages ? { passages } : {}) },
  deps: []
});

describe('the four questions', () => {
  it('are answered in order, and the first open one is the one to do next', () => {
    const r = readiness({ template: true, helps: false, flow: true, translators: 0, invited: false });
    expect(r.done).toEqual([true, false, true, false]);
    expect(r.current).toBe(1);
    expect(r.ready).toBe(false);
  });

  it('make a language ready once it has something to record, a way to check it and someone invited; help is offered, never required', () => {
    expect(readiness({ template: true, helps: false, flow: true, translators: 0, invited: true }).ready).toBe(true);
    expect(readiness({ template: true, helps: true, flow: true, translators: 2, invited: false })).toEqual({ done: [true, true, true, true], current: -1, ready: true });
    expect(readiness({ template: false, helps: true, flow: true, translators: 2, invited: true }).ready).toBe(false);
  });

  it('count the organization’s translators on the page, but only people invited for the language answer question 4', () => {
    const base = org();
    // Deng translates everywhere; Mary runs the team (she holds Translate too, but is not counted).
    expect(translatorsOf(base, 'L1')).toEqual(['deng']);
    expect(languageTranslators(base, 'L2')).toEqual([]);
    expect(invitedTo(base, 'L2')).toBe(false);
    const later = org([
      o('v1.MemberAdded', { profileId: 'ayen', roleId: 'translator', scope: { level: 'language', languageId: 'L2' } }),
      o('v1.InviteIssued', { inviteId: 'i1', roleId: 'translator', scope: { level: 'language', languageId: 'L1' }, expiresAt: '2030-01-01T00:00:00Z' }),
      o('v1.InviteIssued', { inviteId: 'i2', roleId: 'translator', scope: { level: 'org' }, expiresAt: '2030-01-01T00:00:00Z' })
    ]);
    expect(languageTranslators(later, 'L2')).toEqual(['ayen']);
    expect(translatorsOf(later, 'L2')).toEqual(['ayen', 'deng']);
    expect(invitedTo(later, 'L1')).toBe(true);
    // An invite for the whole organization does not answer a language's question.
    expect(invitedTo(later, 'L2')).toBe(false);
  });
});

describe('what they record, in plain words', () => {
  it('reads a template by how it divides the work', () => {
    expect(recordKind(bible('passages'))).toBe('stories');
    expect(recordKind(bible('chapters'))).toBe('chapters');
    expect(recordKind(bible('books'))).toBe('books');
    expect(recordKind({ ...bible('books'), structure: 'outline', outline: [] })).toBe('outline');
    expect(recordKind(null)).toBeNull();
  });

  it('shows a few examples, the lost sheep first when the set has it', () => {
    const doc = bible('passages', [{ ref: 'GEN 1:1-2:3' }, { ref: 'LUK 15:1-7', name: 'The lost sheep' }, { ref: 'LUK 15:8-10', name: 'The lost coin' }]);
    expect(recordExamples(doc)).toEqual(['The lost sheep · Luke 15:1–7', 'The lost coin · Luke 15:8–10']);
    expect(recordExamples(bible('passages', [{ ref: 'LUK 15:1-10' }, { ref: 'LUK 15:11-32' }]))).toEqual(['Luke 15:1–10', 'Luke 15:11–32']);
    expect(recordExamples(bible('chapters'))).toEqual(['Luke 15', 'Luke 16']);
    expect(recordExamples({ ...bible('books'), structure: 'outline', outline: [{ id: 'a', title: 'Washing hands' }, { id: 'b', title: 'Clean water' }] }))
      .toEqual(['Washing hands', 'Clean water']);
    expect(readableRef('1CO 13:1-13')).toBe('1 Corinthians 13:1–13');
  });

  it('names which part of the Bible a language records', () => {
    const doc = bible('passages', []);
    expect(scopeOfBooks(doc, undefined)).toBe('all');
    expect(scopeOfBooks(doc, ['LUK', 'ACT'])).toBe('nt');
    expect(scopeOfBooks(doc, ['GEN'])).toBe('ot');
    expect(scopeOfBooks(doc, ['GEN', 'LUK', 'ACT'])).toBe('all');
    expect(scopeOfBooks(doc, ['LUK'])).toBe('custom');
    expect(scopeLabel('custom', ['ACT', 'LUK'])).toBe('Luke and Acts');
    expect(scopeLabel('custom', ['GEN', 'ACT', 'LUK'])).toBe('3 books');
    expect(recordSummary(doc, ['LUK', 'ACT'])).toBe('Bible stories · New Testament');
    expect(recordSummary({ ...bible('books'), structure: 'outline', outline: [] }, undefined, 'Health lessons')).toBe('Health lessons');
  });
});

describe('who checks, in plain words', () => {
  const steps = (id: string) => FLOWS.find((f) => f.id === id)!.steps;
  it('says the shipped flows as an admin would', () => {
    expect(flowTitle(steps('standard_bible'), DEFAULT_KINDS)).toBe('Team, community, then a consultant');
    expect(flowShort(steps('standard_bible'), DEFAULT_KINDS)).toBe('Team, community, consultant');
    expect(flowTitle(steps('oral_review'), DEFAULT_KINDS)).toBe('Just the community');
    expect(flowSub(steps('oral_review'))).toBe('One check');
    expect(flowTitle(steps('consultant_only'), DEFAULT_KINDS)).toBe('Just a consultant');
    expect(flowTitle(steps('collect_only'), DEFAULT_KINDS)).toBe('No checks');
    expect(flowSub(steps('collect_only'))).toBe('Done once recorded');
    expect(flowSub(steps('standard_bible'))).toBe('3 checks');
  });

  it('lists who does each step, with a lock on the one that must pass', () => {
    expect(flowWho(steps('standard_bible'), DEFAULT_KINDS)).toEqual([
      { label: 'Another translator', lock: false }, { label: 'The community', lock: false },
      { label: 'A consultant', lock: true }, { label: 'You approve', lock: false }
    ]);
    expect(stepTitle(['peer', 'bt'], DEFAULT_KINDS)).toBe('Peer check and back translation');
    expect(stepTitle(['elder'], [{ id: 'elder', name: 'Elder Review', description: '', usualReviewer: 'The elders' }])).toBe('Elder Review');
    expect(stepWho(['elder'], [{ id: 'elder', name: 'Elder Review', description: '', usualReviewer: 'The elders' }])).toBe('The elders');
  });

  it('moves a dragged step by the cards it crossed, never past the ends', () => {
    expect(dropIndex(0, 170, 84, 4)).toBe(2);
    expect(dropIndex(3, -500, 84, 4)).toBe(0);
    expect(dropIndex(1, 20, 84, 4)).toBe(1);
    expect(dropIndex(1, 20, 0, 4)).toBe(1);
    expect(moveTo(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('what will they do, in plain words', () => {
  const roles = [
    { id: 'org_admin', name: 'Organization Admin', privileges: ALL },
    { id: 'coordinator', name: 'Coordinator', privileges: ALL.filter((p) => p !== 'manage_roles') },
    { id: 'translator', name: 'Translator', privileges: ['translate', 'view_status'] as Privilege[] },
    { id: 'reviewer', name: 'Reviewer', privileges: ['review', 'view_status'] as Privilege[] },
    { id: 'viewer', name: 'Viewer', privileges: ['view_status'] as Privilege[] }
  ];
  it('gives each choice the seed role, and back-translating the checking role when there is none of its own', () => {
    const { choices, others } = plainRoleChoices(roles);
    expect(choices.map((c) => [c.id, c.roleId])).toEqual([['translate', 'translator'], ['check', 'reviewer'], ['backtranslate', 'reviewer'], ['lead', 'coordinator']]);
    expect(others.map((r) => r.id)).toEqual(['org_admin', 'viewer']);
  });

  it('uses a back-translator role when the organization made one, and the closest role when a seed role is gone', () => {
    const made = [...roles.filter((r) => r.id !== 'translator'), { id: 'bt', name: 'Back-translator', privileges: ['review', 'translate'] as Privilege[] },
      { id: 'drafter', name: 'Drafter', privileges: ['translate', 'fill_reference'] as Privilege[] }];
    const { choices } = plainRoleChoices(made);
    expect(choices.find((c) => c.id === 'backtranslate')!.roleId).toBe('bt');
    expect(choices.find((c) => c.id === 'translate')!.roleId).toBe('drafter');
  });

  it('leaves out a choice with no role to give', () => {
    expect(plainRoleChoices([{ id: 'x', name: 'Everything', privileges: ALL }]).choices).toEqual([]);
  });
});

describe('a role as three groups of switches', () => {
  it('puts every permission under exactly one switch', () => {
    const all = ROLE_SWITCHES.flatMap((g) => g.rows.flatMap((r) => r.privileges));
    expect([...all].sort()).toEqual([...PRIVILEGES].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(ROLE_SWITCHES.map((g) => g.title)).toEqual(['Do the work', 'Check the work', 'Run the team']);
  });

  it('turns all of what a switch covers on or off, and says when a role has only some of it', () => {
    const setUp = ROLE_SWITCHES[2]!.rows.find((r) => r.label === 'Set up languages')!;
    expect(switchState(['manage_templates'], setUp)).toBe('some');
    expect(flipSwitch(['translate', 'manage_templates'], setUp)).toEqual(['manage_structure', 'manage_templates', 'shape_templates', 'translate']);
    expect(flipSwitch(['translate', 'manage_structure', 'manage_templates', 'shape_templates'], setUp)).toEqual(['translate']);
    expect(switchState(['translate'], ROLE_SWITCHES[0]!.rows[0]!)).toBe('on');
  });
});

describe('small words', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  it('say when someone asked', () => {
    expect(askedAgo('2026-10-08T11:50:00Z', now)).toBe('Asked 10 minutes ago');
    expect(askedAgo('2026-10-08T11:59:50Z', now)).toBe('Asked just now');
    expect(askedAgo('2026-10-08T09:00:00Z', now)).toBe('Asked 3 hours ago');
    expect(askedAgo('2026-10-07T11:00:00Z', now)).toBe('Asked yesterday');
    expect(askedAgo('2026-10-04T12:00:00Z', now)).toBe('Asked 4 days ago');
    expect(askedAgo(undefined, now)).toBe('Asked to join');
  });

  it('name people, languages and guides briefly', () => {
    expect(firstName('Deng Garang')).toBe('Deng');
    expect(languageLabel('amh')).toBe('Amharic');
    expect(languageLabel('xyz')).toBe('XYZ');
    expect(joinAnd(['Amharic', 'English', 'English'])).toBe('Amharic and English');
    expect(guideShortName('FIA study guides (English)')).toBe('FIA');
    expect(helpsSummary(['Amharic', 'English'], ['FIA'], 0)).toBe('Amharic and English Bibles · FIA guides');
    expect(helpsSummary([], [], 0)).toBe('Nothing offered yet');
  });
});
