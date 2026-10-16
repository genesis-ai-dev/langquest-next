// The steps open inside screens that a phone's Back goes back through
// (useHardwareBack.ts adds them; shell/useRootBack.ts asks them first).
// Asked newest first, by when each one opened, not by when Android heard of
// it: a screen coming back into view would re-add every listener it has,
// parents last, so Android's own order would let a wizard's step answer
// before the page open inside it.

export interface BackTaker {
  /** Whether its screen is the one showing. */
  showing: () => boolean;
  run: () => void;
}

const takers = new Map<BackTaker, number>();
let opened = 0;

/** Adds a step; the function returned takes it away. */
export function openBackStep(taker: BackTaker): () => void {
  takers.set(taker, ++opened);
  return () => { takers.delete(taker); };
}

/** Runs the newest step open on the screen showing; false when there is none. */
export function takeHardwareBack(): boolean {
  let newest: BackTaker | null = null;
  let at = -1;
  for (const [taker, when] of takers) if (when > at && taker.showing()) { newest = taker; at = when; }
  if (!newest) return false;
  newest.run();
  return true;
}
