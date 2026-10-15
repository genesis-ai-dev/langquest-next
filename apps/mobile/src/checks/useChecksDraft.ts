// The checks being drafted, for a screen to follow (checks/draft.ts holds them).
import { useSyncExternalStore } from 'react';
import { draft, listeners, type ChecksDraft } from './draft';

export function useChecksDraft(): ChecksDraft | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => draft,
    () => draft
  );
}
