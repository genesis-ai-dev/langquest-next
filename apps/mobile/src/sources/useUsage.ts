// Where a source is used (sources/used.tsx).
import type { UsedReference } from '@langquest-next/core';
import { useMemo, useRef } from 'react';
import { usedItems } from './model';

export interface Usage {
  /** Offered on this screen: kept once, updated as documents arrive. */
  offer: (items: UsedReference[]) => void;
  /** Played, chosen or opened. */
  open: (itemId: string) => void;
  /** What to record now. */
  items: () => UsedReference[];
}

/** One screen's record of what it offered and what was used, for the length of the visit. */
export function useUsage(): Usage {
  const offered = useRef(new Map<string, UsedReference>());
  const opened = useRef(new Set<string>());
  return useMemo<Usage>(() => ({
    offer: (items) => { for (const i of items) offered.current.set(i.itemId, { ...i, opened: offered.current.get(i.itemId)?.opened ?? i.opened }); },
    open: (itemId) => { opened.current.add(itemId); },
    items: () => usedItems(offered.current, opened.current)
  }), []);
}
