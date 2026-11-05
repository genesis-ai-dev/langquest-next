// The one time a phone shows a list of parts, its top part slides right to
// show the bin behind it, then back (Caleb, 2026-10-16: "a little animation
// ... the first time they use it"). Once per phone; the web has a mouse and
// no need of it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { noteExpected } from '../diagnostics/report';

const KEY = 'hint:swipe-part:v1';
/** Asked once a run, by whichever list shows parts first. */
let asked = false;

export function useSwipeHint(ready: boolean): { show: boolean; done: () => void } {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!ready || asked || Platform.OS === 'web') return;
    asked = true;
    void AsyncStorage.getItem(KEY).then((seen) => { if (!seen) setShow(true); }, () => undefined);
  }, [ready]);
  return {
    show,
    done: () => {
      setShow(false);
      void AsyncStorage.setItem(KEY, '1').catch((e: unknown) => noteExpected('swipe hint: keep', e, 'write'));
    }
  };
}
