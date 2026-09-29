import { CommonActions, StackActions, createNavigationContainerRef, type NavigationState } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import type { ScreenId } from './flow';

/** A navigation stack entry: a spec screen id plus screen-specific params. */
export interface Route {
  screen: ScreenId;
  params?: Record<string, string>;
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
        return params ? { screen: r.name as ScreenId, params } : { screen: r.name as ScreenId };
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

  return useMemo(
    () => ({ current, stack, ready, initial, push, replace, reset, back, popTo, onReady, onStateChange }),
    [current, stack, ready, initial, push, replace, reset, back, popTo, onReady, onStateChange]
  );
}
