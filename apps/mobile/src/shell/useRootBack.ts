import { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { takeHardwareBack } from '../ui/hardwareBack';
import { backAtRoot } from './backModel';
import { navRef, type Nav } from './nav';
import type { Session } from './session';

/**
 * Android's Back, for the whole app (decision 135): a step open on the
 * screen goes back one step (ui/hardwareBack.ts); else the screen under
 * this one comes back; with none, Back goes to the person's first screen,
 * and leaves the app only from there (backModel.ts). Sheets are Modals,
 * which take Back before any of this.
 *
 * Android asks the newest listener first, so this one must be newer than
 * the navigator's, which would pop the screen past its steps: it is added
 * once, by the component that draws the navigator (App.tsx), whose effects
 * run after everything inside it.
 *
 * Returns the same move for a Back arrow on a screen with nothing under it:
 * to the first screen, or nowhere when that is where it is.
 */
export function useRootBack(nav: Nav, session: Session): () => void {
  const live = useRef({ nav, session });
  live.current = { nav, session };
  const fromRoot = useCallback((): boolean => {
    const screen = navRef.isReady() ? navRef.getCurrentRoute()?.name : undefined;
    if (!screen) return false;
    const where = backAtRoot(screen, live.current.session);
    if (where.leave) return false;
    live.current.nav.reset({ screen: where.to });
    return true;
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (takeHardwareBack()) return true;
      if (!navRef.isReady()) return false;
      if (navRef.canGoBack()) { navRef.goBack(); return true; }
      return fromRoot();
    });
    return () => sub.remove();
  }, [fromRoot]);
  return useCallback(() => { void fromRoot(); }, [fromRoot]);
}
