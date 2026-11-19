import type { Ctx } from './ctx';

/**
 * Share nearby's row on the Sync screen, which only a phone has (docs/nearby-sync-plan.md 5.8;
 * NearbyRow.native.tsx, Android and iPhones). A plain stub, so the web build carries none of it.
 */
export function NearbyRow(_props: { ctx: Ctx }) {
  return null;
}
