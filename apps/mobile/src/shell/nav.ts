import { createNavigationContainerRef } from '@react-navigation/native';
import type { ScreenId } from './flow';
import { useNav } from './useNav';
export { useNav } from './useNav';

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

/** The shell's navigation: the stack as react-navigation reports it, and the moves on it. */
export type Nav = ReturnType<typeof useNav>;
