import { deriveSession, tabsFor } from '../src/session';
import { addressSection } from '../src/shell/routingModel';
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
