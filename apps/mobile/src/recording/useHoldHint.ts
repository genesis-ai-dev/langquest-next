// The first time someone taps a part's verse space, that space shows a
// fingertip holding it while the hold's ring fills, twice: holding opens the
// part's verses, for a range or none (LAN-133). The tap shows what a tap does;
// the hint shows what a hold does, without words. Once per phone or browser.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { noteExpected } from '../diagnostics/report';

const KEY = 'hint:hold-verse:v1';

export function useHoldHint(): { at: number | null; tapped: (i: number) => void; done: () => void } {
  const [at, setAt] = useState<number | null>(null);
  // Unknown until storage answers: a tap before then shows nothing.
  const seen = useRef<boolean | null>(null);
  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((v) => { seen.current = !!v; }, () => { seen.current = true; });
  }, []);
  return {
    at,
    tapped: (i) => {
      if (seen.current !== false) return;
      seen.current = true;
      setAt(i);
      void AsyncStorage.setItem(KEY, '1').catch((e: unknown) => noteExpected('hold hint: keep', e, 'write'));
    },
    done: () => setAt(null)
  };
}
