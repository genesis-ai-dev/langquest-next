import { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { takeHardwareBack } from '../ui/hardwareBack';
import { toastTime } from '../ui/toastTime';
import { t } from '../i18n';
import { backAtRoot, leavesNow } from './backModel';
import { navRef, type Nav } from './nav';
import type { Session } from './session';

/**
 * Android's Back, for the whole app (decision 137): a step open on the
 * screen goes back one step (ui/hardwareBack.ts); else the screen under
 * this one comes back; with none, Back goes to the person's first screen,
 * and leaves the app only from there, when pressed again after "Press Back
 * again to leave" (backModel.ts). Sheets are Modals, which take Back before
 * any of this.
 *
 * Android asks the newest listener first, so this one must be newer than
 * the navigator's, which would pop the screen past its steps: it is added
 * once, by the component that draws the navigator (App.tsx), whose effects
 * run after everything inside it.
 *
 * Returns the same move for a Back arrow on a screen with nothing under it:
 * to the first screen, or nowhere when that is where it is.
 */
export function useRootBack(nav: Nav, session: Session, toast: (message: string) => void): () => void {
  const live = useRef({ nav, session, toast });
  live.current = { nav, session, toast };
  // When the last Back on a first screen said "Press Back again to leave".
  const askedAt = useRef<number | null>(null);
  /** To the first screen; 'leave' when this is it. */
  const fromRoot = useCallback((): 'moved' | 'leave' | 'none' => {
    const screen = navRef.isReady() ? navRef.getCurrentRoute()?.name : undefined;
    if (!screen) return 'none';
    const where = backAtRoot(screen, live.current.session);
    if (where.leave) return 'leave';
    live.current.nav.reset({ screen: where.to });
    return 'moved';
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (takeHardwareBack()) return true;
      if (!navRef.isReady()) return false;
      if (navRef.canGoBack()) { navRef.goBack(); return true; }
      const moved = fromRoot();
      if (moved !== 'leave') return moved === 'moved';
      const now = Date.now();
      if (leavesNow(askedAt.current, now, toastTime())) { askedAt.current = null; return false; }
      askedAt.current = now;
      live.current.toast(t('shell.nav.backAgainToLeave'));
      return true;
    });
    return () => sub.remove();
  }, [fromRoot]);
  return useCallback(() => { void fromRoot(); }, [fromRoot]);
}
