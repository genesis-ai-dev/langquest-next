import { CommonActions } from '@react-navigation/native';
import { useCallback } from 'react';
import { edgeFor, TAB_SCREENS, type ScreenId } from './flow';
import { t } from '../i18n';
import { navRef, type Nav, type Route } from './nav';
import { reportError } from '../diagnostics/report';
import { edgeAllowed, homeScreenFor, type Session } from './session';

/**
 * Moves between screens. Every move follows a declared edge (flow.ts) from
 * the screen it starts on: the top of the stack, or the list in a split's
 * pane (`fromKey`), which moves as if it were on top (panes.ts). Gates are
 * permissions, so a move the session may not make is refused and said.
 */
export function useNavActions(o: { nav: Nav; session: Session; toast: (message: string) => void; remember: (unitId: string, languageId: string) => void }) {
  const { nav, session, toast, remember } = o;
  const goFrom = useCallback(
    (from: ScreenId, fromKey: string | undefined, to: ScreenId, params?: Record<string, string>) => {
      const edge = edgeFor(from, to) ?? (edgeFor(from, 'home_hub') && to === homeScreenFor(session) ? edgeFor(from, 'home_hub') : undefined);
      const route: Route = params ? { screen: to, params } : { screen: to };
      if (!edge) {
        if (TAB_SCREENS.includes(to)) return nav.reset(route);
        reportError(`flow blocked ${from} -> ${to}: no edge`, new Error('undeclared transition'));
        toast(t('shell.nav.cannotOpenHere'));
        return;
      }
      // Gates are permissions (who MAY act), part of the machine: a screen
      // must not offer an affordance the session cannot take.
      if (!edgeAllowed(edge, session)) {
        reportError(`flow blocked ${from} -> ${to}: gate ${edge.when}`, new Error('gate not met'));
        toast(t('shell.nav.noPermission'));
        return;
      }
      const mode = edge.mode ?? 'push';
      if (fromKey && fromKey !== nav.stack[nav.stack.length - 1]?.key) return nav.fromRoute(fromKey, mode, route);
      switch (mode) {
        case 'push': return nav.push(route);
        case 'replace': return nav.replace(route);
        case 'reset': return nav.reset(route);
        case 'back': return nav.back();
        case 'popTo': return nav.popTo(to, params);
      }
    },
    [nav, session, toast]
  );
  const go = useCallback((to: ScreenId, params?: Record<string, string>) => goFrom(nav.current.screen, undefined, to, params),
    [goFrom, nav.current.screen]);
  const openPassage = useCallback((unitId: string, inLanguage: string, extra?: Record<string, string>) => {
    remember(unitId, inLanguage);
    go('passage_record', { unitId, languageId: inLanguage, ...extra });
  }, [go, remember]);
  // A task opened from outside the screens (a push, another organization's Inbox row) opens over the home screen, so Back leads home.
  const openTask = useCallback((inLanguage: string, unitId: string) => {
    remember(unitId, inLanguage);
    const params = { unitId, languageId: inLanguage };
    if (navRef.isReady()) navRef.dispatch(CommonActions.reset({ index: 1, routes: [{ name: homeScreenFor(session) }, { name: 'passage_record', params }] }));
    else nav.reset({ screen: 'passage_record', params });
  }, [remember, session, nav.reset]);
  return { goFrom, go, openPassage, openTask };
}
