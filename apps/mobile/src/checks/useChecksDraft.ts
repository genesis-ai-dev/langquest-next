// New language's draft, for a screen to follow (checks/draft.ts holds it).
import { useSyncExternalStore } from 'react';
import { getDraft, listeners, type DraftSnapshot } from './draft';

export function useChecksDraft(): DraftSnapshot | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    getDraft,
    getDraft
  );
}
