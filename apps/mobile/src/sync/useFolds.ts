import { useCallback, useState } from 'react';
import type { SyncFold } from './syncScreenModel';

/**
 * Which of Sync and offline's folds are open: the ones `foldsOpenAtFirst` names as the screen
 * arrives, then whatever the person opens or closes. Not remembered: the screen starts short
 * each visit (docs/decisions/2026-11-18-sync-and-offline-one-screen.md).
 */
export function useFolds(atFirst: Set<SyncFold>): { isOpen: (f: SyncFold) => boolean; toggle: (f: SyncFold) => void } {
  const [open, setOpen] = useState(atFirst);
  const isOpen = useCallback((f: SyncFold) => open.has(f), [open]);
  const toggle = useCallback((f: SyncFold) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    return next;
  }), []);
  return { isOpen, toggle };
}
