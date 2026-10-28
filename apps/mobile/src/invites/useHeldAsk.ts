import { useEffect, useState } from 'react';
import { readHeldAsk } from './heldAsk';
import type { HeldAsk } from './heldAskModel';

/** The language a guest tapped on Explore, while they sign in (heldAskModel.ts). */
export function useHeldAsk(): HeldAsk | null {
  const [ask, setAsk] = useState<HeldAsk | null>(null);
  useEffect(() => {
    let live = true;
    void readHeldAsk().then((a) => { if (live) setAsk(a); });
    return () => { live = false; };
  }, []);
  return ask;
}
