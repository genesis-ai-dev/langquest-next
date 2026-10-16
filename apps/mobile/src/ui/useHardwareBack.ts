// A phone's Back for state inside one screen (a step, a sub-page, a
// confirmation), only while that screen is the one showing. A screen pushed
// on top keeps the Back of its own (NAV-061, "Ask for Peer check" from
// "Something else?"). Sheets need none of this: a Modal takes Back itself.
// The newest step open answers first (hardwareBack.ts), before the navigator
// pops the screen (shell/useRootBack.ts, decision 135).
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef } from 'react';
import { openBackStep } from './hardwareBack';

/** While `active`, Android's Back on this screen runs `onBack` instead of leaving the screen. */
export function useHardwareBack(active: boolean, onBack: () => void): void {
  const nav = useContext(NavigationContext);
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!active) return;
    return openBackStep({ showing: () => nav?.isFocused() ?? true, run: () => handler.current() });
  }, [active, nav]);
}
