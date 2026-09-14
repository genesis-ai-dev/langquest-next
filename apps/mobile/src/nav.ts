import { useCallback, useState } from 'react';
import type { ScreenId } from './flow';

/** A navigation stack entry: a spec screen id plus screen-specific params. */
export interface Route {
  screen: ScreenId;
  params?: Record<string, string>;
}

/**
 * Minimal stack navigation, same vocabulary as the UX spec (push / replace /
 * back / reset). Screens never navigate to an undeclared target: `go` checks
 * the edge exists in `flow.ts` and logs when it does not, so the flowchart
 * and the app cannot drift.
 */
export function useNav(initial: Route) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const current = stack[stack.length - 1]!;

  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const replace = useCallback((r: Route) => setStack((s) => [...s.slice(0, -1), r]), []);
  const reset = useCallback((r: Route) => setStack([r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  /** Pop until `screen` is on top; reset to it if it is not in the stack. */
  const popTo = useCallback(
    (screen: ScreenId) =>
      setStack((s) => {
        const i = s.map((r) => r.screen).lastIndexOf(screen);
        return i >= 0 ? s.slice(0, i + 1) : [{ screen }];
      }),
    []
  );

  return { current, stack, push, replace, reset, back, popTo };
}
