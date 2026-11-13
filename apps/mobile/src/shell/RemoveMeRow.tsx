import type { Ctx } from './ctx';

/**
 * "Remove me from this phone" under More settings, for someone let in offline
 * (RemoveMeRow.android.tsx, docs/nearby-sync-plan.md 14.1, 5 "Me"). Joining
 * offline is Android only, so here there is never anyone to remove, and none
 * of its code is in this bundle.
 */
export function RemoveMeRow(_props: { ctx: Ctx; name: string }) {
  return null;
}
