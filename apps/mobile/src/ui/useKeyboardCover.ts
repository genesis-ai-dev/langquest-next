import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, type KeyboardEvent, type View } from 'react-native';
import { keyboardCover, keyboardTop } from './keyboardModel';

/**
 * How much of a view the on-screen keyboard covers, kept current as the
 * keyboard opens, changes and closes (kit's KeyboardSafe pads by it). The
 * view measures where it is on screen when the keyboard opens, and again on
 * layout, so a window that shrinks for the keyboard is not padded twice.
 * iOS says where the keyboard is going before it moves, and the padding
 * moves with it, in the keyboard's own time; Android says once it is there.
 */
export function useKeyboardCover() {
  const ref = useRef<View>(null);
  const top = useRef<number | null>(null);
  const shown = useRef(0);
  const [covered, setCovered] = useState(0);
  const remeasure = useCallback((motion?: KeyboardEvent) => {
    const cover = (next: number) => {
      if (next === shown.current) return;
      shown.current = next;
      if (motion && Platform.OS === 'ios') LayoutAnimation.configureNext(keyboardMotion(motion));
      setCovered(next);
    };
    const at = top.current;
    if (at === null) cover(0);
    // A keyboard that moved again before the view was measured is the later event's to say.
    else ref.current?.measureInWindow((_x, y, _w, height) => { if (top.current === at) cover(keyboardCover({ y, height }, at)); });
  }, []);
  useEffect(() => {
    // Opened with the keyboard already up.
    if (Keyboard.isVisible()) { top.current = keyboardTop(Keyboard.metrics(), Dimensions.get('window').height); remeasure(); }
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      top.current = keyboardTop(e.endCoordinates, Dimensions.get('window').height);
      remeasure(e);
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => { top.current = null; remeasure(e); });
    return () => { show.remove(); hide.remove(); };
  }, [remeasure]);
  const onLayout = useCallback(() => remeasure(), [remeasure]);
  return { ref, covered, onLayout };
}

/** The keyboard's own duration and curve, as React Native's KeyboardAvoidingView moves with it. */
function keyboardMotion(e: KeyboardEvent) {
  const duration = Math.max(e.duration, 10);
  return { duration, update: { duration, type: e.easing } };
}
