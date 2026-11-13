import { useEffect, useRef, useState } from 'react';
import { doneAfterCount, doneAfterMove, type DoneMark } from './uploadsModel';

/**
 * True once `total` (what waits to upload) falls to zero from something, until
 * `screenKey` changes at least DONE_SHOWN_MS later (uploadsModel.ts `DoneMark`):
 * the bar goes as one screen gives way to the next, never under someone's tap.
 */
export function useJustEmptied(total: number, screenKey: string): boolean {
  const [done, setDone] = useState<DoneMark>(null);
  const was = useRef(total);
  useEffect(() => {
    const before = was.current;
    was.current = total;
    setDone((d) => doneAfterCount(d, before, total, Date.now()));
  }, [total]);
  const on = useRef(screenKey);
  useEffect(() => {
    if (on.current === screenKey) return;
    on.current = screenKey;
    setDone((d) => doneAfterMove(d, Date.now()));
  }, [screenKey]);
  return done !== null;
}
