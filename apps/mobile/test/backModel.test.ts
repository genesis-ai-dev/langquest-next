import { describe, expect, it } from 'vitest';
import { backAtRoot, LEAVE_AGAIN_MS, leavesNow } from '../src/shell/backModel';
import { deriveSession, homeScreenFor, tabsFor } from '../src/shell/session';
import { ORG, roleSession } from './sessions';

describe("Android's Back with nothing under the screen (NAV-061)", () => {
  it('leaves the app only from home', () => {
    for (const role of ['owner', 'translator', 'reviewer', 'viewer']) {
      const session = roleSession(role);
      expect(backAtRoot(homeScreenFor(session), session)).toEqual({ leave: true });
    }
  });

  it("goes home from every other tab's page, on a phone and on a wide window", () => {
    for (const role of ['owner', 'translator', 'reviewer', 'viewer']) {
      const session = roleSession(role);
      const home = homeScreenFor(session);
      for (const wide of [false, true]) {
        for (const tab of tabsFor(session, undefined, { wide })) {
          if (tab.screen === home) continue;
          expect(backAtRoot(tab.screen, session), `${role} ${tab.id}`).toEqual({ leave: false, to: home });
        }
      }
    }
  });

  it('goes home from a screen reached by a reset: the practice passage, a link to the scanner', () => {
    const translator = roleSession('translator');
    expect(backAtRoot('passage_record', translator)).toEqual({ leave: false, to: 'my_work' });
    expect(backAtRoot('scan_qr', translator)).toEqual({ leave: false, to: 'my_work' });
  });

  it('leaves from the first screens a person sees: Sign In and the welcomes', () => {
    const translator = roleSession('translator');
    for (const screen of ['sign_in', 'welcome', 'welcome_back'] as const) expect(backAtRoot(screen, translator)).toEqual({ leave: true });
  });

  it('signed out, everything leads to Sign In', () => {
    const guest = deriveSession('guest', null, false, null, null);
    expect(backAtRoot('sign_in', guest)).toEqual({ leave: true });
    for (const screen of ['scan_qr', 'explore_home', 'create_account', 'terms_privacy'] as const) {
      expect(backAtRoot(screen, guest)).toEqual({ leave: false, to: 'sign_in' });
    }
  });

  it('no organization: "Join your team" is home', () => {
    const stranger = deriveSession('stranger', 'stranger@x', true, ORG, 'din');
    expect(backAtRoot('intent_chooser', stranger)).toEqual({ leave: true });
    expect(backAtRoot('settings_home', stranger)).toEqual({ leave: false, to: 'intent_chooser' });
  });

  it('leaves only when pressed again while "Press Back again to leave" shows', () => {
    expect(leavesNow(null, 10_000)).toBe(false);
    expect(leavesNow(10_000, 10_000 + LEAVE_AGAIN_MS)).toBe(true);
    expect(leavesNow(10_000, 10_001 + LEAVE_AGAIN_MS)).toBe(false);
  });
});
