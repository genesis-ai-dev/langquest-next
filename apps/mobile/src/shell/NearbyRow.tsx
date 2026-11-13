import type { Ctx } from './ctx';

/**
 * Share nearby's row on the Sync screen, which only Android has until iPhones join (docs/
 * nearby-sync-plan.md 5.8; NearbyRow.android.tsx). A plain stub, as AppIconRow is, so the web and
 * iPhone builds carry none of it: a `.web` file would still ship it on iPhones.
 */
export function NearbyRow(_props: { ctx: Ctx }) {
  return null;
}
