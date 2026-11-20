import { parseKey } from '../invites/inviteCode';
import type { ScreenId } from '../shell/flow';

/*
 * The new phone finding the carrier by itself after Give the app (docs/nearby-sync-plan.md 14.5),
 * as pure rules. Once LangQuest is installed from Give the app's page, the new phone is still on the
 * carrier's Wi-Fi, and while the carrier shows a Let someone in code there, Give the app's server
 * answers `/join` with it. Only Android's files import this (useGiveJoinFinder.android.ts), so the
 * web and iPhone bundles carry none of it.
 */

/** How often the new phone asks Give the app's server for its join link while it may. */
export const GIVE_JOIN_ASK_MS = 4_000;

/**
 * The screens a phone with nobody on it waits on, where a found link takes the newcomer on to
 * joining as a scanned one would. Not `join_offline`, where it goes (a link found there again would
 * start a join under way over), nor Forgot password and New password, where someone with an
 * account is choosing a password and is no newcomer.
 */
const WAITING: readonly ScreenId[] = ['sign_in', 'create_account', 'explore_home', 'scan_qr', 'terms_privacy'];

/**
 * Whether the new phone asks: nobody is on it (`guest`: no one signed in and no local person, the
 * same condition under which a scanned join link goes to joining, routingModel `joinLinkRoute`), the
 * app is in front, the navigator is ready, no cover is down (nothing moves the screens under a
 * calculator, decision 171), and a newcomer's screen shows.
 */
export function asksForGiveJoin(o: { guest: boolean; active: boolean; ready: boolean; covered: boolean; screen: ScreenId }): boolean {
  return o.guest && o.active && o.ready && !o.covered && WAITING.includes(o.screen);
}

/**
 * The link to open from what Give the app's server answered: a Let someone in code (a `join` key,
 * never an invite, sign-in or reset link a server on some network might hand over), and only the
 * first of a run. A server on a network with no internet could answer a fresh link each time and
 * pull the phone back to joining every few seconds, so Sign In could never be used there (review,
 * 2026-11-20). After the first, a code is scanned, or opened from the page's Join, and Back from
 * joining stays back. The link's pin protects only against a phone other than the one that gave
 * the link: a link from such a server pins that server, which may learn the name typed, but grants
 * nothing, since a grant needs an inviter's chain to the root keys.
 */
export function giveJoinToOpen(found: string | null, opened: ReadonlySet<string>): string | null {
  const link = found?.trim() ?? '';
  if (!link || opened.size > 0 || parseKey(link)?.kind !== 'join') return null;
  return link;
}
