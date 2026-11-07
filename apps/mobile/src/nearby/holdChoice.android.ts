import type { HoldChoice } from './nearbyModel';

/**
 * What this phone holds of teammates' recordings (docs/nearby-sync-plan.md 5.6, 5.12): kept
 * here by `useNearbyIdentity`, which runs from `SyncEffects` whatever screen is open, because a
 * phone back in town sheds at the end of a sync with Share nearby closed. Null until it has
 * been worked out, which sheds nothing.
 */
let choice: HoldChoice | null = null;

export function currentHoldChoice(): HoldChoice | null {
  return choice;
}

export function keepHoldChoice(next: HoldChoice): void {
  choice = next;
}
