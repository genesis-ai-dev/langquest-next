import { CommonActions, StackActions, createNavigationContainerRef, type NavigationState } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import type { Mode, ScreenId } from './flow';
import { routesAfter } from './panes';

/** A navigation stack entry: a spec screen id plus screen-specific params. */
export interface Route {
  screen: ScreenId;
  params?: Record<string, string>;
  /** The navigator's key for this entry, in the mirror; lets a list pane address its own route (panes.ts). */
  key?: string;
}

/** One native-stack route per spec screen; params are the screen's string map. */
export type StackParams = Record<ScreenId, Record<string, string> | undefined>;

/**
 * The single navigator. Module-level so `useNav` can dispatch to it from
 * outside the navigator's render tree (the Shell owns the auth-routing
 * effects and the tab bar, both of which sit around the navigator).
 */
export const navRef = createNavigationContainerRef<StackParams>();

/**
 * Stack navigation in the UX spec's vocabulary (push / replace / back /
 * reset / popTo), backed by React Navigation's native stack so screens get
 * platform transitions, iOS swipe-back and Android hardware back. Screens
 * never navigate to an undeclared target: `go` in App.tsx checks the edge
 * exists in `flow.ts` before calling any of these.
 *
 * `current` and `stack` mirror the navigator's state and update one render
 * after a dispatch, so callers that read them in effects settle in one extra
 * render. Dispatches before the container is ready are dropped; `ready`
 * flips once so those effects re-run.
 */
export function useNav(initial: Route) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const [ready, setReady] = useState(false);
  const current = stack[stack.length - 1]!;

  const onReady = useCallback(() => setReady(true), []);
  const onStateChange = useCallback((state: NavigationState | undefined) => {
    if (!state || state.routes.length === 0) return;
    setStack(
      state.routes.map((r) => {
        const params = r.params as Record<string, string> | undefined;
        return params ? { screen: r.name as ScreenId, params, key: r.key } : { screen: r.name as ScreenId, key: r.key };
      })
    );
  }, []);

  const push = useCallback((r: Route) => {
    if (navRef.isReady()) navRef.dispatch(StackActions.push(r.screen, r.params));
  }, []);
  const replace = useCallback((r: Route) => {
    if (navRef.isReady()) navRef.dispatch(StackActions.replace(r.screen, r.params));
  }, []);
  const reset = useCallback((r: Route) => {
    if (navRef.isReady()) navRef.dispatch(CommonActions.reset({ index: 0, routes: [{ name: r.screen, params: r.params }] }));
  }, []);
  const back = useCallback(() => {
    if (navRef.isReady() && navRef.canGoBack()) navRef.dispatch(CommonActions.goBack());
  }, []);
  /**
   * Pop until `screen` is on top (demo `popTo`); when it is not in the stack,
   * replace the top with it, so finished work is not reachable by Back.
   */
  const popTo = useCallback((screen: ScreenId, params?: Record<string, string>) => {
    if (!navRef.isReady()) return;
    const inStack = navRef.getRootState()?.routes.some((r) => r.name === screen);
    navRef.dispatch(inStack ? StackActions.popTo(screen, params, { merge: true }) : StackActions.replace(screen, params));
  }, []);

  /**
   * Move as if the entry `fromKey` were on top: a tap in the list pane of a
   * split (panes.ts). One reset to the stack `routesAfter` gives; entries
   * kept keep their keys, so they stay mounted. Reads the navigator's own
   * state, not the mirror, which can be a render behind.
   */
  const fromRoute = useCallback((fromKey: string, mode: Mode, r: Route) => {
    if (!navRef.isReady()) return;
    const state = navRef.getRootState();
    const at = state?.routes.findIndex((x) => x.key === fromKey) ?? -1;
    if (!state || at < 0) return;
    const kept = state.routes.map((x) => ({ key: x.key, name: x.name, params: x.params as object | undefined }));
    const routes = routesAfter<{ name: string; key?: string; params?: object }>(kept, at, mode, { name: r.screen, ...(r.params ? { params: r.params } : {}) });
    navRef.dispatch(CommonActions.reset({ index: routes.length - 1, routes }));
  }, []);

  return useMemo(
    () => ({ current, stack, ready, initial, push, replace, reset, back, popTo, fromRoute, onReady, onStateChange }),
    [current, stack, ready, initial, push, replace, reset, back, popTo, fromRoute, onReady, onStateChange]
  );
}
