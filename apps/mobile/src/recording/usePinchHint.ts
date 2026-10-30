// The first time a phone shows a stopped recording session, two fingertips
// spread apart over its waveform, to show that pinching brings it nearer
// (Caleb, 2026-10-30; LAN-199). Once per phone; the web has no pinch.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { noteExpected } from '../diagnostics/report';

const KEY = 'hint:pinch-waveform:v1';
/** Asked once a run, by whichever waveform stops first. */
let asked = false;

export function usePinchHint(ready: boolean): { show: boolean; done: () => void } {
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
      void AsyncStorage.setItem(KEY, '1').catch((e: unknown) => noteExpected('pinch hint: keep', e, 'write'));
    }
  };
}
