import { useEffect } from 'react';
import { nearbyOwner } from './nearbyOwner';

/**
 * A screen that runs the radios claims them while `open` (docs/nearby-sync-plan.md 15.6, "One owner
 * for the radios"): the quiet room while LangQuest is open stops first, and waits until the claim
 * is let go. Share nearby, Let someone in, Give the app and joining offline each call it.
 */
export function useRadioClaim(open: boolean): void {
  useEffect(() => (open ? nearbyOwner.claim() : undefined), [open]);
}
