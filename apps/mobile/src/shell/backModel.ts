import type { ScreenId } from './flow';
import { homeScreenFor, type Session } from './session';

/**
 * Where a phone's Back goes when nothing on the screen took it (no sheet, no
 * step to go back to) and nothing is under the screen in the stack: a tab's
 * own page, or a screen reached by a reset (a practice passage, a link).
 * Only the first screen a person lands on lets Back leave the app: their
 * home, or Sign In, or the welcome a first sign-in shows, and only when
 * pressed twice (`leavesNow`). Anywhere else it goes to that first screen,
 * as a tab other than the first goes back to the first tab on Android. Pure,
 * so it is tested without rendering (test/backModel.test.ts); useRootBack.ts
 * carries it out.
 */
export function backAtRoot(screen: ScreenId, session: Session): { leave: true } | { leave: false; to: ScreenId } {
  const start: ScreenId = session.isGuest ? 'sign_in' : homeScreenFor(session);
  if (screen === start || START_SCREENS.includes(screen)) return { leave: true };
  return { leave: false, to: start };
}

/** Screens that are the first a person sees: Back there leaves the app, when pressed again. */
const START_SCREENS: ScreenId[] = ['sign_in', 'welcome', 'welcome_back'];

/**
 * On a first screen, the first Back only says "Press Back again to leave"
 * (Caleb, 2026-10-16); a second one while that toast shows leaves. The toast
 * shows 3.5 seconds (ToastHost in App.tsx), so the second press counts as
 * long as the words are there to read.
 */
export const LEAVE_AGAIN_MS = 3500;
export function leavesNow(firstPressAt: number | null, now: number): boolean {
  return firstPressAt !== null && now - firstPressAt <= LEAVE_AGAIN_MS;
}
