import { createNavigationContainerRef, type NavigationAction } from '@react-navigation/native';
import type { ScreenId } from './flow';
import type { useNav } from './useNav';

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

/** The key of the entry on top of the stack, as the navigator has it at this moment. */
function topKey(): string | null {
  if (!navRef.isReady()) return null;
  const routes = navRef.getRootState()?.routes;
  return routes?.[routes.length - 1]?.key ?? null;
}

const moveListeners = new Set<(to: string) => void>();

/**
 * Hears each move the shell starts, as it starts: `listener` gets the key of
 * the entry now on top, in the same turn as the dispatch, so what it changes
 * React draws together with the move. For what sits around the navigator and
 * must change with the screens, not a draw or two after them, as `useNav`'s
 * mirror does (the upload bar, sync/useJustEmptied.ts). A move the phone
 * starts (an iPhone's swipe back) is not heard here. Returns how to stop.
 */
export function onMove(listener: (to: string) => void): () => void {
  moveListeners.add(listener);
  return () => { moveListeners.delete(listener); };
}

/**
 * Dispatches to the navigator and, when another entry is on top after it,
 * tells `onMove`'s listeners. Every dispatch the shell makes goes through
 * here. The caller checks `navRef.isReady()`, as for a dispatch.
 */
export function dispatchMove(action: NavigationAction): void {
  const from = topKey();
  navRef.dispatch(action);
  const to = topKey();
  if (to !== null && to !== from) for (const listener of moveListeners) listener(to);
}

/** The shell's navigation: the stack as react-navigation reports it, and the moves on it. */
export type Nav = ReturnType<typeof useNav>;
