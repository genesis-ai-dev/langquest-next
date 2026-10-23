import { CommandError, foldOrg, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { readOnlyLanguage, readOnlyOrg, readOnlyRefusal, setReadOnlySession } from '../src/shell/readOnly';
import type { LanguageHandle } from '../src/sync/useLanguage';
import type { OrgHandle } from '../src/sync/useOrg';
import { accessOf, codeOf, keyInGroups } from '../src/account/globalViewerModel';
import { openLanguage } from '../src/shell/languages';
import { recordCan, teamStepsOpen } from '../src/passage/recordModel';
import { deriveSession, homeScreenFor, manageHomeFor, postSignInScreen, tabsFor } from '../src/shell/session';

// Global Viewers (decisions.md 158): the server lets them read every
// organization and refuses their writes; the app shows them what a Viewer sees.
let seq = 0;
const ORG = foldOrg([
  { type: 'v1.OrgCreated', payload: { name: 'Viewed' } },
  { type: 'v1.LanguageAdded', payload: { languageId: 'L-din', name: 'Dinka', code: 'din', sourceCode: 'eng' } },
  { type: 'v1.LanguageAdded', payload: { languageId: 'L-nus', name: 'Nuer', code: 'nus', sourceCode: 'eng' } },
  ...SEED_ROLES.map((r) => ({ type: 'v1.RoleDefined', payload: { roleId: r.roleId, name: r.name, privileges: r.privileges } })),
  { type: 'v1.MemberAdded', payload: { profileId: 'owner', roleId: 'org_admin', scope: { level: 'org' } } },
  { type: 'v1.MemberAdded', payload: { profileId: 'akol', roleId: 'translator', scope: { level: 'language', languageId: 'L-nus' } } }
].map((e) => ({ ...e, id: `g${++seq}`, orgId: 'org1', streamId: '_org', actorId: 'owner', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d` }) as AnyEvent));

describe('Global Viewer access as the server reports it', () => {
  it('reads the four states, and nothing else', () => {
    for (const s of ['needs_setup', 'needs_code', 'on', 'revoked'] as const) expect(accessOf({ globalViewer: s })).toBe(s);
    expect(accessOf({ globalViewer: null })).toBeNull();
    expect(accessOf({ globalViewer: 'admin' })).toBeNull();
    expect(accessOf({})).toBeNull();
    expect(accessOf(null)).toBeNull();
  });

  it('takes a code as six digits, spaces and all', () => {
    expect(codeOf('123 456')).toBe('123456');
    expect(codeOf('123-456')).toBe('123456');
    expect(codeOf('12345')).toBeNull();
    expect(codeOf('12345a')).toBeNull();
  });

  it('shows the key in groups of four for typing in', () => {
    expect(keyInGroups('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });
});

describe('a Global Viewer in an organization they are not in', () => {
  const viewing = deriveSession('gv', 'gv@example.org', true, ORG, 'L-din', false, 'on');

  it('sees what an admin sees, read-only (decision 158 amended)', () => {
    expect(viewing.readOnly).toBe(true);
    expect(viewing.can('manage_roles')).toBe(true);
    expect(viewing.isAdmin).toBe(true);
    expect(viewing.adminScope).toEqual({ level: 'org' });
    expect(viewing.hasNoOrg).toBe(false);
    // The overview, not a My Work of nothing to do; Manage opens the organization's page.
    expect(homeScreenFor(viewing)).toBe('status_home');
    expect(manageHomeFor(viewing)).toBe('org_home');
    expect(viewing.isGlobalViewer).toBe(true);
    expect(viewing.viewingAsGlobalViewer).toBe(true);
  });

  it('is offered nothing on a passage that would make work: no Edit or Record, no review, no note', () => {
    for (const p of ['translate', 'review', 'fill_reference', 'send_to_reviewers'] as const) expect(viewing.can(p)).toBe(false);
    const can = recordCan(viewing);
    expect([can.record, can.review, can.note, can.keep]).toEqual([false, false, false, false]);
  });

  it('is offered no review action either, though an admin\'s privileges assign work and override checkpoints', () => {
    expect([viewing.can('assign_work'), viewing.can('override_checkpoints')]).toEqual([true, true]);
    // No asking, logging, skipping or moving past a check, no Undo or Withdraw, and no check's sheet to offer them.
    expect(Object.values(recordCan(viewing)).every((x) => !x)).toBe(true);
    expect(teamStepsOpen(recordCan(viewing))).toBe(false);
  });

  it('has an admin\'s tabs but Work and the Inbox, where nothing arrives for them (decision 71 amended)', () => {
    expect(tabsFor(viewing).map((t) => t.id)).toEqual(['map', 'manage', 'me']);
    expect(tabsFor(viewing, undefined, { wide: true }).map((t) => t.id)).toEqual(['map', 'reports', 'manage', 'me']);
  });

  it('leaves everyone else\'s tabs alone, a member Global Viewer included', () => {
    const member = deriveSession('akol', 'akol@example.org', true, ORG, 'L-nus', false, 'on');
    expect(tabsFor(member).map((t) => t.id)).toEqual(['work', 'map', 'me']);
    expect(tabsFor(deriveSession('owner', 'owner@example.org', true, ORG, 'L-din')).map((t) => t.id)).toEqual(['work', 'map', 'manage', 'me']);
  });

  it('is not welcomed to a team they are only looking in on', () => {
    const first = deriveSession('gv', 'gv@example.org', false, ORG, 'L-din', false, 'on');
    expect(first.isFirstTime).toBe(false);
    expect(postSignInScreen(first)).toBe('status_home');
  });

  it('gets nothing until the code is entered, or once access ends', () => {
    for (const access of ['needs_setup', 'needs_code', 'revoked', null] as const) {
      const s = deriveSession('gv', 'gv@example.org', true, ORG, 'L-din', false, access);
      expect(s.privileges.size).toBe(0);
      expect(homeScreenFor(s)).toBe('intent_chooser');
      expect(s.viewingAsGlobalViewer).toBe(false);
      expect(s.readOnly).toBe(false);
    }
  });

  it('adds nothing before an organization has been read', () => {
    const none = deriveSession('gv', 'gv@example.org', true, null, null, false, 'on');
    expect(none.privileges.size).toBe(0);
    expect(none.isGlobalViewer).toBe(true);
    expect(none.viewingAsGlobalViewer).toBe(false);
  });

  it('keeps a member’s own role, and is not shown as only viewing there', () => {
    const member = deriveSession('akol', 'akol@example.org', true, ORG, 'L-nus', false, 'on');
    expect(member.privileges.has('translate')).toBe(true);
    expect(member.privileges.has('manage_roles')).toBe(false);
    expect(member.viewingAsGlobalViewer).toBe(false);
    expect(member.readOnly).toBe(false);
  });

  it('may open any language, where anyone else opens only their own', () => {
    expect(openLanguage(ORG, 'gv', { param: 'L-din' }, true)).toBe('L-din');
    expect(openLanguage(ORG, 'akol', { param: 'L-din' })).toBe('L-nus');
  });
});

describe('a read-only session writes nothing (readOnly.ts)', () => {
  const org = { state: null, append: () => Promise.resolve() } as unknown as OrgHandle;
  const language = { state: null, revision: 3, append: () => Promise.resolve(), appendMany: () => Promise.resolve(), run: () => Promise.resolve() } as unknown as LanguageHandle;

  it('refuses every way of adding an event, saying why', async () => {
    await expect(readOnlyOrg(org).append('v1.OrgRenamed', { name: 'x' })).rejects.toThrow(CommandError);
    const l = readOnlyLanguage(language);
    await expect(l.append('v1.NoteAdded' as never, {} as never)).rejects.toThrow('nothing here can be changed');
    await expect(l.appendMany([])).rejects.toThrow(CommandError);
    await expect(l.run([])).rejects.toThrow(CommandError);
  });

  it('leaves reading alone', () => {
    expect(readOnlyLanguage(language).revision).toBe(3);
  });
});

describe('a server refusal while read-only', () => {
  it('says the session is read-only, only for a refused write and only while viewing', () => {
    setReadOnlySession(true);
    expect(readOnlyRefusal({ code: '42501', message: 'not allowed to invite members' })).toMatch(/nothing here can be changed/);
    expect(readOnlyRefusal({ code: '08006', message: 'connection failure' })).toBeNull();
    setReadOnlySession(false);
    expect(readOnlyRefusal({ code: '42501', message: 'x' })).toBeNull();
  });
});
