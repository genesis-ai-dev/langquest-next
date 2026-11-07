import type { HoldChoice } from './nearbyModel';

/**
 * What this phone holds of teammates' recordings, where `openLanguage` reads it for
 * `LanguageSession` (docs/nearby-sync-plan.md 5.6, 5.12 "What a phone keeps"). A build with
 * no `.android` files shares nothing nearby, so it holds whatever it is given and sheds
 * nothing: `{ hold: true }`. Android's file (holdChoice.android.ts) answers what
 * `useNearbyIdentity` worked out, so sync never reads a disguise.
 */
export function currentHoldChoice(): HoldChoice | null {
  return { hold: true };
}

/** Only Android's `useNearbyIdentity` keeps one. */
export function keepHoldChoice(_choice: HoldChoice): void {}
