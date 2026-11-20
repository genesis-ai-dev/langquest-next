import type { ScreenId } from '../shell/flow';
import { AUTH_SCREENS } from '../shell/session';

/*
 * The install file a carrier's browser hands the app with its Open (docs/nearby-sync-plan.md 14.4),
 * as pure rules. Only Android's files import this (handedFile.android.ts, useHandedFile.android.ts),
 * so the web bundle, which never gets one, carries none of it.
 */

/**
 * A link that is a file the phone's browser handed the app with its Open, when a download of the
 * app's own file type finished (core `CARRIED_FILE_TYPE`, docs/decisions/0246-a-carried-build-is-the-newcomers.md,
 * amended 2026-11-20): a content address, which no link the app opens otherwise is, since the
 * app's only filter for one is that type's (app.json).
 */
export function isHandedFile(url: string): boolean {
  return /^content:\/\/./i.test(url);
}

/**
 * Whether to open Download the install file for a file the browser handed the app with its Open
 * (handedFile.android.ts): one is held, someone is signed in (only a carrier downloads one), the
 * navigator is ready, and the app has routed past signing in, which a cold start goes through
 * first, so routing does not send the person on from it. Not when that screen is already showing:
 * it takes the file where it is, with its place on the stack.
 */
export function openForHandedFile(o: { held: boolean; signedIn: boolean; ready: boolean; screen: ScreenId }): boolean {
  return o.held && o.signedIn && o.ready && o.screen !== 'get_install_file' && !AUTH_SCREENS.includes(o.screen);
}
