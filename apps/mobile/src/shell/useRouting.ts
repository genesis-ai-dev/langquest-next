import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { Dimensions } from 'react-native';
import type { ScreenId } from './flow';
import { layoutKind } from '../ui/layout';
import { navRef, type Nav } from './nav';
import { AUTH_SCREENS, GUEST_SCREENS, homeScreenFor, postSignInScreen, type Session } from './session';
import { sectionAtLoad } from '../web/webHistory';
import { useWebHistory } from '../web/useWebHistory';
import { addressSection, routeOutcome } from './routingModel';
import type { Arrival } from './useOpenOrganization';
import { routeReached } from '../auth/authDiag';

/**
 * Where a person is sent, as a rule rather than a move. Auth routing is an
 * invariant, not a transition: a signed-in session is never on a pre-auth
 * screen, a signed-out one is only on the screens a guest may see. Checked
 * every render because it is a property of the state, not of an edge; each
 * branch makes its own guard false, so it settles in one extra render.
 *
 * `loaded`: both folds are in, the org synced once (foldsSettled), since
 * postSignInScreen reads the role out of them, and routing early sends an
 * admin to the wrong home, or a new member to no home at all. Rendering
 * does not wait on the log fold: the home screen for this actor is
 * remembered from the last session and routed to at once, and a role change
 * is caught once both folds are in.
 */
export function useRouting(o: {
  nav: Nav; session: Session; loaded: boolean; signedIn: boolean; ready: boolean; actorId: string; orgId: string;
  /** The server lists no organization for this person (useOpenOrganization). */
  noOrganizations: boolean;
  arrival: Arrival | null; openTask: (languageId: string, unitId: string) => void; setLanguage: (languageId: string) => void;
}) {
  const { nav, session, loaded, signedIn, ready } = o;
  // Web: the section the address named when the page loaded (a refresh), if this person may open it (webHistory.ts).
  const urlSection = useRef<ScreenId | null>(sectionAtLoad);
  const takeUrlSection = (): ScreenId | null => {
    const s = urlSection.current;
    urlSection.current = null;
    return addressSection(s, session, layoutKind(Dimensions.get('window').width) !== 'phone');
  };
  useWebHistory(nav.stack, nav.back);
  // A returning person first lands on their cached home; once the session is
  // in, the section in the address (a refresh) takes over, if they may open it.
  useEffect(() => {
    if (!loaded || !signedIn || !urlSection.current || session.isFirstTime) return;
    if (AUTH_SCREENS.includes(nav.current.screen)) return;
    const s = takeUrlSection();
    if (s && nav.current.screen !== s) nav.reset({ screen: s });
  });
  const homeKey = `home:${o.actorId}:${o.orgId}`;
  const [cachedHome, setCachedHome] = useState<ScreenId | null | undefined>(undefined);
  useEffect(() => {
    AsyncStorage.getItem(homeKey).then((v) => setCachedHome((v as ScreenId | null) ?? null)).catch(() => setCachedHome(null));
  }, [homeKey]);
  useEffect(() => {
    if (!loaded || !signedIn) return;
    const home = homeScreenFor(session);
    if (home !== cachedHome) {
      setCachedHome(home);
      AsyncStorage.setItem(homeKey, home).catch(() => {});
      if (cachedHome && nav.current.screen === cachedHome) nav.reset({ screen: home });
    }
  }, [loaded, signedIn, session, cachedHome, homeKey, nav]);
  // `nav.current` follows a reset one render late. This effect runs every render, so
  // a second render before that left a person on Sign In who had just been sent to
  // the section in the address, and sent them to the home instead (WEB-018).
  const sentOnFromAuth = useRef(false);
  useEffect(() => {
    if (!signedIn) {
      sentOnFromAuth.current = false;
      // Not "anything but sign_in": a guest legitimately walks to Create
      // account, Browse public languages, the terms and the invite scanner.
      if (!GUEST_SCREENS.includes(nav.current.screen)) nav.reset({ screen: 'sign_in' });
      return;
    }
    if (!ready) return;
    if (!AUTH_SCREENS.includes(nav.current.screen)) {
      sentOnFromAuth.current = false;
      // Diagnostics: how long from signing in (or starting) to a first screen, once per sign-in.
      routeReached(routeOutcome(o.orgId, o.noOrganizations));
      return;
    }
    if (loaded) {
      if (sentOnFromAuth.current) return;
      sentOnFromAuth.current = navRef.isReady();
      nav.reset({ screen: (!session.isFirstTime && takeUrlSection()) || postSignInScreen(session) });
    } else if (cachedHome && !session.isFirstTime) nav.reset({ screen: cachedHome });
  });
  // A refresh while the folds load went to the remembered home first; once they
  // are in, the section the address named still wins, if the person has not moved
  // on and may open it (WEB-018). Unknown home (still reading it) is not a move.
  useEffect(() => {
    if (!loaded || !signedIn || !urlSection.current || session.isFirstTime) return;
    if (cachedHome === undefined) return;
    // Still on Sign In: the address section is waiting for the session, not
    // abandoned. Clearing it here sent a sign-in from /settings to My Work (WEB-018).
    if (AUTH_SCREENS.includes(nav.current.screen)) return;
    if (nav.stack.length !== 1 || nav.current.screen !== cachedHome) { urlSection.current = null; return; }
    const s = takeUrlSection();
    if (s && s !== nav.current.screen) nav.reset({ screen: s });
  }, [loaded, signedIn, cachedHome]);
  // Opened from another organization's Inbox row or push: its passage, or its language, once this organization is in.
  const arrived = useRef(false);
  useEffect(() => {
    const open = o.arrival;
    if (!open || arrived.current || !loaded || !signedIn || AUTH_SCREENS.includes(nav.current.screen)) return;
    arrived.current = true;
    if (open.unitId) o.openTask(open.languageId, open.unitId);
    else o.setLanguage(open.languageId);
  });
}
