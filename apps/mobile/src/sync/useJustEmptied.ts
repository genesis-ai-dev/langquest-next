import { useEffect, useRef, useState } from 'react';
import { DONE_SHOWN_MS, emptiedStep } from './uploadsModel';

/** True for a moment after `total` (what waits to upload) falls to zero from something (uploadsModel.ts `emptiedStep`). */
export function useJustEmptied(total: number): boolean {
  const [justEmptied, setJustEmptied] = useState(false);
  const was = useRef(total);
  useEffect(() => {
    const step = emptiedStep(was.current, total);
    was.current = total;
    if (step === 'hide') { setJustEmptied(false); return undefined; }
    if (step === 'keep') return undefined;
    setJustEmptied(true);
    const timer = setTimeout(() => setJustEmptied(false), DONE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [total]);
  return justEmptied;
}
