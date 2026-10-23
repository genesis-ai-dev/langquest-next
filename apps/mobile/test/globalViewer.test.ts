import { foldOrg, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { accessOf, codeOf, keyInGroups } from '../src/account/globalViewerModel';
import { openLanguage } from '../src/shell/languages';
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

  it('sees what a Viewer sees, and is no admin', () => {
    expect([...viewing.privileges]).toEqual(['view_status']);
    expect(viewing.isViewer).toBe(true);
    expect(viewing.isAdmin).toBe(false);
    expect(viewing.hasNoOrg).toBe(false);
    expect(homeScreenFor(viewing)).toBe('status_home');
    expect(manageHomeFor(viewing)).toBeNull();
    expect(viewing.isGlobalViewer).toBe(true);
    expect(viewing.viewingAsGlobalViewer).toBe(true);
  });

  it('has a tab of their own before Me, and a Viewer\'s others (decision 71 amended)', () => {
    expect(tabsFor(viewing).map((t) => t.id)).toEqual(['map', 'inbox', 'global', 'me']);
    expect(tabsFor(viewing).find((t) => t.id === 'global')?.screen).toBe('global_viewer');
    expect(tabsFor(viewing, undefined, { wide: true }).map((t) => t.id)).toEqual(['map', 'reports', 'inbox', 'global', 'me']);
  });

  it('gives nobody else the tab, a member Global Viewer included', () => {
    const member = deriveSession('akol', 'akol@example.org', true, ORG, 'L-nus', false, 'on');
    expect(tabsFor(member).some((t) => t.id === 'global')).toBe(false);
    expect(tabsFor(deriveSession('owner', 'owner@example.org', true, ORG, 'L-din')).some((t) => t.id === 'global')).toBe(false);
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
    expect(member.privileges.has('view_status')).toBe(true);
    expect(member.viewingAsGlobalViewer).toBe(false);
  });

  it('may open any language, where anyone else opens only their own', () => {
    expect(openLanguage(ORG, 'gv', { param: 'L-din' }, true)).toBe('L-din');
    expect(openLanguage(ORG, 'akol', { param: 'L-din' })).toBe('L-nus');
  });
});
