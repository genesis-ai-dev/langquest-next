import { deriveSession, tabsFor } from '../src/session';
import { addressSection } from '../src/shell/routingModel';
import { pathFor, sectionOfPath } from '../src/webPaths';
import { ORG, roleSession } from './sessions';

describe('the section a web address names (WEB-018, WEB-019)', () => {
  it('opens one of this person\'s tabs, and nothing else', () => {
    for (const role of ['owner', 'translator', 'reviewer']) {
      const session = roleSession(role);
      for (const tab of tabsFor(session, undefined, { wide: true })) expect(addressSection(tab.screen, session, true)).toBe(tab.screen);
      expect(addressSection('passage_record', session, true)).toBeNull();
    }
  });

  it("a language's page opens wherever the organization's does", () => {
    const owner = roleSession('owner');
    const hasOrgHome = tabsFor(owner, undefined, { wide: true }).some((t) => t.screen === 'org_home');
    expect(addressSection('language_home', owner, true)).toBe(hasOrgHome ? 'language_home' : null);
  });

  it('no organization: only "Join your team", whatever the address says', () => {
    const stranger = deriveSession('stranger', 'stranger@x', true, ORG, 'din');
    expect(stranger.hasNoOrg).toBe(true);
    expect(addressSection('my_work', stranger, true)).toBeNull();
  });

  it('no section named: nothing to open', () => {
    expect(addressSection(null, roleSession('owner'), false)).toBeNull();
  });
});

// What the e2e per-role tests held: each role's tabs, the address each names, and the refusals.
describe('WEB-017 the address names the section, per role', () => {
  const addresses = (role: string) => tabsFor(roleSession(role), undefined, { wide: true }).map((t) => [t.id, pathFor([{ screen: t.screen }])]);

  it('an administrator: work, map, reports, manage, settings', () => {
    expect(addresses('owner')).toEqual([['work', '/work'], ['map', '/map'], ['reports', '/reports'], ['manage', '/manage'], ['me', '/settings']]);
  });

  it('a translator: the language map, not the status map; no manage', () => {
    expect(addresses('translator')).toContainEqual(['map', '/map/language']);
    expect(addresses('translator').map(([id]) => id)).not.toContain('manage');
  });

  it("a language's leader: manage is the language page", () => {
    expect(addresses('akol')).toContainEqual(['manage', '/manage/language']);
  });

  it('a viewer: the inbox stands where My Work would', () => {
    expect(addresses('viewer')).toContainEqual(['inbox', '/inbox']);
  });

  it('no organization: the address is the root', () => {
    expect(pathFor([{ screen: 'explore_home' }])).toBe('/');
  });

  it('a screen opened inside a section keeps the section address, with no id in it', () => {
    expect(pathFor([{ screen: 'my_work' }, { screen: 'passage_record', params: { unitId: 'u-1' } }])).toBe('/work');
  });
});

describe('WEB-019 a refresh never opens a section the person may not open, per role', () => {
  const opens = (role: string, path: string, wide: boolean) => addressSection(sectionOfPath(path), roleSession(role), wide);

  it('a translator is refused Manage, and Reports on a phone', () => {
    expect(opens('translator', '/manage', true)).toBeNull();
    expect(opens('translator', '/reports', false)).toBeNull();
    expect(opens('translator', '/reports', true)).toBe('reports_home');
  });

  it('a viewer is refused My Work', () => {
    expect(opens('viewer', '/work', true)).toBeNull();
    expect(opens('viewer', '/map', true)).toBe('status_home');
  });

  it('no organization is refused every section', () => {
    const stranger = deriveSession('stranger', 'stranger@x', true, ORG, 'din');
    for (const p of ['/work', '/map', '/map/language', '/reports', '/manage', '/inbox', '/settings']) {
      expect(addressSection(sectionOfPath(p), stranger, true)).toBeNull();
    }
  });
});
