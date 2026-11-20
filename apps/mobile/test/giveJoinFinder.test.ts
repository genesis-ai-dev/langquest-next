import { inviteUri, joinUri } from '../src/invites/inviteCode';
import { GIVE_JOIN_ASK_MS, asksForGiveJoin, giveJoinToOpen } from '../src/nearby/giveJoinFinderModel';
import type { ScreenId } from '../src/shell/flow';
import { GUEST_SCREENS } from '../src/shell/session';

/**
 * The new phone finding the carrier by itself after Give the app (src/nearby/giveJoinFinderModel.ts,
 * useGiveJoinFinder.android.ts; docs/nearby-sync-plan.md 14.5). Why these tests: a newly installed
 * LangQuest, still on the carrier's Wi-Fi, asks Give the app's server for the join link and goes
 * straight to joining, as a scanned link would; it must do so only on a phone with nobody on it
 * (as a scanned link goes to joining only then), only in front of a newcomer's screens and never
 * over a join under way, only for a Let someone in link (never an invite, sign-in or reset link a
 * server on some network hands it), and once for each link, so Back from joining stays back.
 */

const link = joinUri({ network: 'wifi-direct', ssid: 'DIRECT-gv-Android_1a2b', passphrase: 'give-pass-1234', port: 4300, secret: 'A'.repeat(22), pin: 'B'.repeat(21) + 'A' });

describe('when the new phone asks', () => {
  const at: { guest: boolean; active: boolean; ready: boolean; covered: boolean; screen: ScreenId } = { guest: true, active: true, ready: true, covered: false, screen: 'sign_in' };

  it('asks about every 4 seconds', () => {
    expect(GIVE_JOIN_ASK_MS).toBe(4_000);
  });

  it('asks only with nobody on the phone, the app in front and the navigator ready', () => {
    expect(asksForGiveJoin(at)).toBe(true);
    // Someone signed in, or a local person: never (a scanned link would not go to joining either).
    expect(asksForGiveJoin({ ...at, guest: false })).toBe(false);
    expect(asksForGiveJoin({ ...at, active: false })).toBe(false);
    expect(asksForGiveJoin({ ...at, ready: false })).toBe(false);
    // Never behind a cover: nothing moves the screens under a calculator (decision 171).
    expect(asksForGiveJoin({ ...at, covered: true })).toBe(false);
  });

  it('asks in front of the screens a newcomer waits on, never over joining or a password being reset', () => {
    for (const screen of ['sign_in', 'create_account', 'explore_home', 'scan_qr', 'terms_privacy'] as const) {
      expect(asksForGiveJoin({ ...at, screen })).toBe(true);
    }
    // Joining is where it goes: a link found there again would start a join under way over.
    expect(asksForGiveJoin({ ...at, screen: 'join_offline' })).toBe(false);
    // Someone with an account choosing a new password is no newcomer, and would lose what they typed.
    expect(asksForGiveJoin({ ...at, screen: 'forgot_password' })).toBe(false);
    expect(asksForGiveJoin({ ...at, screen: 'new_password' })).toBe(false);
    // Anywhere a signed-out phone is not, it never asks.
    expect(asksForGiveJoin({ ...at, screen: 'my_work' })).toBe(false);
    // Each screen it asks on is one a signed-out phone may be on.
    const flowScreens = ['sign_in', 'create_account', 'explore_home', 'scan_qr', 'terms_privacy', 'forgot_password', 'new_password', 'join_offline', 'my_work'] as const;
    expect(flowScreens.filter((screen) => asksForGiveJoin({ ...at, screen })).every((s) => GUEST_SCREENS.includes(s))).toBe(true);
  });
});

describe('what it opens', () => {
  it('opens one Let someone in link a run, and no other after it', () => {
    expect(giveJoinToOpen(link, new Set())).toBe(link);
    expect(giveJoinToOpen(`  ${link}\n`, new Set())).toBe(link);
    expect(giveJoinToOpen(link, new Set([link]))).toBeNull();
    // Not even a new one: a server on a network with no internet that answered a fresh link each time
    // would pull the phone back to joining every few seconds, and Sign In could never be used there
    // (review, 2026-11-20). A second code is scanned, or opened from the page's Join.
    const next = link.replace('h=4300', 'h=4301');
    expect(giveJoinToOpen(next, new Set([link]))).toBeNull();
  });

  it('opens nothing for no answer, or for any link that is not a Let someone in code', () => {
    expect(giveJoinToOpen(null, new Set())).toBeNull();
    expect(giveJoinToOpen('', new Set())).toBeNull();
    expect(giveJoinToOpen('hello', new Set())).toBeNull();
    expect(giveJoinToOpen(inviteUri('o1', 'tok'), new Set())).toBeNull();
    expect(giveJoinToOpen('langquestnext://signin?code=abc', new Set())).toBeNull();
    expect(giveJoinToOpen('https://next.langquest.org/reset#code=abc', new Set())).toBeNull();
    expect(giveJoinToOpen('langquestnext://join?v=1&t=wifi-direct', new Set())).toBeNull();
  });
});
