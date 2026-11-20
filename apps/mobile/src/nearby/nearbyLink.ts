/**
 * The nearby link's radio on this platform (docs/nearby-sync-plan.md 5.9, 5.12). Only a phone has
 * one: `nearbyLink.native.ts` binds the native module (`modules/nearby-link`) to sync's
 * `NearbyRadio` and `NearbyLink` on Android and iPhones. The web shares nothing nearby (decision
 * 58), so here there is no radio, the nearby entries stay out of this bundle, and Share nearby
 * says it is not available.
 */
export function nearbyRadio(): null {
  return null;
}
