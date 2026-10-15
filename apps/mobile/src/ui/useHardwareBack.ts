// A phone's Back for state inside one screen (a sub-page, a sheet, a
// confirmation), only while that screen is the one showing. A screen pushed
// on top keeps the Back of its own: Android calls the newest listener first,
// so a listener left on the screen underneath swallowed Back on the one above
// (NAV-061, "Ask for Peer check" from "Something else?").
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

export function useHardwareBack(active: boolean, onBack: () => void): void {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => nav?.isFocused() ?? true);
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const offFocus = nav.addListener('focus', () => setFocused(true));
    const offBlur = nav.addListener('blur', () => setFocused(false));
    return () => { offFocus(); offBlur(); };
  }, [nav]);
  useEffect(() => {
    if (!active || !focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { handler.current(); return true; });
    return () => sub.remove();
  }, [active, focused]);
}
