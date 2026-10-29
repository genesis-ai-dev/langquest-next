// A phone's Back for state inside one screen (a step, a sub-page, a
// confirmation), only while that screen is the one showing. A screen pushed
// on top keeps the Back of its own (NAV-061, "Ask for Peer check" from
// "Something else?"). Sheets need none of this: a Modal takes Back itself.
// The newest step open answers first (hardwareBack.ts), before the navigator
// pops the screen (shell/useRootBack.ts, decision 137).
//
// iOS has no Back button, and its back swipe cannot be turned into a step
// back: it would pop the screen past its steps, or end a recording session
// without the ✓ (decision 137's gap). While a step is open the swipe is off,
// so the screen's own ‹ or ✕ is the way back.
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { openBackStep } from './hardwareBack';

/** How many open steps hold each screen's swipe off. */
const swipeHolds = new WeakMap<object, number>();

/** While `active`, Android's Back on this screen runs `onBack` instead of leaving the screen, and iOS's back swipe is off. */
export function useHardwareBack(active: boolean, onBack: () => void): void {
  const nav = useContext(NavigationContext);
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!active) return;
    return openBackStep({ showing: () => nav?.isFocused() ?? true, run: () => handler.current() });
  }, [active, nav]);
  useSwipeBackOff(active);
}

/** While `off`, iOS's back swipe is off on this screen; counted, so two parts of one screen that hold it agree. */
export function useSwipeBackOff(off: boolean): void {
  const nav = useContext(NavigationContext);
  useEffect(() => {
    if (!off || !nav || Platform.OS !== 'ios') return;
    const holds = (swipeHolds.get(nav) ?? 0) + 1;
    swipeHolds.set(nav, holds);
    if (holds === 1) nav.setOptions({ gestureEnabled: false });
    return () => {
      const left = (swipeHolds.get(nav) ?? 1) - 1;
      swipeHolds.set(nav, left);
      if (left === 0) nav.setOptions({ gestureEnabled: true });
    };
  }, [off, nav]);
}
